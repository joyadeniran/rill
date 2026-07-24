// The API's validation failures must be renderable by clients.
//
// Before this contract existed, `validate` responded with
// `{ errors: [ ...express-validator objects... ] }`, but every client
// (src/services/adminApi.ts and mobile/src/services/api.ts) reads `data.error`
// — a single string. A 400 therefore rendered as the useless generic
// "Request failed (400)" with no indication of WHICH field was wrong. That is
// the "setting password returns 400 instead of field validation" bug.
//
// The contract every validated endpoint must now satisfy:
//   {
//     error:  "<human-readable summary>",   // always present, client-renderable
//     fields: { "<fieldName>": "<message>" } // per-field, for inline display
//   }
process.env.REGISTRATION_INVITE_CODE = 'test-invite';
process.env.SUPPLYA_API_BASE = 'https://supplya.test/api/v1';

import request from 'supertest';
import app from './server.js';

const INVITE = { inviteCode: 'test-invite' };

/** Every validation failure must carry a renderable summary + field map. */
function expectValidationShape(res) {
  expect(res.status).toBe(400);
  expect(typeof res.body.error).toBe('string');
  expect(res.body.error.length).toBeGreaterThan(0);
  // Must NOT be a bare generic — it has to name the problem.
  expect(res.body.error).not.toMatch(/^Request failed/i);
  expect(res.body.fields).toBeDefined();
  expect(typeof res.body.fields).toBe('object');
}

describe('Validation error contract', () => {
  let token;

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: `vc-${Date.now()}@rill.com`,
      password: 'password123',
      firstName: 'Val',
      lastName: 'Contract',
      ...INVITE
    });
    token = res.body.token;
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  describe('register', () => {
    test('short password names the password field (the reported bug)', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: `short-${Date.now()}@rill.com`,
        password: '123',
        firstName: 'A',
        lastName: 'B',
        ...INVITE
      });
      expectValidationShape(res);
      expect(res.body.fields.password).toBeDefined();
      // The message must be actionable, i.e. state the requirement.
      expect(res.body.fields.password).toMatch(/6/);
    });

    test('invalid email names the email field', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'not-an-email',
        password: 'password123',
        firstName: 'A',
        ...INVITE
      });
      expectValidationShape(res);
      expect(res.body.fields.email).toBeDefined();
    });

    test('missing firstName names the firstName field', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: `nf-${Date.now()}@rill.com`,
        password: 'password123',
        ...INVITE
      });
      expectValidationShape(res);
      expect(res.body.fields.firstName).toBeDefined();
    });

    test('multiple bad fields are all reported at once', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'bad', password: '1', ...INVITE });
      expectValidationShape(res);
      expect(Object.keys(res.body.fields).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('login', () => {
    test('missing password is a field error, not a generic 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'someone@rill.com' });
      expectValidationShape(res);
      expect(res.body.fields.password).toBeDefined();
    });
  });

  describe('create user', () => {
    test('missing required name/location are named', async () => {
      const res = await request(app).post('/api/users').set(auth()).send({ phone: '080' });
      expectValidationShape(res);
      expect(res.body.fields.name || res.body.fields.location).toBeDefined();
    });
  });

  describe('payments', () => {
    test('missing idempotencyKey is named, not generic', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set(auth())
        .send({ userId: 'nope', amount: 100, method: 'cash' });
      expectValidationShape(res);
      expect(res.body.fields.idempotencyKey).toBeDefined();
    });

    test('non-numeric amount is named', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set(auth())
        .send({ userId: 'nope', amount: 'lots', method: 'cash', idempotencyKey: 'k1' });
      expectValidationShape(res);
      expect(res.body.fields.amount).toBeDefined();
    });

    test('invalid method is named', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set(auth())
        .send({ userId: 'nope', amount: 100, method: 'crypto', idempotencyKey: 'k2' });
      expectValidationShape(res);
      expect(res.body.fields.method).toBeDefined();
    });
  });

  describe('backwards compatibility', () => {
    test('legacy `errors` array is still present for any existing consumer', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nope' });
      expect(res.status).toBe(400);
      expect(Array.isArray(res.body.errors)).toBe(true);
    });
  });
});
