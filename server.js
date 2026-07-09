import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import Database from 'better-sqlite3';
import pg from 'pg';
import { randomUUID, scryptSync, timingSafeEqual, createHmac } from 'crypto';
import { body, validationResult } from 'express-validator';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

// Lock CORS to an allowlist when ALLOWED_ORIGINS is set (comma-separated).
// The native mobile client sends no Origin header, so it is unaffected; this
// only constrains browser-based callers (the web dashboard). Defaults to open
// when unset so local/dev and the bundled static web app keep working.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors(
    allowedOrigins.length > 0
      ? {
          origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
          }
        }
      : undefined
  )
);
app.use(express.json());

// Serve static files from the Vite build directory
app.use(express.static(path.join(__dirname, 'dist')));

// --- DATABASE LAYER ---
const isPostgres = !!process.env.DATABASE_URL;
let pool;
let sqlite;

if (isPostgres) {
  // SSL is required by managed providers like Render (default on). Set
  // PGSSL=disable for a non-SSL Postgres (local/self-hosted) instead of failing
  // with "The server does not support SSL connections".
  const useSsl = process.env.PGSSL !== 'disable';
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false
  });
  console.log('Connected to PostgreSQL');
} else {
  sqlite = new Database('rill.db');
  sqlite.pragma('journal_mode = WAL');
  console.log('Connected to SQLite');
}

async function query(sql, params = []) {
  if (isPostgres) {
    let count = 0;
    const finalSql = sql.replace(/\?/g, () => `$${++count}`);
    const res = await pool.query(finalSql, params);
    return { rows: res.rows };
  } else {
    const stmt = sqlite.prepare(sql);
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return { rows: stmt.all(...params) };
    } else {
      const info = stmt.run(...params);
      return { rows: [], info };
    }
  }
}

async function runTransaction(queries) {
  if (isPostgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const q of queries) {
        let count = 0;
        const pgSql = q.sql.replace(/\?/g, () => `$${++count}`);
        await client.query(pgSql, q.params);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } else {
    const transact = sqlite.transaction((qs) => {
      for (const q of qs) {
        sqlite.prepare(q.sql).run(...q.params);
      }
    });
    transact(queries);
  }
}

function hashPassword(password) {
  const salt = randomUUID();
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

function isHashedPassword(password) {
  return typeof password === 'string' && password.startsWith('scrypt$');
}

function verifyPassword(password, storedPassword) {
  if (!isHashedPassword(storedPassword)) {
    return password === storedPassword;
  }

  const [, salt, storedHash] = storedPassword.split('$');
  const derivedBuffer = scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(storedHash, 'hex');
  return storedBuffer.length === derivedBuffer.length && timingSafeEqual(storedBuffer, derivedBuffer);
}

// --- AUTH TOKENS (dependency-free, HMAC-signed) ---
// In production AUTH_SECRET must be set; otherwise a per-process random secret
// is used (tokens stay valid for the life of the process, which is acceptable
// for a single instance and fails safe by invalidating on restart).
const AUTH_SECRET = process.env.AUTH_SECRET || randomUUID();
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function createAuthToken(officer) {
  return signToken({
    sub: officer.id,
    email: officer.email,
    role: officer.role || 'co',
    exp: Date.now() + TOKEN_TTL_MS
  });
}

function verifyAuthToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyAuthToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  req.officer = payload;
  next();
};

