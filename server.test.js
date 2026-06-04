import request from 'supertest';
import app from './server.js';
import { jest } from '@jest/globals';

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
        lastName: 'Officer'
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

  test('POST /api/payments should log a payment and update balance', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set(auth())
      .send({
        userId,
        amount: 1000,
        officerId,
        method: 'cash'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
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
      .send({ email, password: 'password123', firstName: 'Log', lastName: 'In' });
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
