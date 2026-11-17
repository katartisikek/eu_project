// ==============================================================================
// Database Adapter: Transparent Support for Supabase PostgreSQL & Local SQLite
// Technical Schools of the Chamber of Heraklion (TIHC)
// ==============================================================================

const fs = require('node:fs');
const path = require('node:path');

const DATABASE_URL = process.env.DATABASE_URL ||
                     process.env.POSTGRES_URL ||
                     process.env.POSTGRES_PRISMA_URL ||
                     process.env.SUPABASE_DB_URL ||
                     '';
const isPostgres = Boolean(DATABASE_URL);

let sqliteDb = null;
let pgPool = null;

if (isPostgres) {
  // Supabase uses connection poolers where Node.js TLS requires accepting self-signed chain certs
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  } catch (e) {}

  let sanitizedUrl = DATABASE_URL;
  if (sanitizedUrl.includes('sslmode=require')) {
    sanitizedUrl = sanitizedUrl.replace('sslmode=require', 'sslmode=no-verify');
  } else if (!sanitizedUrl.includes('sslmode=')) {
    sanitizedUrl += (sanitizedUrl.includes('?') ? '&' : '?') + 'sslmode=no-verify';
  }

  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: sanitizedUrl,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  console.log('[DB] Connected to Supabase PostgreSQL Cloud Database.');
} else {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    const DB_PATH = path.join(DATA_DIR, 'dissemination_platform.sqlite');
    if (!fs.existsSync(DATA_DIR)) {
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
    }
    sqliteDb = new DatabaseSync(DB_PATH);
    try {
      sqliteDb.exec('PRAGMA journal_mode = WAL;');
      sqliteDb.exec('PRAGMA foreign_keys = ON;');
    } catch (e) {}
    console.log('[DB] Connected to Local SQLite Database:', DB_PATH);
  } catch (err) {
    console.warn('[DB] SQLite is not available in this runtime environment (DATABASE_URL required for cloud).');
  }
}

// Convert SQLite '?' placeholders to PostgreSQL '$1, $2, ...'
function toPgSql(sql) {
  let paramIndex = 1;
  return sql
    .replace(/\?/g, () => `$${paramIndex++}`)
    .replace(/datetime\('now'\)/gi, 'NOW()');
}

const db = {
  isPostgres,
  pgPool,
  sqliteDb,

  prepare(sql) {
    if (isPostgres) {
      const pgSql = toPgSql(sql);
      return {
        async all(...params) {
          const flatParams = params.flat();
          const res = await pgPool.query(pgSql, flatParams);
          return res.rows;
        },
        async get(...params) {
          const flatParams = params.flat();
          const res = await pgPool.query(pgSql, flatParams);
          return res.rows[0] || null;
        },
        async run(...params) {
          const flatParams = params.flat();
          const res = await pgPool.query(pgSql, flatParams);
          return {
            changes: res.rowCount,
            lastInsertRowid: res.rows?.[0]?.id || 0
          };
        }
      };
    } else if (sqliteDb) {
      const stmt = sqliteDb.prepare(sql);
      return {
        all: (...params) => stmt.all(...params),
        get: (...params) => stmt.get(...params),
        run: (...params) => stmt.run(...params)
      };
    } else {
      return {
        all: async () => [],
        get: async () => null,
        run: async () => ({ changes: 0, lastInsertRowid: 0 })
      };
    }
  },

  async exec(sql) {
    if (isPostgres) {
      return await pgPool.query(sql);
    } else {
      return sqliteDb.exec(sql);
    }
  }
};

async function ensureSchema() {
  try {
    if (isPostgres && pgPool) {
      await pgPool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'APPROVED';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS gdpr_consent INTEGER DEFAULT 1;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_token TEXT;
      `);
    } else if (sqliteDb) {
      const cols = sqliteDb.prepare("PRAGMA table_info(users)").all().map(c => c.name);
      const add = (col, type) => {
        if (!cols.includes(col)) {
          try { sqliteDb.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`); } catch (e) {}
        }
      };
      add('first_name', 'TEXT');
      add('last_name', 'TEXT');
      add('job_title', 'TEXT');
      add('status', "TEXT DEFAULT 'APPROVED'");
      add('gdpr_consent', 'INTEGER DEFAULT 1');
      add('activation_token', 'TEXT');
    }
  } catch (err) {
    console.warn('[DB] Schema ensure notice:', err.message);
  }
}

ensureSchema();

module.exports = {
  db,
  isPostgres,
  toPgSql,
  ensureSchema
};

