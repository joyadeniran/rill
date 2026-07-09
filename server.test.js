// Env must be set before the app handles requests. Handlers read these at
// request time, so setting them here (before any test runs) is sufficient.
process.env.REGISTRATION_INVITE_CODE = 'test-invite';
process.env.SUPPLYA_API_BASE = 'https://supplya.test/api/v1';

import request from 'supertest';
import app from './server.js';
import { jest } from '@jest/globals';

const INVITE = { inviteCode: 'test-invite' };

describe('Rill API Integration Tests', () => {
  let officerId;
  let userId;
  let token;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  test('GET /health should return 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/auth/register should create an officer and return a token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `test-${Date.now()}@rill.com`,
        password: 'password123',
        firstName: 'Test',
        lastName: 'Officer',
        ...INVITE
      });
    expect(res.status).toBe(200);
    expect(res.body.officer).toBeDefined();
    expect(typeof res.body.token).toBe('string');
    officerId = res.body.officer.id;
    token = res.body.token;
  });

  test('POST /api/users should create a user', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth())
      .send({
        name: 'Test Borrower',
        location: 'Test Market'
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    userId = res.body.id;
  });

  test('POST /api/payments against an undisbursed user (zero balance) is rejected', async () => {
    // Users start with balance 0; a payment cannot exceed the outstanding
    // balance. The full disburse -> pay happy path is covered in the
    // 'Roles, disbursements & payment integrity' suite below.
    const res = await request(app)
      .post('/api/payments')
      .set(auth())
      .send({
        userId,
        amount: 1000,
        officerId,
        method: 'cash'
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds/i);
  });

  test('POST /api/audits should log an audit', async () => {
    const res = await request(app)
      .post('/api/audits')
      .set(auth())
      .send({
        userId,
        mood: 'positive',
        stockLevel: 'high'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/escalations should log an escalation', async () => {
    const res = await request(app)
      .post('/api/escalations')
      .set(auth())
      .send({
        userId,
        reason: 'Refusal to pay'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/today should return a list of merchants', async () => {
    const res = await request(app).get('/api/today').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('Edge Case: Register with invalid email should fail', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'invalid', password: '123' });
    expect(res.status).toBe(400);
  });

  test('Edge Case: Login with missing fields should return 400, not 500', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('Edge Case: Login with wrong credentials should return 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@rill.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  test('Registered officer can log in and receive officer payload + token', async () => {
    const email = `login-${Date.now()}@rill.com`;
    await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'password123', firstName: 'Log', lastName: 'In', ...INVITE });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.officer).toBeDefined();
    expect(res.body.officer.email).toBe(email);
    expect(res.body.officer.password).toBeUndefined();
    expect(typeof res.body.token).toBe('string');
  });

  test('Security: protected endpoint without a token returns 401', async () => {
    const res = await request(app).get('/api/today');
    expect(res.status).toBe(401);
  });

  test('Security: protected endpoint with a malformed token returns 401', async () => {
    const res = await request(app)
      .get('/api/today')
      .set({ Authorization: 'Bearer not.a.realtoken' });
    expect(res.status).toBe(401);
  });

  test('Security: a tampered token signature is rejected (401)', async () => {
    const [bodyPart] = token.split('.');
    const forged = `${bodyPart}.deadbeefsignature`;
    const res = await request(app)
      .get('/api/today')
      .set({ Authorization: `Bearer ${forged}` });
    expect(res.status).toBe(401);
  });

  test('Edge Case: Payment with negative amount should be rejected (400)', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set(auth())
      .send({ userId, amount: -500, officerId, method: 'cash' });
    expect(res.status).toBe(400);
  });

  test('Edge Case: Payment with zero amount should be rejected (400)', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set(auth())
      .send({ userId, amount: 0, officerId, method: 'cash' });
    expect(res.status).toBe(400);
  });

  test('Audit with only required field (no optional fields) should succeed', async () => {
    const res = await request(app)
      .post('/api/audits')
      .set(auth())
      .send({ userId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/users without phone should succeed and default to pending', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth())
      .send({ name: 'No Phone Borrower', location: 'Market Square' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  test('GET /api/today returns merchants with numeric balance and dailyInstallment', async () => {
    const res = await request(app).get('/api/today').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const m of res.body) {
      expect(typeof m.balance).toBe('number');
      expect(typeof m.dailyInstallment).toBe('number');
      expect(['urgent', 'at-risk', 'on-track']).toContain(m.internalStatus);
    }
  });
});

describe('Roles, disbursements & payment integrity', () => {
  let coToken;
  let adminToken;
  let merchantId;
  const coAuth = () => ({ Authorization: `Bearer ${coToken}` });
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const realFetch = global.fetch;

  const supplyaLoginResponse = (role) => ({
    ok: true,
    status: 200,
    json: async () => ({
      status: true,
      message: 'Login successful',
      data: { _id: 'sup-123', email: 'boss@supplya.shop', firstName: 'Ada', lastName: 'Admin', role },
      token: 'supplya-jwt',
      refreshToken: 'supplya-refresh'
    })
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  // --- Registration gating ---

  test('register without invite code -> 403', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: `nogate-${Date.now()}@rill.com`, password: 'password123', firstName: 'No' });
    expect(res.status).toBe(403);
  });

  test('register with wrong invite code -> 403', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: `wrong-${Date.now()}@rill.com`, password: 'password123', firstName: 'No', inviteCode: 'nope' });
    expect(res.status).toBe(403);
  });

  test('register with correct invite code succeeds with role co', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: `co-${Date.now()}@rill.com`, password: 'password123', firstName: 'Field', lastName: 'Officer', ...INVITE });
    expect(res.status).toBe(200);
    expect(res.body.officer.role).toBe('co');
    coToken = res.body.token;
  });

  // --- Supplya admin login proxy ---

  test('admin-login with a Supplya admin account mints an admin token', async () => {
    global.fetch = jest.fn(async () => supplyaLoginResponse('admin'));
    const res = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'boss@supplya.shop', password: 'secretpass' });
    expect(res.status).toBe(200);
    expect(res.body.officer.role).toBe('admin');
    expect(typeof res.body.token).toBe('string');
    adminToken = res.body.token;
    // password forwarded untouched (never trimmed/transformed)
    const forwarded = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(forwarded.password).toBe('secretpass');
  });

  test('admin-login with a non-admin Supplya account -> 403', async () => {
    global.fetch = jest.fn(async () => supplyaLoginResponse('customer'));
    const res = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'shopper@supplya.shop', password: 'secretpass' });
    expect(res.status).toBe(403);
  });

  test('admin-login with bad upstream credentials -> 401', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ status: false, message: 'You have entered an invalid password.' })
    }));
    const res = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'boss@supplya.shop', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('admin-login when Supplya is unreachable -> 502', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    });
    const res = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'boss@supplya.shop', password: 'secretpass' });
    expect(res.status).toBe(502);
  });

  // --- Disbursements ---

  test('a CO token cannot disburse -> 403', async () => {
    const res = await request(app)
      .post('/api/disbursements')
      .set(coAuth())
      .send({ userId: 'whatever', amount: 5000, dailyInstallment: 500 });
    expect(res.status).toBe(403);
  });

  test('disburse to an unknown user -> 404', async () => {
    const res = await request(app)
      .post('/api/disbursements')
      .set(adminAuth())
      .send({ userId: 'does-not-exist', amount: 5000, dailyInstallment: 500 });
    expect(res.status).toBe(404);
  });

  test('disburse with non-positive amount -> 400', async () => {
    const res = await request(app)
      .post('/api/disbursements')
      .set(adminAuth())
      .send({ userId: 'whatever', amount: 0, dailyInstallment: 500 });
    expect(res.status).toBe(400);
  });

  test('disbursement activates the user and sets balances', async () => {
    const created = await request(app)
      .post('/api/users')
      .set(coAuth())
      .send({ name: 'Disbursed Merchant', location: 'Balogun Market' });
    merchantId = created.body.id;

    const res = await request(app)
      .post('/api/disbursements')
      .set(adminAuth())
      .send({ userId: merchantId, amount: 20000, dailyInstallment: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const today = await request(app).get('/api/today').set(coAuth());
    const merchant = today.body.find((m) => m.id === merchantId);
    expect(merchant.status).toBe('active');
    expect(merchant.balance).toBe(20000);
    expect(merchant.totalOwed).toBe(20000);
    expect(merchant.dailyInstallment).toBe(1000);
  });

  test('disbursements appear in user history', async () => {
    const res = await request(app).get(`/api/users/${merchantId}/history`).set(coAuth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.disbursements)).toBe(true);
    expect(res.body.disbursements.length).toBe(1);
    expect(res.body.disbursements[0].amount).toBe(20000);
  });

  // --- Payment integrity ---

  test('payment to an unknown user -> 404', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set(coAuth())
      .send({ userId: 'ghost-user', amount: 100, method: 'cash' });
    expect(res.status).toBe(404);
  });

  test('payment exceeding outstanding balance -> 400', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set(coAuth())
      .send({ userId: merchantId, amount: 999999, method: 'cash' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds/i);
  });

  test('payment with an invalid method -> 400', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set(coAuth())
      .send({ userId: merchantId, amount: 100, method: 'crypto' });
    expect(res.status).toBe(400);
  });

  test('same idempotency key twice -> one payment, one decrement', async () => {
    const key = `idem-${Date.now()}`;
    const first = await request(app)
      .post('/api/payments')
      .set(coAuth())
      .send({ userId: merchantId, amount: 1000, method: 'pos', idempotencyKey: key });
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);

    const second = await request(app)
      .post('/api/payments')
      .set(coAuth())
      .send({ userId: merchantId, amount: 1000, method: 'pos', idempotencyKey: key });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);

    const today = await request(app).get('/api/today').set(coAuth());
    const merchant = today.body.find((m) => m.id === merchantId);
    // 20000 disbursed - exactly one 1000 payment
    expect(merchant.balance).toBe(19000);
  });

  // --- Status lifecycle ---

  test('CO cannot change user status -> 403', async () => {
    const res = await request(app)
      .patch(`/api/users/${merchantId}/status`)
      .set(coAuth())
      .send({ status: 'deactivated' });
    expect(res.status).toBe(403);
  });

  test('admin deactivation removes the user from /api/today', async () => {
    const res = await request(app)
      .patch(`/api/users/${merchantId}/status`)
      .set(adminAuth())
      .send({ status: 'deactivated' });
    expect(res.status).toBe(200);

    const today = await request(app).get('/api/today').set(coAuth());
    expect(today.body.find((m) => m.id === merchantId)).toBeUndefined();
  });

  test('status only accepts active/deactivated -> 400', async () => {
    const res = await request(app)
      .patch(`/api/users/${merchantId}/status`)
      .set(adminAuth())
      .send({ status: 'vaporized' });
    expect(res.status).toBe(400);
  });
});
