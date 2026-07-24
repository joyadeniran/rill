// Rill has THREE kinds of user. This suite pins the privilege matrix so a
// future change cannot silently widen or narrow any role's authority.
//
//   co     — field Collection Officer (mobile app). Works his assigned book:
//            records payments/audits/escalations, creates merchants.
//   admin  — Supplya admin (web console). Everything a CO can do, plus money
//            (disbursement), merchant lifecycle, defaulter assignment, and
//            officer management.
//   lender — capital provider (web console). READ-ONLY oversight: portfolio,
//            escalations, defaulters, risk briefing. Must never move money,
//            assign work, or manage officers.
process.env.REGISTRATION_INVITE_CODE = 'test-invite';
process.env.SUPPLYA_API_BASE = 'https://supplya.test/api/v1';

import request from 'supertest';
import app from './server.js';
import { signTokenForTest } from './server.js';

const INVITE = { inviteCode: 'test-invite' };
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

/** Mint a token for an arbitrary role without needing a real login flow. */
function tokenFor(role, id = `${role}-test-id`) {
  return signTokenForTest({
    sub: id,
    email: `${role}@rill.test`,
    role,
    exp: Date.now() + 60000
  });
}

describe('Three-role privilege matrix', () => {
  let coToken, adminToken, lenderToken, merchantId;

  beforeAll(async () => {
    const reg = await request(app).post('/api/auth/register').send({
      email: `co-roles-${Date.now()}@rill.com`,
      password: 'password123',
      firstName: 'Field',
      lastName: 'Officer',
      ...INVITE
    });
    coToken = reg.body.token;
    adminToken = tokenFor('admin');
    lenderToken = tokenFor('lender');

    const m = await request(app)
      .post('/api/users')
      .set(bearer(coToken))
      .send({ name: 'Role Test Merchant', phone: '08012345678', location: 'Yaba' });
    merchantId = m.body.id;
  });

  describe('self-registration always yields a CO', () => {
    test('registered officer has role co, never admin or lender', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: `esc-${Date.now()}@rill.com`,
        password: 'password123',
        firstName: 'Esc',
        lastName: 'Alate',
        role: 'admin', // must be ignored — privilege escalation attempt
        ...INVITE
      });
      expect(res.status).toBe(200);
      expect(res.body.officer.role).toBe('co');
    });
  });

  describe('money movement (disbursement) — admin only', () => {
    const body = () => ({ userId: merchantId, amount: 50000, dailyInstallment: 1000 });

    test('admin can disburse', async () => {
      const res = await request(app).post('/api/disbursements').set(bearer(adminToken)).send(body());
      expect(res.status).toBe(200);
    });
    test('co cannot disburse', async () => {
      const res = await request(app).post('/api/disbursements').set(bearer(coToken)).send(body());
      expect(res.status).toBe(403);
    });
    test('lender cannot disburse (read-only oversight)', async () => {
      const res = await request(app).post('/api/disbursements').set(bearer(lenderToken)).send(body());
      expect(res.status).toBe(403);
    });
  });

  describe('portfolio read — admin and lender, not co', () => {
    test('admin can list all merchants', async () => {
      const res = await request(app).get('/api/users').set(bearer(adminToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
    test('lender can list all merchants', async () => {
      const res = await request(app).get('/api/users').set(bearer(lenderToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
    test('co cannot list the whole book', async () => {
      const res = await request(app).get('/api/users').set(bearer(coToken));
      expect(res.status).toBe(403);
    });
  });

  describe('escalation feed — admin and lender', () => {
    test('lender can read escalations', async () => {
      const res = await request(app).get('/api/escalations').set(bearer(lenderToken));
      expect(res.status).toBe(200);
    });
    test('co cannot read the escalation feed', async () => {
      const res = await request(app).get('/api/escalations').set(bearer(coToken));
      expect(res.status).toBe(403);
    });
  });

  describe('merchant lifecycle — admin only', () => {
    test('admin can deactivate a merchant', async () => {
      const res = await request(app)
        .patch(`/api/users/${merchantId}/status`)
        .set(bearer(adminToken))
        .send({ status: 'deactivated' });
      expect(res.status).toBe(200);
    });
    test('lender cannot change merchant status', async () => {
      const res = await request(app)
        .patch(`/api/users/${merchantId}/status`)
        .set(bearer(lenderToken))
        .send({ status: 'active' });
      expect(res.status).toBe(403);
    });
    test('co cannot change merchant status', async () => {
      const res = await request(app)
        .patch(`/api/users/${merchantId}/status`)
        .set(bearer(coToken))
        .send({ status: 'active' });
      expect(res.status).toBe(403);
    });
  });

  describe('officer management — admin only', () => {
    test('admin can list officers', async () => {
      const res = await request(app).get('/api/officers').set(bearer(adminToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Password material must never leave the server.
      for (const o of res.body) expect(o.password).toBeUndefined();
    });

    test('admin can create a lender account', async () => {
      const res = await request(app)
        .post('/api/officers')
        .set(bearer(adminToken))
        .send({
          email: `lender-${Date.now()}@rill.com`,
          password: 'lenderpass1',
          firstName: 'Cap',
          lastName: 'Provider',
          role: 'lender'
        });
      expect(res.status).toBe(200);
      expect(res.body.officer.role).toBe('lender');
      expect(res.body.officer.password).toBeUndefined();
    });

    test('admin cannot mint another admin through this route', async () => {
      const res = await request(app)
        .post('/api/officers')
        .set(bearer(adminToken))
        .send({
          email: `newadmin-${Date.now()}@rill.com`,
          password: 'adminpass1',
          firstName: 'New',
          lastName: 'Admin',
          role: 'admin'
        });
      expect(res.status).toBe(400);
      expect(res.body.fields.role).toBeDefined();
    });

    test('co cannot list officers', async () => {
      const res = await request(app).get('/api/officers').set(bearer(coToken));
      expect(res.status).toBe(403);
    });
    test('lender cannot create officers', async () => {
      const res = await request(app)
        .post('/api/officers')
        .set(bearer(lenderToken))
        .send({ email: `x-${Date.now()}@rill.com`, password: 'pass12345', firstName: 'A', lastName: 'B', role: 'co' });
      expect(res.status).toBe(403);
    });
  });

  describe('field actions — co and admin, not lender', () => {
    test('lender cannot record a payment', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set(bearer(lenderToken))
        .send({ userId: merchantId, amount: 100, method: 'cash', idempotencyKey: `l-${Date.now()}` });
      expect(res.status).toBe(403);
    });
    test('lender cannot create a merchant', async () => {
      const res = await request(app)
        .post('/api/users')
        .set(bearer(lenderToken))
        .send({ name: 'Nope', location: 'Nowhere' });
      expect(res.status).toBe(403);
    });
  });

  describe('deactivated officers lose access', () => {
    test('a deactivated officer cannot log in', async () => {
      const email = `deact-${Date.now()}@rill.com`;
      await request(app)
        .post('/api/auth/register')
        .send({ email, password: 'password123', firstName: 'De', lastName: 'Act', ...INVITE });

      const list = await request(app).get('/api/officers').set(bearer(adminToken));
      const target = list.body.find((o) => o.email === email);
      expect(target).toBeDefined();

      const patch = await request(app)
        .patch(`/api/officers/${target.id}`)
        .set(bearer(adminToken))
        .send({ active: false });
      expect(patch.status).toBe(200);

      const login = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
      expect(login.status).toBe(403);
      expect(login.body.error).toMatch(/deactivat/i);
    });
  });

  describe('change password', () => {
    let email, token;
    beforeAll(async () => {
      email = `pw-${Date.now()}@rill.com`;
      const r = await request(app)
        .post('/api/auth/register')
        .send({ email, password: 'oldpassword1', firstName: 'Pass', lastName: 'Word', ...INVITE });
      token = r.body.token;
    });

    test('short new password gives a FIELD error, not a bare 400', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set(bearer(token))
        .send({ currentPassword: 'oldpassword1', newPassword: '123' });
      expect(res.status).toBe(400);
      expect(res.body.fields.newPassword).toBeDefined();
      expect(res.body.fields.newPassword).toMatch(/6/);
    });

    test('wrong current password is rejected against the right field', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set(bearer(token))
        .send({ currentPassword: 'not-my-password', newPassword: 'brandnew123' });
      expect(res.status).toBe(400);
      expect(res.body.fields.currentPassword).toBeDefined();
    });

    test('reusing the same password is rejected', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set(bearer(token))
        .send({ currentPassword: 'oldpassword1', newPassword: 'oldpassword1' });
      expect(res.status).toBe(400);
      expect(res.body.fields.newPassword).toBeDefined();
    });

    test('valid change succeeds and the new password works', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set(bearer(token))
        .send({ currentPassword: 'oldpassword1', newPassword: 'brandnew123' });
      expect(res.status).toBe(200);

      const login = await request(app).post('/api/auth/login').send({ email, password: 'brandnew123' });
      expect(login.status).toBe(200);

      const old = await request(app).post('/api/auth/login').send({ email, password: 'oldpassword1' });
      expect(old.status).toBe(401);
    });

    test('unauthenticated change-password is rejected', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: 'a', newPassword: 'bbbbbbb' });
      expect(res.status).toBe(401);
    });
  });
});
