#!/usr/bin/env node
// Inspect a session DB file and print accounts and transactions for debugging.
// Usage: node scripts/inspect-session.js [sessionId]
// If sessionId omitted, lists session files in the sessions directory.

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const SESS_DIR = process.env.SESSION_DB_DIR || path.join(__dirname, '..', 'src', 'data', 'sessions');

async function listSessions() {
  if (!fs.existsSync(SESS_DIR)) {
    console.error('Sessions dir not found:', SESS_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(SESS_DIR).filter(f => f.startsWith('session_') && f.endsWith('.db'));
  if (!files.length) console.log('No session DB files found in', SESS_DIR);
  files.forEach(f => console.log(f));
}

async function inspect(sessionId) {
  const file = path.join(SESS_DIR, `session_${sessionId}.db`);
  if (!fs.existsSync(file)) {
    console.error('Session DB not found:', file);
    process.exit(2);
  }
  const db = await open({ filename: file, driver: sqlite3.Database });
  try {
    console.log('Accounts:');
    const accounts = await db.all('SELECT * FROM accounts ORDER BY id');
    accounts.forEach(a => console.log(a));
    console.log('\nTransactions:');
    const tx = await db.all('SELECT * FROM transactions ORDER BY created_at DESC');
    tx.forEach(t => console.log(t));
  } catch (e) {
    console.error('Error reading DB:', e && e.message ? e.message : e);
  } finally {
    await db.close();
  }
}

(async () => {
  const arg = process.argv[2];
  if (!arg) return listSessions();
  await inspect(arg);
})();
