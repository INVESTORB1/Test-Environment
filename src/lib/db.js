const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

let dbPromise = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = open({ filename: DB_PATH, driver: sqlite3.Database });
    const db = await dbPromise;
    await db.exec(`
      CREATE TABLE IF NOT EXISTS invites (
        token TEXT PRIMARY KEY,
        email TEXT,
        used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        lab_id INTEGER,
        success INTEGER,
        output TEXT,
        duration_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS bank_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_name TEXT,
        balance_cents INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  return dbPromise;
}

async function createInvite(token, email) {
  const db = await getDb();
  return db.run('INSERT INTO invites(token,email) VALUES(?,?)', token, email);
}

async function findInvite(token) {
  const db = await getDb();
  return db.get('SELECT * FROM invites WHERE token = ? AND used = 0', token);
}

async function useInvite(token) {
  const db = await getDb();
  return db.run('UPDATE invites SET used = 1 WHERE token = ?', token);
}

async function allInvites() {
  const db = await getDb();
  return db.all('SELECT * FROM invites ORDER BY created_at DESC');
}

async function createUser(email) {
  const db = await getDb();
  const res = await db.run('INSERT INTO users(email) VALUES(?)', email);
  return db.get('SELECT * FROM users WHERE id = ?', res.lastID);
}

async function findUserByEmail(email) {
  const db = await getDb();
  return db.get('SELECT * FROM users WHERE email = ?', email);
}

async function createAttempt(userId, labId, success, output, durationMs) {
  const db = await getDb();
  const res = await db.run(
    'INSERT INTO attempts(user_id, lab_id, success, output, duration_ms) VALUES(?,?,?,?,?)',
    userId,
    labId,
    success ? 1 : 0,
    output,
    durationMs
  );
  return db.get('SELECT * FROM attempts WHERE id = ?', res.lastID);
}

async function getAttemptsByUser(userId) {
  const db = await getDb();
  return db.all('SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at DESC', userId);
}

async function createBankTemplate(ownerName, balanceCents) {
  const db = await getDb();
  const res = await db.run('INSERT INTO bank_templates(owner_name,balance_cents) VALUES(?,?)', ownerName, balanceCents);
  return db.get('SELECT * FROM bank_templates WHERE id = ?', res.lastID);
}

async function listBankTemplates() {
  const db = await getDb();
  return db.all('SELECT * FROM bank_templates ORDER BY id');
}

module.exports = {
  createInvite,
  findInvite,
  useInvite,
  allInvites,
  createUser,
  findUserByEmail,
  createAttempt,
  getAttemptsByUser,
  createBankTemplate,
  listBankTemplates,
};
