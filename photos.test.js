// Field photo evidence.
//
// A CO needs to attach pictures to what he records: the shopfront during an
// environmental audit, a POS receipt against a payment, proof of stock levels.
// Admins and lenders need to see that evidence in the console.
//
// Photos are stored as base64 in Postgres. That is a deliberate MVP tradeoff
// (no object store is provisioned), which is exactly why the size cap and MIME
// allowlist below are load-bearing rather than cosmetic.
process.env.REGISTRATION_INVITE_CODE = 'test-invite';
process.env.SUPPLYA_API_BASE = 'https://supplya.test/api/v1';

import request from 'supertest';
import app, { signTokenForTest } from './server.js';

const INVITE = { inviteCode: 'test-invite' };
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const tokenFor = (role, id = `${role}-ph-id`) =>
  signTokenForTest({ sub: id, email: `${role}@rill.test`, role, exp: Date.now() + 60000 });

// Smallest valid PNG (1x1 transparent), as a data URL.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('Photo capture', () => {
  let coToken, adminToken, lenderToken, merchantId;

  beforeAll(async () => {
    adminToken = tokenFor('admin');
    lenderToken = tokenFor('lender');
    const reg = await request(app).post('/api/auth/register').send({
      email: `co-photo-${Date.now()}@rill.com`,
      password: 'password123',
      firstName: 'Photo',
      lastName: 'Officer',
      ...INVITE
    });
    coToken = reg.body.token;

    const m = await request(app)
      .post('/api/users')
      .set(bearer(coToken))
      .send({ name: 'Photo Merchant', location: 'Ojota' });
    merchantId = m.body.id;
  });

  describe('upload', () => {
    test('a CO can attach a photo to a merchant', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: merchantId, kind: 'audit', dataUrl: TINY_PNG, caption: 'Shopfront' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      // The raw image must not be echoed back in the create response.
      expect(res.body.dataUrl).toBeUndefined();
    });

    test('an admin can attach a photo', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(adminToken))
        .send({ userId: merchantId, kind: 'merchant', dataUrl: TINY_PNG });
      expect(res.status).toBe(200);
    });

    test('a lender cannot attach photos (read-only)', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(lenderToken))
        .send({ userId: merchantId, kind: 'audit', dataUrl: TINY_PNG });
      expect(res.status).toBe(403);
    });

    test('unauthenticated upload is rejected', async () => {
      const res = await request(app)
        .post('/api/photos')
        .send({ userId: merchantId, kind: 'audit', dataUrl: TINY_PNG });
      expect(res.status).toBe(401);
    });
  });

  describe('validation and edge cases', () => {
    test('unknown merchant is a field error', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: 'no-such-merchant', kind: 'audit', dataUrl: TINY_PNG });
      expect(res.status).toBe(400);
      expect(res.body.fields.userId).toBeDefined();
    });

    test('missing image is a field error', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: merchantId, kind: 'audit' });
      expect(res.status).toBe(400);
      expect(res.body.fields.dataUrl).toBeDefined();
    });

    test('a non-image data URL is rejected', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({
          userId: merchantId,
          kind: 'audit',
          dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK'
        });
      expect(res.status).toBe(400);
      expect(res.body.fields.dataUrl).toBeDefined();
    });

    test('a malformed data URL is rejected, not crashed on', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: merchantId, kind: 'audit', dataUrl: 'totally-not-a-data-url' });
      expect(res.status).toBe(400);
      expect(res.body.fields.dataUrl).toBeDefined();
    });

    test('invalid base64 payload is rejected', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: merchantId, kind: 'audit', dataUrl: 'data:image/png;base64,!!!not-base64!!!' });
      expect(res.status).toBe(400);
      expect(res.body.fields.dataUrl).toBeDefined();
    });

    test('an invalid kind is rejected', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: merchantId, kind: 'blackmail', dataUrl: TINY_PNG });
      expect(res.status).toBe(400);
      expect(res.body.fields.kind).toBeDefined();
    });

    test('an oversized image is rejected with a clear message', async () => {
      // ~4MB of base64 — over the per-photo cap.
      const huge = 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024);
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: merchantId, kind: 'audit', dataUrl: huge });
      expect([400, 413]).toContain(res.status);
      expect(res.body.error).toMatch(/large|size|big/i);
    });

    test('an over-long caption is rejected', async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: merchantId, kind: 'audit', dataUrl: TINY_PNG, caption: 'x'.repeat(500) });
      expect(res.status).toBe(400);
      expect(res.body.fields.caption).toBeDefined();
    });
  });

  describe('listing and retrieval', () => {
    let photoId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: merchantId, kind: 'payment', dataUrl: TINY_PNG, caption: 'Receipt' });
      photoId = res.body.id;
    });

    test('photos for a merchant are listed WITHOUT the image blobs', async () => {
      const res = await request(app).get(`/api/users/${merchantId}/photos`).set(bearer(coToken));
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      // Listing must stay light — blobs are fetched one at a time.
      for (const p of res.body) {
        expect(p.dataUrl).toBeUndefined();
        expect(p.id).toBeDefined();
        expect(p.kind).toBeDefined();
      }
    });

    test('a lender can view evidence', async () => {
      const res = await request(app).get(`/api/users/${merchantId}/photos`).set(bearer(lenderToken));
      expect(res.status).toBe(200);
    });

    test('a single photo returns the actual image bytes', async () => {
      const res = await request(app).get(`/api/photos/${photoId}`).set(bearer(coToken));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/png/);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('an unknown photo id returns 404, not a crash', async () => {
      const res = await request(app).get('/api/photos/no-such-photo').set(bearer(coToken));
      expect(res.status).toBe(404);
    });

    test('photos require authentication to view', async () => {
      const res = await request(app).get(`/api/photos/${photoId}`);
      expect(res.status).toBe(401);
    });
  });

  describe('cascade', () => {
    test('photos are removed when their merchant is deleted', async () => {
      const m = await request(app)
        .post('/api/users')
        .set(bearer(coToken))
        .send({ name: 'Cascade Merchant', location: 'Agege' });
      await request(app)
        .post('/api/photos')
        .set(bearer(coToken))
        .send({ userId: m.body.id, kind: 'audit', dataUrl: TINY_PNG });

      const before = await request(app).get(`/api/users/${m.body.id}/photos`).set(bearer(adminToken));
      expect(before.body.length).toBe(1);

      const del = await request(app).delete(`/api/users/${m.body.id}`).set(bearer(adminToken));
      expect(del.status).toBe(200);

      const after = await request(app).get(`/api/users/${m.body.id}/photos`).set(bearer(adminToken));
      expect(after.body.length).toBe(0);
    });
  });
});
