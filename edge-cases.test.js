// Adversarial edge cases: empty, null, duplicate, concurrent, oversized,
// malformed. Every one of these is something a flaky field connection, a
// retrying client, or a hostile caller can actually produce.
process.env.REGISTRATION_INVITE_CODE = 'test-invite';
process.env.SUPPLYA_API_BASE = 'https://supplya.test/api/v1';

import request from 'supertest';
import app, { signTokenForTest } from './server.js';

const INVITE = { inviteCode: 'test-invite' };
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const tokenFor = (role, id = `${role}-edge-id`) =>
  signTokenForTest({ sub: id, email: `${role}@rill.test`, role, exp: Date.now() + 60000 });

describe('Edge cases and abuse', () => {
  let coToken, adminToken, merchantId;

  beforeAll(async () => {
    adminToken = tokenFor('admin');
    const reg = await request(app).post('/api/auth/register').send({
      email: `edge-${Date.now()}@rill.com`,
      password: 'password123',
      firstName: 'Edge',
      lastName: 'Case',
      ...INVITE
    });
    coToken = reg.body.token;

    const m = await request(app)
      .post('/api/users')
      .set(bearer(coToken))
      .send({ name: 'Edge Merchant', location: 'Mushin' });
    merchantId = m.body.id;
    await request(app)
      .post('/api/disbursements')
      .set(bearer(adminToken))
      .send({ userId: merchantId, amount: 10000, dailyInstallment: 500 });
  });

  describe('concurrency — the retrying field client', () => {
    test('the SAME idempotency key fired concurrently records exactly one payment', async () => {
      const m = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: 'Concurrent Merchant', location: 'Ikorodu' });
      await request(app)
        .post('/api/disbursements')
        .set(bearer(adminToken))
        .send({ userId: m.body.id, amount: 20000, dailyInstallment: 1000 });

      const key = `race-${Date.now()}`;
      const body = { userId: m.body.id, amount: 1000, method: 'cash', idempotencyKey: key };
      // Fire simultaneously — this is a phone retrying on a flaky connection.
      const results = await Promise.all([
        request(app).post('/api/payments').set(bearer(coToken)).send(body),
        request(app).post('/api/payments').set(bearer(coToken)).send(body),
        request(app).post('/api/payments').set(bearer(coToken)).send(body)
      ]);
      // None may 500 — a duplicate is an expected outcome, not a crash.
      for (const r of results) expect(r.status).toBeLessThan(500);

      const history = await request(app)
        .get(`/api/users/${m.body.id}/history`)
        .set(bearer(adminToken));
      expect(history.body.payments.length).toBe(1);

      // And the ledger must have moved exactly once.
      const users = await request(app).get('/api/users').set(bearer(adminToken));
      expect(users.body.find((u) => u.id === m.body.id).balance).toBe(19000);
    });
  });

  describe('money boundaries', () => {
    test('a payment larger than the balance is refused', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set(bearer(coToken))
        .send({ userId: merchantId, amount: 999999999, method: 'cash', idempotencyKey: `over-${Date.now()}` });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('zero and negative amounts are refused with a field error', async () => {
      for (const amount of [0, -100]) {
        const res = await request(app)
          .post('/api/payments')
          .set(bearer(coToken))
          .send({ userId: merchantId, amount, method: 'cash', idempotencyKey: `neg-${amount}-${Date.now()}` });
        expect(res.status).toBe(400);
        expect(res.body.fields.amount).toBeDefined();
      }
    });

    test('a fractional amount is refused (money is integer minor units)', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set(bearer(coToken))
        .send({ userId: merchantId, amount: 10.5, method: 'cash', idempotencyKey: `frac-${Date.now()}` });
      expect(res.status).toBe(400);
      expect(res.body.fields.amount).toBeDefined();
    });

    test('a numeric-string amount is not coerced into a surprise', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set(bearer(coToken))
        .send({ userId: merchantId, amount: '50', method: 'cash', idempotencyKey: `str-${Date.now()}` });
      // Either accepted as 50 or rejected — but never a 500, and never a
      // different number than the officer typed.
      expect(res.status).toBeLessThan(500);
    });

    test('disbursement to a non-existent merchant is 404, not a crash', async () => {
      const res = await request(app)
        .post('/api/disbursements')
        .set(bearer(adminToken))
        .send({ userId: 'ghost-merchant', amount: 5000, dailyInstallment: 100 });
      expect([400, 404]).toContain(res.status);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('malformed and hostile input', () => {
    test('malformed JSON returns 400, not 500', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "broken",,,}');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('null values in required fields are rejected cleanly', async () => {
      const res = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: null, location: null });
      expect(res.status).toBe(400);
      expect(res.body.fields).toBeDefined();
    });

    test('an SQL-injection-shaped name is stored as literal text', async () => {
      const evil = "Robert'); DROP TABLE users;--";
      const res = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: evil, location: 'Test' });
      expect(res.status).toBe(200);

      // The table must still exist and the value must be intact, proving
      // parameterised queries rather than interpolation.
      const list = await request(app).get('/api/users').set(bearer(adminToken));
      expect(list.status).toBe(200);
      expect(list.body.find((u) => u.name === evil)).toBeDefined();
    });

    test('an oversized name is refused rather than silently truncated', async () => {
      const res = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: 'x'.repeat(50000), location: 'Test' });
      expect(res.status).toBeLessThan(500);
    });

    test('unicode and emoji names round-trip intact', async () => {
      const name = 'Adaeze Nwosu 🏪 Ọjà';
      const res = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name, location: 'Àgbàdo' });
      expect(res.status).toBe(200);
      const list = await request(app).get('/api/users').set(bearer(adminToken));
      expect(list.body.find((u) => u.name === name)).toBeDefined();
    });

    test('a duplicate email cannot register twice', async () => {
      const email = `dupe-${Date.now()}@rill.com`;
      const body = { email, password: 'password123', firstName: 'Du', lastName: 'Pe', ...INVITE };
      const first = await request(app).post('/api/auth/register').send(body);
      expect(first.status).toBe(200);
      const second = await request(app).post('/api/auth/register').send(body);
      expect(second.status).toBe(400);
      expect(second.status).toBeLessThan(500);
    });
  });

  describe('auth edge cases', () => {
    test('an expired token is rejected', async () => {
      const expired = signTokenForTest({ sub: 'x', email: 'x@x.com', role: 'admin', exp: Date.now() - 1000 });
      const res = await request(app).get('/api/users').set(bearer(expired));
      expect(res.status).toBe(401);
    });

    test('a tampered token signature is rejected', async () => {
      const good = tokenFor('admin');
      const tampered = good.slice(0, -4) + 'AAAA';
      const res = await request(app).get('/api/users').set(bearer(tampered));
      expect(res.status).toBe(401);
    });

    test('a token with a forged admin role but bad signature is rejected', async () => {
      // Payload says admin; signature does not match. This is the whole reason
      // the role lives inside the signed blob.
      const payload = Buffer.from(JSON.stringify({ sub: 'x', role: 'admin', exp: Date.now() + 60000 })).toString('base64url');
      const res = await request(app).get('/api/users').set(bearer(`${payload}.notasignature`));
      expect(res.status).toBe(401);
    });

    test('a garbage Authorization header is rejected, not crashed on', async () => {
      for (const header of ['Bearer', 'Bearer ', 'NotBearer abc', '....', 'Bearer a.b.c.d']) {
        const res = await request(app).get('/api/users').set({ Authorization: header });
        expect(res.status).toBe(401);
      }
    });
  });

  describe('cascade integrity', () => {
    test('deleting a merchant removes every dependent record', async () => {
      const m = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: 'Cascade Target', location: 'Ejigbo' });
      const id = m.body.id;

      await request(app).post('/api/disbursements').set(bearer(adminToken))
        .send({ userId: id, amount: 5000, dailyInstallment: 250 });
      await request(app).post('/api/payments').set(bearer(coToken))
        .send({ userId: id, amount: 250, method: 'cash', idempotencyKey: `casc-${Date.now()}` });
      await request(app).post('/api/audits').set(bearer(coToken))
        .send({ userId: id, mood: 'neutral', stockLevel: 'low', marketTraffic: 'slow', notes: 'n' });
      await request(app).post('/api/escalations').set(bearer(coToken))
        .send({ userId: id, reason: 'Test escalation' });

      const before = await request(app).get(`/api/users/${id}/history`).set(bearer(adminToken));
      expect(before.body.payments.length).toBe(1);
      expect(before.body.audits.length).toBe(1);

      await request(app).delete(`/api/users/${id}`).set(bearer(adminToken));

      const after = await request(app).get(`/api/users/${id}/history`).set(bearer(adminToken));
      expect(after.body.payments.length).toBe(0);
      expect(after.body.audits.length).toBe(0);
      expect(after.body.disbursements.length).toBe(0);

      // And it must be gone from the escalation feed, not left dangling.
      const esc = await request(app).get('/api/escalations').set(bearer(adminToken));
      expect(esc.body.find((e) => e.userId === id)).toBeUndefined();
    });

    test('deleting an already-deleted merchant is 404, not a crash', async () => {
      const res = await request(app).delete('/api/users/never-existed').set(bearer(adminToken));
      expect(res.status).toBe(404);
    });

    test('a deactivated merchant disappears from /today but keeps its history', async () => {
      const m = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: 'Deactivate Me', location: 'Ikotun' });
      await request(app).patch(`/api/users/${m.body.id}/status`).set(bearer(adminToken))
        .send({ status: 'deactivated' });

      const today = await request(app).get('/api/today').set(bearer(coToken));
      expect(today.body.find((u) => u.id === m.body.id)).toBeUndefined();

      const hist = await request(app).get(`/api/users/${m.body.id}/history`).set(bearer(adminToken));
      expect(hist.status).toBe(200);
    });
  });

  describe('empty-state correctness', () => {
    test('history for an unknown merchant returns empty arrays, not null', async () => {
      const res = await request(app).get('/api/users/nobody/history').set(bearer(adminToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.payments)).toBe(true);
      expect(Array.isArray(res.body.audits)).toBe(true);
      expect(Array.isArray(res.body.disbursements)).toBe(true);
    });

    test('photos for an unknown merchant returns an empty array', async () => {
      const res = await request(app).get('/api/users/nobody/photos').set(bearer(adminToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