// Role check on top of requireAuth. The role lives in the signed token payload,
// so it cannot be forged client-side. Admin tokens are minted only via the
// Supplya admin-login proxy (or a future admin-provisioning path) — Rill has no
// self-service route to an admin role.
const requireRole = (role) => (req, res, next) => {
  if (req.officer?.role !== role) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Fixed-window rate limiter for the auth routes (brute-force guard).
// Dependency-free and in-memory: fine for a single instance; revisit if Rill
// ever runs multiple instances behind a load balancer.
const authAttempts = new Map(); // ip -> { count, windowStart }
const AUTH_RATE_WINDOW_MS = 10 * 60 * 1000;

const authRateLimit = (req, res, next) => {
  const limit = Number(process.env.AUTH_RATE_LIMIT || 30);
  const now = Date.now();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  // Lazy pruning keeps the map bounded.
  if (authAttempts.size > 10000) {
    for (const [key, value] of authAttempts) {
      if (now - value.windowStart > AUTH_RATE_WINDOW_MS) authAttempts.delete(key);
    }
  }
  const entry = authAttempts.get(ip);
  if (!entry || now - entry.windowStart > AUTH_RATE_WINDOW_MS) {
    authAttempts.set(ip, { count: 1, windowStart: now });
    return next();
  }
  entry.count += 1;
  if (entry.count > limit) {
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
  next();
};

// Initialize Schema
const initDb = async () => {
  const schema = `
    CREATE TABLE IF NOT EXISTS officers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      role TEXT DEFAULT 'co',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      location TEXT NOT NULL,
      group_id TEXT,
      total_owed INTEGER DEFAULT 0,
      balance INTEGER DEFAULT 0,
      daily_installment INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      last_payment_date TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL,
      officer_id TEXT NOT NULL,
      idempotency_key TEXT,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS disbursements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      daily_installment INTEGER NOT NULL,
      officer_id TEXT NOT NULL,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mood TEXT,
      stock_level TEXT,
      traffic TEXT,
      notes TEXT,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS escalations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `;
  if (isPostgres) {
    await pool.query(schema);
    await migratePostgresTimestamps();
  } else {
    sqlite.exec(schema);
  }
  await migrateSchemaAdditions();
};

// Columns added after first deploy. CREATE TABLE IF NOT EXISTS does not alter
// existing tables, so pre-existing databases (SQLite file or live Postgres)
// need explicit, idempotent ALTERs. Same pattern as migratePostgresTimestamps:
// check first, alter only when missing, never fail the boot on one column.
async function migrateSchemaAdditions() {
  const additions = [
    ['officers', 'role', "TEXT DEFAULT 'co'"],
    ['payments', 'idempotency_key', 'TEXT']
  ];
  for (const [table, column, type] of additions) {
    try {
      if (isPostgres) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
      } else {
        const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
        if (!cols.some((c) => c.name === column)) {
          sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        }
      }
    } catch (err) {
      console.error(`Schema addition skipped for ${table}.${column}:`, err.message);
    }
  }
  // Unique index enforces idempotency even under concurrent duplicates.
  // Both SQLite and Postgres allow multiple NULLs in a unique index, so
  // legacy rows (no key) are unaffected.
  try {
    await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key ON payments(idempotency_key)');
  } catch (err) {
    console.error('Idempotency index creation skipped:', err.message);
  }
}

// Existing Postgres databases created before the TIMESTAMPTZ change still have
// `timestamp without time zone` columns (CREATE TABLE IF NOT EXISTS does not
// alter them). Convert any that remain so the /api/today date math is correct.
// Idempotent and safe to run on every boot: it only touches columns whose type
// is still `timestamp without time zone`, so once converted it is a no-op and
// cannot double-shift values. The naive values are interpreted as UTC: the app
// writes payment timestamps as UTC ISO strings (Postgres strips the `Z` when
// storing into a tz-less column, keeping the UTC wall-clock), and Render's DB
// session is UTC so the CURRENT_TIMESTAMP defaults are UTC too. Verified
// end-to-end against Postgres 16 under UTC, America/New_York and Asia/Kolkata
// sessions — the absolute instant is preserved in every case.
const TIMESTAMP_COLUMNS = [
  ['officers', 'created_at'],
  ['users', 'created_at'],
  ['payments', 'timestamp'],
  ['audits', 'timestamp'],
  ['escalations', 'timestamp']
];

async function migratePostgresTimestamps() {
  for (const [table, column] of TIMESTAMP_COLUMNS) {
    try {
      const { rows } = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2`,
        [table, column]
      );
      if (rows[0]?.data_type === 'timestamp without time zone') {
        await pool.query(
          `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TIMESTAMPTZ
           USING ${column} AT TIME ZONE 'UTC'`
        );
        console.log(`Migrated ${table}.${column} to TIMESTAMPTZ`);
      }
    } catch (err) {
      // Non-fatal: log and continue so a single column failure does not block
      // startup or poison the init promise.
      console.error(`Timestamp migration skipped for ${table}.${column}:`, err.message);
    }
  }
}

// Memoize the init promise, but if it rejects (e.g. DB unreachable at cold
// start) clear it so the NEXT request retries instead of every request being
// permanently poisoned by a single cached rejection.
let initDbPromise = null;
function ensureDbReady() {
  if (!initDbPromise) {
    initDbPromise = initDb().catch((err) => {
      initDbPromise = null;
      throw err;
    });
  }
  return initDbPromise;
}

// Kick off init eagerly without leaving an unhandled rejection at boot.
ensureDbReady().catch((err) => console.error('Initial DB init failed, will retry on first request:', err.message));

app.use(async (req, res, next) => {
  try {
    await ensureDbReady();
    next();
  } catch (err) {
    res.status(503).json({ error: 'Service initializing, please retry shortly' });
  }
});

// --- AI LAYER ---
const aiKey = process.env.GEMINI_API_KEY;
const ai = aiKey ? new GoogleGenAI({ apiKey: aiKey }) : null;
// Configurable so the model can be updated without a code change as Google
// retires older aliases. Defaults to a current, generally-available model.
const AI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

function safeJsonParse(text, fallback) {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const checkAi = (req, res, next) => {
  if (!ai) return res.status(503).json({ error: 'AI features temporarily unavailable' });
  next();
};

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// --- ENDPOINTS ---
app.get('/health', (req, res) => res.json({ status: 'ok', db: isPostgres ? 'postgres' : 'sqlite' }));

app.post('/api/auth/register', authRateLimit, [
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('firstName').notEmpty(),
  validate
], async (req, res) => {
  // Registration is invite-gated in production (REGISTRATION_INVITE_CODE set
  // via render.yaml). Without the gate, anyone who finds the URL could mint a
  // CO account and read/write the merchant book. When the env is unset (local
  // dev), registration stays open.
  const inviteGate = process.env.REGISTRATION_INVITE_CODE;
  if (inviteGate && req.body.inviteCode !== inviteGate) {
    return res.status(403).json({ error: 'A valid invite code is required to register' });
  }
  const { email, password, firstName, lastName } = req.body;
  const id = randomUUID();
  try {
    const passwordHash = hashPassword(password);
    // Self-registration always creates a CO. Admin authority comes only from
    // the Supplya admin-login proxy below — never from this route.
    await query('INSERT INTO officers (id, email, password, first_name, last_name, role) VALUES (?, ?, ?, ?, ?, ?)',
      [id, email, passwordHash, firstName, lastName, 'co']);
    const officer = { id, email, firstName, lastName, role: 'co' };
    res.json({ officer, token: createAuthToken(officer) });
  } catch (error) {
    res.status(400).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', authRateLimit, [
  body('email').isEmail(),
  body('password').notEmpty(),
  validate
], async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query('SELECT id, email, password, first_name as "firstName", last_name as "lastName", role FROM officers WHERE email = ?', [email]);
  const officer = rows[0];
  if (officer && verifyPassword(password, officer.password)) {
    if (!isHashedPassword(officer.password)) {
      await query('UPDATE officers SET password = ? WHERE id = ?', [hashPassword(password), officer.id]);
    }
    const { password: _, ...safeOfficer } = officer;
    res.json({ officer: safeOfficer, token: createAuthToken(safeOfficer) });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Admin sign-in delegates entirely to the existing Supplya backend — Rill
// stores no admin credentials and supplya-backend is not modified in any way
// (Rill acts as a plain API client). The password is forwarded exactly as
// received: never trim or transform passwords (supplya CLAUDE.md Rule 8).
const SUPPLYA_API_BASE = () =>
  process.env.SUPPLYA_API_BASE || 'https://supplya-backend-3t2x.onrender.com/api/v1';

app.post('/api/auth/admin-login', authRateLimit, [
  body('email').isEmail(),
  body('password').notEmpty(),
  validate
], async (req, res) => {
  const { email, password } = req.body;

  let upstream;
  try {
    const controller = new AbortController();
    // Render free-tier cold starts can take 30-60s.
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      upstream = await fetch(`${SUPPLYA_API_BASE()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return res.status(502).json({ error: 'Could not reach Supplya to verify credentials. Please retry.' });
  }

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data?.status || !data?.data) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Authority = the role Supplya's server asserts for these credentials.
  // Only the supplya "admin" role maps to Rill admin.
  if (data.data.role !== 'admin') {
    return res.status(403).json({ error: 'This account is not a Supplya admin' });
  }

  const officer = {
    id: `supplya:${data.data._id}`,
    email: data.data.email,
    firstName: data.data.firstName,
    lastName: data.data.lastName,
    role: 'admin'
  };
  res.json({ officer, token: createAuthToken(officer) });
});

app.get('/api/today', requireAuth, async (req, res) => {
  const { rows: users } = await query(`
    SELECT 
      id, name, phone, location, group_id as "groupId", 
      total_owed as "totalOwed", balance, daily_installment as "dailyInstallment", 
      status, last_payment_date as "lastPaymentDate",
      (SELECT MAX(timestamp) FROM payments WHERE user_id = users.id) as "lastPaymentTimestamp"
    FROM users 
    WHERE status != 'deactivated'
  `);
  
  const today = new Date();
  const merchants = users.map(u => {
    let internalStatus = 'on-track';
    if (u.balance > 0) {
      const lastPay = u.lastPaymentTimestamp ? new Date(u.lastPaymentTimestamp) : new Date(0);
      const diffHrs = (today.getTime() - lastPay.getTime()) / (1000 * 60 * 60);
      if (diffHrs > 48) internalStatus = 'urgent';
      else if (diffHrs > 24) internalStatus = 'at-risk';
    }
    return { ...u, internalStatus };
  });
  res.json(merchants);
});

app.get('/api/users/:id/history', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { rows: payments } = await query(
    'SELECT amount, method, timestamp FROM payments WHERE user_id = ? ORDER BY timestamp DESC',
    [id]
  );
  const { rows: audits } = await query(
    'SELECT mood, stock_level as "stockLevel", traffic, notes, timestamp FROM audits WHERE user_id = ? ORDER BY timestamp DESC',
    [id]
  );
  const { rows: disbursements } = await query(
    'SELECT amount, daily_installment as "dailyInstallment", timestamp FROM disbursements WHERE user_id = ? ORDER BY timestamp DESC',
    [id]
  );
  res.json({ payments, audits, disbursements });
});

