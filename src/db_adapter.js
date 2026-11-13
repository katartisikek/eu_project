// ==============================================================================
// Database Adapter: Transparent Support for Supabase PostgreSQL & Local SQLite
// Technical Schools of the Chamber of Heraklion (TIHC)
// ==============================================================================

const fs = require('node:fs');
const path = require('node:path');

const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';
const isPostgres = Boolean(DATABASE_URL);

let sqliteDb = null;
let pgPool = null;

if (isPostgres) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: DATABASE_URL,
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

module.exports = {
  db,
  isPostgres,
  toPgSql
};

