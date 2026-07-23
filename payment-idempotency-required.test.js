/**
 * payment-idempotency-required.test.js
 *
 * F20: idempotencyKey on POST /api/payments was optional. The existing
 * idempotency logic (server.test.js: "same idempotency key twice") only
 * protects a retry that DOES send a key — a client that sends no key at all
 * (or retries with no key both times) gets zero double-payment protection,
 * since SQL UNIQUE indexes don't treat multiple NULLs as conflicting.
 *
 * The mobile client (mobile/src/services/api.ts) already types
 * idempotencyKey as a required (non-optional) field and always sends one
 * (mobile/src/components/FieldOfficerApp.tsx) — enforcing it server-side is
 * a safe tightening, not a breaking change for the real client.
 */
process.env.REGISTRATION_INVITE_CODE = 'test-invite';

import request from 'supertest';
import app from './server.js';
import { jest } from '@jest/globals';

const INVITE = { inviteCode: 'test-invite' };

describe('POST /api/payments — idempotencyKey is required', () => {
  let token;
  let merchantId;
  const realFetch = global.fetch;

  beforeAll(async () => {
    const email = `idem-required-${Date.now()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'password123', firstName: 'Idem', lastName: 'Test', ...INVITE });
    token = reg.body.token;

    const userRes = await request(app)
      .post('/api/users')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: 'Idem Merchant', location: 'Lagos' });
    merchantId = userRes.body.id;

    // Disbursements are admin-only (see server.test.js's admin-login pattern) —
    // mock the Supplya proxy login to mint an admin token for setup.
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: { _id: 'sup-idem', email: 'boss@supplya.shop', firstName: 'A', lastName: 'B', role: 'admin' },
      }),
    }));
    const adminLogin = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'boss@supplya.shop', password: 'secretpass' });
    const adminToken = adminLogin.body.token;
    global.fetch = realFetch;

    await request(app)
      .post('/api/disbursements')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ userId: merchantId, amount: 5000, dailyInstallment: 500 });
  });

  test('a payment with no idempotencyKey is rejected (400)', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set({ Authorization: `Bearer ${token}` })
      .send({ userId: merchantId, amount: 100, method: 'cash' });
    expect(res.status).toBe(400);
  });

  test('a payment with an empty-string idempotencyKey is rejected (400)', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set({ Authorization: `Bearer ${token}` })
      .send({ userId: merchantId, amount: 100, method: 'cash', idempotencyKey: '' });
    expect(res.status).toBe(400);
  });

  test('a payment with a valid idempotencyKey succeeds', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set({ Authorization: `Bearer ${token}` })
      .send({ userId: merchantId, amount: 100, method: 'cash', idempotencyKey: `key-${Date.now()}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
