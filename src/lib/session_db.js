const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');

function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

async function getSessionDb(sessionId) {
  ensureSessionsDir();
  const dbPath = path.join(SESSIONS_DIR, `session_${sessionId}.db`);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT,
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
  return db;
}

async function listAccounts(sessionId) {
  const db = await getSessionDb(sessionId);
  return db.all('SELECT * FROM accounts ORDER BY id');
}

async function createAccount(sessionId, owner, initialCents) {
  const db = await getSessionDb(sessionId);
  const res = await db.run('INSERT INTO accounts(owner,balance_cents) VALUES(?,?)', owner, initialCents);
  return db.get('SELECT * FROM accounts WHERE id = ?', res.lastID);
}

async function listTransactions(sessionId) {
  const db = await getSessionDb(sessionId);
  return db.all('SELECT * FROM transactions ORDER BY created_at DESC');
}

async function transfer(sessionId, fromId, toId, amountCents, note) {
  const db = await getSessionDb(sessionId);
  try {
    await db.exec('BEGIN TRANSACTION');
    const from = await db.get('SELECT * FROM accounts WHERE id = ?', fromId);
    const to = await db.get('SELECT * FROM accounts WHERE id = ?', toId);
    if (!from || !to) throw new Error('Account not found');
    if (from.balance_cents < amountCents) throw new Error('Insufficient funds');
    await db.run('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?', amountCents, fromId);
    await db.run('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?', amountCents, toId);
    const res = await db.run('INSERT INTO transactions(from_account,to_account,amount_cents,status,note) VALUES(?,?,?,?,?)', fromId, toId, amountCents, 'success', note);
    await db.exec('COMMIT');
    return db.get('SELECT * FROM transactions WHERE id = ?', res.lastID);
  } catch (err) {
    await db.exec('ROLLBACK').catch(() => {});
    // record failed transaction
    try {
      await db.run('INSERT INTO transactions(from_account,to_account,amount_cents,status,note) VALUES(?,?,?,?,?)', fromId, toId, amountCents, 'failed', String(err));
    } catch (e) {}
    throw err;
  }
}

module.exports = { listAccounts, createAccount, listTransactions, transfer };
