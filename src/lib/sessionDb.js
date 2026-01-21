const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const cache = new Map();

async function getSessionDb(sessionId) {
  if (!sessionId) throw new Error('sessionId required');
  if (cache.has(sessionId)) return cache.get(sessionId);
  const file = path.join(SESSIONS_DIR, `session_${sessionId}.db`);
  const dbPromise = open({ filename: file, driver: sqlite3.Database });
  const db = await dbPromise;
  // initialize schema for bank
  await db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_name TEXT,
      account_number TEXT UNIQUE,
      status TEXT DEFAULT 'active',
      balance_cents INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_account INTEGER,
      to_account INTEGER,
      from_account_number TEXT,
      to_account_number TEXT,
      amount_cents INTEGER,
      status TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // backfill/migrate older session DBs that may lack new columns
  try {
    const accCols = await db.all("PRAGMA table_info(accounts)");
    const accColNames = accCols.map(c => c.name);
    if (!accColNames.includes('account_number')) {
      await db.exec('ALTER TABLE accounts ADD COLUMN account_number TEXT');
    }
      if (!accColNames.includes('status')) {
        await db.exec("ALTER TABLE accounts ADD COLUMN status TEXT DEFAULT 'active'");
      }
    const txCols = await db.all("PRAGMA table_info(transactions)");
    const txColNames = txCols.map(c => c.name);
    if (!txColNames.includes('from_account_number')) {
      await db.exec('ALTER TABLE transactions ADD COLUMN from_account_number TEXT');
    }
    if (!txColNames.includes('to_account_number')) {
      await db.exec('ALTER TABLE transactions ADD COLUMN to_account_number TEXT');
    }
    // populate account_number for existing accounts if missing (use id-based fallback)
    await db.run(`UPDATE accounts SET account_number = (10000000 + id) WHERE account_number IS NULL OR account_number = ''`);
  // ensure status has a sensible default for older DBs
  await db.run(`UPDATE accounts SET status = 'active' WHERE status IS NULL OR status = ''`);
    // populate transaction account numbers from accounts table where missing
    await db.run(`UPDATE transactions SET from_account_number = (SELECT account_number FROM accounts WHERE accounts.id = transactions.from_account) WHERE from_account_number IS NULL OR from_account_number = ''`);
    await db.run(`UPDATE transactions SET to_account_number = (SELECT account_number FROM accounts WHERE accounts.id = transactions.to_account) WHERE to_account_number IS NULL OR to_account_number = ''`);
  } catch (e) {
    // migration best-effort, non-fatal
    try { console.warn('session DB migration warning:', e && e.message); } catch (e2) {}
  }
  cache.set(sessionId, db);
  return db;
}

async function deleteSessionDb(sessionId) {
  if (!sessionId) throw new Error('sessionId required');
  if (!cache.has(sessionId)) {
    // try deleting file anyway
    const file = path.join(SESSIONS_DIR, `session_${sessionId}.db`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  const db = cache.get(sessionId);
  try {
    await db.close();
  } catch (e) {}
  cache.delete(sessionId);
  const file = path.join(SESSIONS_DIR, `session_${sessionId}.db`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { getSessionDb, deleteSessionDb };