app.post('/api/users', requireAuth, [
  body('name').notEmpty(),
  body('location').notEmpty(),
  validate
], async (req, res) => {
  const { name, phone, location, groupId } = req.body;
  const id = randomUUID();
  await query('INSERT INTO users (id, name, phone, location, group_id, status) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, phone ?? null, location, groupId || null, 'pending']);
  res.json({ id, name, status: 'pending' });
});

// Admin-only: put money on a merchant's book. This is the only path that
// increases total_owed/balance and the only path to status 'active'.
app.post('/api/disbursements', requireAuth, requireRole('admin'), [
  body('userId').notEmpty(),
  body('amount').isInt({ gt: 0 }),
  body('dailyInstallment').isInt({ gt: 0 }),
  validate
], async (req, res) => {
  const { userId, amount, dailyInstallment } = req.body;
  const { rows } = await query('SELECT id FROM users WHERE id = ?', [userId]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  await runTransaction([
    { sql: 'INSERT INTO disbursements (id, user_id, amount, daily_installment, officer_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      params: [id, userId, amount, dailyInstallment, req.officer.sub, timestamp] },
    { sql: "UPDATE users SET total_owed = total_owed + ?, balance = balance + ?, daily_installment = ?, status = 'active' WHERE id = ?",
      params: [amount, amount, dailyInstallment, userId] }
  ]);
  res.json({ success: true, id });
});

// Admin-only: full user list, including deactivated (unlike /api/today).
app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await query(`
    SELECT
      id, name, phone, location, group_id as "groupId",
      total_owed as "totalOwed", balance, daily_installment as "dailyInstallment",
      status, last_payment_date as "lastPaymentDate"
    FROM users ORDER BY name
  `);
  res.json(rows);
});

// Admin-only: escalation feed ("admin visibility" per RILL_SPEC §8).
app.get('/api/escalations', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await query(`
    SELECT e.id, e.user_id as "userId", u.name as "userName", e.reason, e.timestamp
    FROM escalations e LEFT JOIN users u ON u.id = e.user_id
    ORDER BY e.timestamp DESC
  `);
  res.json(rows);
});

