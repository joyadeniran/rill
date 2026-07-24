// Defaulter oversight + work assignment.
//
// Supplya admins must be able to see who is defaulting and hand each one to a
// specific Collection Officer. Lenders get the same visibility read-only.
// Assignment is what stops two COs working the same merchant.
//
// Defaulter definition (RILL_SPEC "STATUS LOGIC", red band):
//   an active merchant with an outstanding balance whose last payment was
//   more than 48h ago (never-paid counts, measured from disbursement).
process.env.REGISTRATION_INVITE_CODE = 'test-invite';
process.env.SUPPLYA_API_BASE = 'https://supplya.test/api/v1';

import request from 'supertest';
import app, { signTokenForTest } from './server.js';

const INVITE = { inviteCode: 'test-invite' };
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const tokenFor = (role, id = `${role}-da-id`) =>
  signTokenForTest({ sub: id, email: `${role}@rill.test`, role, exp: Date.now() + 60000 });

describe('Defaulters & assignment', () => {
  let adminToken, lenderToken, coToken, coId, otherCoId, merchantId;

  beforeAll(async () => {
    adminToken = tokenFor('admin');
    lenderToken = tokenFor('lender');

    const reg = await request(app).post('/api/auth/register').send({
      email: `co-da-${Date.now()}@rill.com`,
      password: 'password123',
      firstName: 'Assign',
      lastName: 'Target',
      ...INVITE
    });
    coToken = reg.body.token;
    coId = reg.body.officer.id;

    const other = await request(app).post('/api/auth/register').send({
      email: `co-other-${Date.now()}@rill.com`,
      password: 'password123',
      firstName: 'Other',
      lastName: 'Officer',
      ...INVITE
    });
    otherCoId = other.body.officer.id;

    const m = await request(app)
      .post('/api/users')
      .set(bearer(coToken))
      .send({ name: 'Defaulting Merchant', phone: '08099887766', location: 'Oshodi' });
    merchantId = m.body.id;

    // Put money on the book so there is a balance to default on.
    await request(app)
      .post('/api/disbursements')
      .set(bearer(adminToken))
      .send({ userId: merchantId, amount: 40000, dailyInstallment: 800 });
  });

  describe('GET /api/defaulters', () => {
    test('admin can read the defaulter list', async () => {
      const res = await request(app).get('/api/defaulters').set(bearer(adminToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('lender can read it (read-only oversight)', async () => {
      const res = await request(app).get('/api/defaulters').set(bearer(lenderToken));
      expect(res.status).toBe(200);
    });

    test('co cannot read the portfolio-wide defaulter list', async () => {
      const res = await request(app).get('/api/defaulters').set(bearer(coToken));
      expect(res.status).toBe(403);
    });

    test('a never-paid merchant with a balance is a defaulter', async () => {
      const res = await request(app).get('/api/defaulters').set(bearer(adminToken));
      const found = res.body.find((d) => d.id === merchantId);
      expect(found).toBeDefined();
      expect(found.balance).toBeGreaterThan(0);
      // Must carry the fields an admin needs to triage and assign.
      expect(found.name).toBeDefined();
      expect(found).toHaveProperty('hoursSinceLastPayment');
      expect(found).toHaveProperty('assignedCoId');
    });

    test('a merchant with no balance is not a defaulter', async () => {
      const clean = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: 'No Debt Merchant', location: 'Ikeja' });
      const res = await request(app).get('/api/defaulters').set(bearer(adminToken));
      expect(res.body.find((d) => d.id === clean.body.id)).toBeUndefined();
    });

    test('deactivated merchants are excluded from the defaulter list', async () => {
      const m = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: 'Deactivated Debtor', location: 'Surulere' });
      await request(app)
        .post('/api/disbursements')
        .set(bearer(adminToken))
        .send({ userId: m.body.id, amount: 5000, dailyInstallment: 100 });
      await request(app)
        .patch(`/api/users/${m.body.id}/status`)
        .set(bearer(adminToken))
        .send({ status: 'deactivated' });

      const res = await request(app).get('/api/defaulters').set(bearer(adminToken));
      expect(res.body.find((d) => d.id === m.body.id)).toBeUndefined();
    });
  });

  describe('POST /api/users/:id/assign', () => {
    test('admin can assign a defaulter to a CO', async () => {
      const res = await request(app)
        .post(`/api/users/${merchantId}/assign`)
        .set(bearer(adminToken))
        .send({ officerId: coId });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const list = await request(app).get('/api/defaulters').set(bearer(adminToken));
      const found = list.body.find((d) => d.id === merchantId);
      expect(found.assignedCoId).toBe(coId);
      expect(found.assignedCoName).toMatch(/Assign/);
    });

    test('assigning to a non-existent officer is a field error', async () => {
      const res = await request(app)
        .post(`/api/users/${merchantId}/assign`)
        .set(bearer(adminToken))
        .send({ officerId: 'no-such-officer' });
      expect(res.status).toBe(400);
      expect(res.body.fields.officerId).toBeDefined();
    });

    test('assigning a non-existent merchant returns 404', async () => {
      const res = await request(app)
        .post('/api/users/no-such-merchant/assign')
        .set(bearer(adminToken))
        .send({ officerId: coId });
      expect(res.status).toBe(404);
    });

    test('cannot assign work to a lender', async () => {
      const l = await request(app)
        .post('/api/officers')
        .set(bearer(adminToken))
        .send({
          email: `lender-da-${Date.now()}@rill.com`,
          password: 'lenderpass1',
          firstName: 'Read',
          lastName: 'Only',
          role: 'lender'
        });
      const res = await request(app)
        .post(`/api/users/${merchantId}/assign`)
        .set(bearer(adminToken))
        .send({ officerId: l.body.officer.id });
      expect(res.status).toBe(400);
      expect(res.body.fields.officerId).toBeDefined();
    });

    test('cannot assign to a deactivated CO', async () => {
      const d = await request(app)
        .post('/api/officers')
        .set(bearer(adminToken))
        .send({
          email: `deadco-${Date.now()}@rill.com`,
          password: 'password123',
          firstName: 'Dead',
          lastName: 'Co',
          role: 'co'
        });
      await request(app)
        .patch(`/api/officers/${d.body.officer.id}`)
        .set(bearer(adminToken))
        .send({ active: false });

      const res = await request(app)
        .post(`/api/users/${merchantId}/assign`)
        .set(bearer(adminToken))
        .send({ officerId: d.body.officer.id });
      expect(res.status).toBe(400);
      expect(res.body.fields.officerId).toBeDefined();
    });

    test('assignment can be cleared with officerId: null', async () => {
      const res = await request(app)
        .post(`/api/users/${merchantId}/assign`)
        .set(bearer(adminToken))
        .send({ officerId: null });
      expect(res.status).toBe(200);
      const list = await request(app).get('/api/defaulters').set(bearer(adminToken));
      expect(list.body.find((d) => d.id === merchantId).assignedCoId).toBeNull();
    });

    test('lender cannot assign work', async () => {
      const res = await request(app)
        .post(`/api/users/${merchantId}/assign`)
        .set(bearer(lenderToken))
        .send({ officerId: coId });
      expect(res.status).toBe(403);
    });

    test('co cannot assign work', async () => {
      const res = await request(app)
        .post(`/api/users/${merchantId}/assign`)
        .set(bearer(coToken))
        .send({ officerId: coId });
      expect(res.status).toBe(403);
    });
  });

  describe('/today respects assignment', () => {
    test('a CO sees merchants assigned to them', async () => {
      await request(app)
        .post(`/api/users/${merchantId}/assign`)
        .set(bearer(adminToken))
        .send({ officerId: coId });

      const res = await request(app).get('/api/today').set(bearer(coToken));
      expect(res.status).toBe(200);
      expect(res.body.find((m) => m.id === merchantId)).toBeDefined();
    });

    test('a CO does NOT see merchants assigned to a different CO', async () => {
      await request(app)
        .post(`/api/users/${merchantId}/assign`)
        .set(bearer(adminToken))
        .send({ officerId: otherCoId });

      const res = await request(app).get('/api/today').set(bearer(coToken));
      expect(res.body.find((m) => m.id === merchantId)).toBeUndefined();
    });

    test('unassigned merchants stay visible to every CO (book is never hidden)', async () => {
      const un = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: 'Unassigned Merchant', location: 'Lekki' });

      const res = await request(app).get('/api/today').set(bearer(coToken));
      expect(res.body.find((m) => m.id === un.body.id)).toBeDefined();
    });

    test('admin sees the whole book on /today regardless of assignment', async () => {
      const res = await request(app).get('/api/today').set(bearer(adminToken));
      expect(res.body.find((m) => m.id === merchantId)).toBeDefined();
    });
  });
});
