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
      balance_cents INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_account INTEGER,
      to_account INTEGER,
      amount_cents INTEGER,
      status TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
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
