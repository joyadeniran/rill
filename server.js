import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import Database from 'better-sqlite3';
import pg from 'pg';
import { randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { body, validationResult } from 'express-validator';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the Vite build directory
app.use(express.static(path.join(__dirname, 'dist')));

// --- DATABASE LAYER ---
const isPostgres = !!process.env.DATABASE_URL;
let pool;
let sqlite;

if (isPostgres) {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
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

// Initialize Schema
const initDb = async () => {
  const schema = `
    CREATE TABLE IF NOT EXISTS officers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL,
      officer_id TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mood TEXT,
      stock_level TEXT,
      traffic TEXT,
      notes TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS escalations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  if (isPostgres) {
    await pool.query(schema);
  } else {
    sqlite.exec(schema);
  }
};

const initDbPromise = initDb();

app.use(async (req, res, next) => {
  await initDbPromise;
  next();
});

// --- AI LAYER ---
const aiKey = process.env.GEMINI_API_KEY;
const ai = aiKey ? new GoogleGenAI({ apiKey: aiKey }) : null;

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

app.post('/api/auth/register', [
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('firstName').notEmpty(),
  validate
], async (req, res) => {
  const { email, password, firstName, lastName } = req.body;
  const id = randomUUID();
  try {
    const passwordHash = hashPassword(password);
    await query('INSERT INTO officers (id, email, password, first_name, last_name) VALUES (?, ?, ?, ?, ?)', 
      [id, email, passwordHash, firstName, lastName]);
    res.json({ officer: { id, email, firstName, lastName } });
  } catch (error) {
    res.status(400).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query('SELECT id, email, password, first_name as "firstName", last_name as "lastName" FROM officers WHERE email = ?', [email]);
  const officer = rows[0];
  if (officer && verifyPassword(password, officer.password)) {
    if (!isHashedPassword(officer.password)) {
      await query('UPDATE officers SET password = ? WHERE id = ?', [hashPassword(password), officer.id]);
    }
    const { password: _, ...safeOfficer } = officer;
    res.json({ officer: safeOfficer });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/today', async (req, res) => {
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

app.post('/api/users', [
  body('name').notEmpty(),
  body('location').notEmpty(),
  validate
], async (req, res) => {
  const { name, phone, location, groupId } = req.body;
  const id = randomUUID();
  await query('INSERT INTO users (id, name, phone, location, group_id, status) VALUES (?, ?, ?, ?, ?, ?)', 
    [id, name, phone, location, groupId || null, 'pending']);
  res.json({ id, name, status: 'pending' });
});

app.post('/api/payments', [
  body('userId').notEmpty(),
  body('amount').isNumeric(),
  body('officerId').notEmpty(),
  validate
], async (req, res) => {
  const { userId, amount, method, officerId } = req.body;
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  await runTransaction([
    { sql: 'INSERT INTO payments (id, user_id, amount, method, officer_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)', 
      params: [id, userId, amount, method || 'cash', officerId, timestamp] },
    { sql: 'UPDATE users SET balance = balance - ?, last_payment_date = ? WHERE id = ?', 
      params: [amount, timestamp.split('T')[0], userId] }
  ]);
  res.json({ success: true, id });
});

app.post('/api/audits', [body('userId').notEmpty(), validate], async (req, res) => {
  const { userId, mood, stockLevel, traffic, notes } = req.body;
  const id = randomUUID();
  await query('INSERT INTO audits (id, user_id, mood, stock_level, traffic, notes) VALUES (?, ?, ?, ?, ?, ?)', 
    [id, userId, mood, stockLevel, traffic, notes]);
  res.json({ success: true, id });
});

app.post('/api/escalations', [body('userId').notEmpty(), body('reason').notEmpty(), validate], async (req, res) => {
  const { userId, reason } = req.body;
  const id = randomUUID();
  await query('INSERT INTO escalations (id, user_id, reason) VALUES (?, ?, ?)', [id, userId, reason]);
  res.json({ success: true, id });
});

app.post('/api/optimize-route', checkAi, async (req, res) => {
    const { merchants } = req.body;
    const prompt = `As a Nigerian Credit Risk Specialist for Rill, optimize the collection route for today. 
Merchants: ${JSON.stringify(merchants)}. Priority to 'urgent' and 'at-risk'. Output JSON with prioritizedIds and reasoning.`;
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
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
    res.json(JSON.parse(response.text || '{}'));
});

app.post('/api/rebuttal', checkAi, async (req, res) => {
    const { merchantName, excuse } = req.body;
    const prompt = `Merchant ${merchantName} says: "${excuse}". Firm professional rebuttal, < 3 sentences, calm accountability.`;
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt
    });
    res.json({ text: response.text });
});

app.post('/api/risk-briefing', checkAi, async (req, res) => {
    const { logs, merchants } = req.body;
    const prompt = `Summarize the day's field activity for the Head of Credit.
Field Logs: ${JSON.stringify(logs)}
Merchant Status: ${JSON.stringify(merchants)}
Provide a 3-sentence risk briefing highlighting any behavioral shifts or cluster-level trends.`;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt
    });
    res.json({ text: response.text });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => console.log(`Rill Production API running on port ${PORT}`));
}

export default app;
