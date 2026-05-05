import Database from 'better-sqlite3';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const isPostgres = !!process.env.DATABASE_URL;
let db;

if (isPostgres) {
  const { Pool } = pg;
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('Connected to PostgreSQL');
} else {
  const sqlite = new Database('rill.db');
  sqlite.pragma('journal_mode = WAL');
  db = {
    prepare: (sql) => {
      const stmt = sqlite.prepare(sql);
      return {
        run: (...args) => stmt.run(...args),
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
      };
    },
    exec: (sql) => sqlite.exec(sql),
    transaction: (fn) => sqlite.transaction(fn)
  };
  console.log('Connected to SQLite');
}

export const query = async (sql, params = []) => {
  if (isPostgres) {
    const res = await db.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
    return res;
  } else {
    // For SQLite, we adapt the API to be slightly more async-friendly where possible, 
    // though better-sqlite3 is sync.
    const stmt = sqlite_prepare_adapter(sql);
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return { rows: stmt.all(...params) };
    } else {
      return stmt.run(...params);
    }
  }
};

// This is getting complicated to support both with the same exact syntax 
// for transactions and runs. Let's stick to a unified interface.

const sqlite_prepare_adapter = (sql) => {
  const sqlite = new Database('rill.db'); // Re-open or use global
  return sqlite.prepare(sql);
};

export default db;