// Admin-only: activate/deactivate a merchant.
app.patch('/api/users/:id/status', requireAuth, requireRole('admin'), [
  body('status').isIn(['active', 'deactivated']),
  validate
], async (req, res) => {
  const { rows } = await query('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  await query('UPDATE users SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  res.json({ success: true });
});

app.post('/api/payments', requireAuth, [
  body('userId').notEmpty(),
  body('amount').isInt({ gt: 0 }),
  body('method').optional().isIn(['cash', 'pos', 'transfer']),
  validate
], async (req, res) => {
  const { userId, amount, method, idempotencyKey } = req.body;
  // Trust the authenticated officer from the verified token, not a
  // client-supplied officerId (which could be spoofed). Fall back to the body
  // only if the token has no subject, for backward compatibility.
  const officerId = req.officer?.sub || req.body.officerId;
  if (!officerId) return res.status(400).json({ error: 'Missing officer identity' });

  // The ledger, not the client, is the authority on what can be collected.
  const { rows: users } = await query('SELECT id, balance FROM users WHERE id = ?', [userId]);
  const user = users[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (amount > Number(user.balance)) {
    return res.status(400).json({ error: 'Amount exceeds outstanding balance' });
  }

  // Idempotency: a retry of a request that already succeeded (e.g. the client
  // timed out after the server committed) must not decrement the balance a
  // second time. Fast path checks for an existing record; the unique index on
  // idempotency_key closes the concurrent-duplicate race below.
  if (idempotencyKey) {
    const { rows: existing } = await query('SELECT id FROM payments WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing[0]) return res.json({ success: true, id: existing[0].id, duplicate: true });
  }

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  try {
    await runTransaction([
      { sql: 'INSERT INTO payments (id, user_id, amount, method, officer_id, timestamp, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [id, userId, amount, method || 'cash', officerId, timestamp, idempotencyKey ?? null] },
      { sql: 'UPDATE users SET balance = balance - ?, last_payment_date = ? WHERE id = ?',
        params: [amount, timestamp.split('T')[0], userId] }
    ]);
  } catch (err) {
    // Concurrent duplicate hit the unique index: surface the original result.
    if (idempotencyKey && /unique|duplicate/i.test(err.message || '')) {
      const { rows: existing } = await query('SELECT id FROM payments WHERE idempotency_key = ?', [idempotencyKey]);
      if (existing[0]) return res.json({ success: true, id: existing[0].id, duplicate: true });
    }
    throw err;
  }
  res.json({ success: true, id });
});

app.post('/api/audits', requireAuth, [body('userId').notEmpty(), validate], async (req, res) => {
  const { userId, mood, stockLevel, traffic, notes } = req.body;
  const id = randomUUID();
  await query('INSERT INTO audits (id, user_id, mood, stock_level, traffic, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, mood ?? null, stockLevel ?? null, traffic ?? null, notes ?? null]);
  res.json({ success: true, id });
});

app.post('/api/escalations', requireAuth, [body('userId').notEmpty(), body('reason').notEmpty(), validate], async (req, res) => {
  const { userId, reason } = req.body;
  const id = randomUUID();
  await query('INSERT INTO escalations (id, user_id, reason) VALUES (?, ?, ?)', [id, userId, reason]);
  res.json({ success: true, id });
});

// AI endpoints require auth: they spend Gemini quota. The mobile app already
// sends its bearer token; the admin console sends its own after login.
app.post('/api/optimize-route', requireAuth, checkAi, async (req, res) => {
    const { merchants } = req.body;
    const prompt = `As a Nigerian Credit Risk Specialist for Rill, optimize the collection route for today. 
Merchants: ${JSON.stringify(merchants)}. 
Priority to 'urgent' and 'at-risk' merchants. 
Also consider 'highest balance owed' and 'longest time since last payment' as secondary priority factors.
Output JSON with prioritizedIds and reasoning.`;
    const response = await ai.models.generateContent({
      model: AI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            prioritizedIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            reasoning: { type: Type.STRING }
          },
          required: ['prioritizedIds', 'reasoning']
        }
      }
    });
    // Guard against malformed/blocked model output so the client always gets a
    // usable shape instead of a 500 from a thrown JSON.parse.
    const parsed = safeJsonParse(response.text, { prioritizedIds: [], reasoning: '' });
    res.json({
      prioritizedIds: Array.isArray(parsed.prioritizedIds) ? parsed.prioritizedIds : [],
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : ''
    });
});

app.post('/api/rebuttal', requireAuth, checkAi, async (req, res) => {
    const { merchantName, excuse } = req.body;
    const prompt = `Merchant ${merchantName} says: "${excuse}". Firm professional rebuttal, < 3 sentences, calm accountability.`;
    const response = await ai.models.generateContent({
      model: AI_MODEL,
      contents: prompt
    });
    res.json({ text: response.text || '' });
});

app.post('/api/risk-briefing', requireAuth, checkAi, async (req, res) => {
    const { logs, merchants } = req.body;
    const prompt = `Summarize the day's field activity for the Head of Credit.
Field Logs: ${JSON.stringify(logs)}
Merchant Status: ${JSON.stringify(merchants)}
Provide a 3-sentence risk briefing highlighting any behavioral shifts or cluster-level trends.`;

    const response = await ai.models.generateContent({
      model: AI_MODEL,
      contents: prompt
    });
    res.json({ text: response.text || '' });
});

app.use((err, req, res, next) => {
  // Full detail server-side only; internals (paths, SQL, stack hints) must
  // never reach a client.
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => console.log(`Rill Production API running on port ${PORT}`));
}

export default app;
