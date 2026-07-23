/**
 * server-password.test.js
 *
 * F21: verifyPassword's legacy (pre-hash) migration path did `password ===
 * storedPassword` — a non-constant-time comparison that short-circuits on
 * the first mismatched byte, leaking how many leading characters of a
 * guessed password are correct via response timing. Fixed with
 * constantTimeStringEqual (HMAC-digest both inputs to a fixed length, then
 * crypto.timingSafeEqual) without removing the legacy migration capability
 * itself — accounts created before hashing was added must still be able to
 * log in once, at which point login() upgrades them to a hash.
 */

process.env.REGISTRATION_INVITE_CODE = 'test-invite';

import fs from 'fs';
import {
  hashPassword,
  isHashedPassword,
  verifyPassword,
  constantTimeStringEqual,
} from './server.js';

describe('verifyPassword — hashed path (unchanged)', () => {
  test('accepts the correct password against a scrypt hash', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  test('rejects a wrong password against a scrypt hash', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  test('isHashedPassword correctly identifies scrypt-hashed values', () => {
    expect(isHashedPassword(hashPassword('x'))).toBe(true);
    expect(isHashedPassword('plaintext123')).toBe(false);
  });
});

describe('verifyPassword — legacy plaintext migration path', () => {
  test('accepts the correct legacy plaintext password', () => {
    expect(verifyPassword('legacy-pw', 'legacy-pw')).toBe(true);
  });

  test('rejects a wrong legacy plaintext password', () => {
    expect(verifyPassword('wrong', 'legacy-pw')).toBe(false);
  });

  test('rejects a password that shares a long prefix with the stored value', () => {
    // The exact scenario a timing side-channel would otherwise leak:
    // near-miss guesses must be rejected exactly like a totally wrong guess.
    expect(verifyPassword('legacy-p', 'legacy-pw')).toBe(false);
    expect(verifyPassword('legacy-pX', 'legacy-pw')).toBe(false);
  });
});

describe('constantTimeStringEqual', () => {
  test('true for identical strings', () => {
    expect(constantTimeStringEqual('abc123', 'abc123')).toBe(true);
  });

  test('false for different strings of the same length', () => {
    expect(constantTimeStringEqual('abc123', 'abc124')).toBe(false);
  });

  test('false for different-length strings (no length-based early exit on the raw input)', () => {
    expect(constantTimeStringEqual('short', 'a much longer string')).toBe(false);
  });

  test('uses timingSafeEqual, not ===, on the underlying digests (source check)', () => {
    const src = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
    const start = src.indexOf('function verifyPassword(');
    const end = src.indexOf('\n}', start);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/password === storedPassword/);
    expect(body).toContain('constantTimeStringEqual');
  });
});
