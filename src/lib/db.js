const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// If DATABASE_URL is provided use Postgres, else fallback to SQLite
if (process.env.DATABASE_URL) {
  // Postgres implementation
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async function run(sql, ...params) {
    const res = await pool.query(sql, params);
    return res;
  }

  async function all(sql, ...params) {
    const res = await pool.query(sql, params);
    return res.rows;
  }

  async function get(sql, ...params) {
    const res = await pool.query(sql, params);
    return res.rows[0] || null;
  }

  // expose a minimal API compatible with the sqlite wrapper used earlier
  module.exports = {
    createInvite: async (token, email) => run('INSERT INTO invites(token,email) VALUES($1,$2)', token, email),
    findInvite: async (token) => get('SELECT * FROM invites WHERE token = $1 AND used = 0', token),
    useInvite: async (token) => run('UPDATE invites SET used = 1 WHERE token = $1', token),
    allInvites: async () => all('SELECT * FROM invites ORDER BY created_at DESC'),
    createUser: async (email) => {
      const res = await run('INSERT INTO users(email) VALUES($1) RETURNING *', email);
      return get('SELECT * FROM users WHERE id = $1', res.rows ? res.rows[0].id : null);
    },
    findUserByEmail: async (email) => get('SELECT * FROM users WHERE email = $1', email),
    createAttempt: async (userId, labId, success, output, durationMs) => {
      const res = await run('INSERT INTO attempts(user_id, lab_id, success, output, duration_ms) VALUES($1,$2,$3,$4,$5) RETURNING *', userId, labId, success ? 1 : 0, output, durationMs);
      return res.rows ? res.rows[0] : null;
    },
    getAttemptsByUser: async (userId) => all('SELECT * FROM attempts WHERE user_id = $1 ORDER BY created_at DESC', userId),
    createBankTemplate: async (ownerName, balanceCents) => {
      const res = await run('INSERT INTO bank_templates(owner_name,balance_cents) VALUES($1,$2) RETURNING *', ownerName, balanceCents);
      return res.rows ? res.rows[0] : null;
    },
    listBankTemplates: async () => all('SELECT * FROM bank_templates ORDER BY id'),
  // audits
  logAudit: async (actor, action, details) => run('INSERT INTO audits(actor,action,details) VALUES($1,$2,$3)', actor, action, details || null),
  listAudits: async () => all('SELECT * FROM audits ORDER BY created_at DESC') ,
    // testers
    createTester: async (username, email) => {
      try {
        const res = await run('INSERT INTO testers(username,email) VALUES($1,$2) RETURNING *', username, email);
        return res.rows[0];
      } catch (err) {
        if (err && err.code === '23505') {
          const e = new Error('duplicate');
          e.code = 'DUPLICATE_TESTER';
          throw e;
        }
        throw err;
      }
    },
    listTesters: async () => all('SELECT * FROM testers ORDER BY id'),
    findTesterByUsername: async (username) => get('SELECT * FROM testers WHERE username = $1', username),
    findTesterByEmail: async (email) => get('SELECT * FROM testers WHERE email = $1', email),
    deleteTester: async (id) => run('DELETE FROM testers WHERE id = $1', id),
    updateTesterLastUsed: async (username, when) => run('UPDATE testers SET last_used = $1 WHERE username = $2', when, username),
    updateTesterLastUsedByEmail: async (email, when) => run('UPDATE testers SET last_used = $1 WHERE email = $2 OR username = $3', when, email, email)
  };

} else {
  // SQLite fallback (existing behavior)
  const sqlite3 = require('sqlite3');
  const { open } = require('sqlite');
  const DB_PATH = path.join(DATA_DIR, 'app.db');

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    // non-fatal; open() will fail later if path is invalid
  }

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
        CREATE TABLE IF NOT EXISTS testers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE,
          email TEXT,
          last_used DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
          CREATE TABLE IF NOT EXISTS audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor TEXT,
            action TEXT,
            details TEXT,
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
    // audits
    logAudit: async (actor, action, details) => {
      const db = await getDb();
      return db.run('INSERT INTO audits(actor,action,details) VALUES(?,?,?)', actor, action, details || null);
    },
    listAudits: async () => {
      const db = await getDb();
      return db.all('SELECT * FROM audits ORDER BY created_at DESC');
    },
    // tester helpers
    createTester: async (username, email) => {
      const db = await getDb();
      try {
        const res = await db.run('INSERT INTO testers(username,email) VALUES(?,?)', username, email);
        return db.get('SELECT * FROM testers WHERE id = ?', res.lastID);
      } catch (err) {
        // sqlite duplicate error code
        if (err && err.code === 'SQLITE_CONSTRAINT') {
          const e = new Error('duplicate');
          e.code = 'DUPLICATE_TESTER';
          throw e;
        }
        throw err;
      }
    },
    listTesters: async () => {
      const db = await getDb();
      return db.all('SELECT * FROM testers ORDER BY id');
    },
    findTesterByUsername: async (username) => {
      const db = await getDb();
      return db.get('SELECT * FROM testers WHERE username = ?', username);
    },
    findTesterByEmail: async (email) => {
      const db = await getDb();
      return db.get('SELECT * FROM testers WHERE email = ?', email);
    },
    deleteTester: async (id) => {
      const db = await getDb();
      return db.run('DELETE FROM testers WHERE id = ?', id);
    },
    updateTesterLastUsed: async (username, when) => {
      const db = await getDb();
      return db.run('UPDATE testers SET last_used = ? WHERE username = ?', when, username);
    },
    updateTesterLastUsedByEmail: async (email, when) => {
      const db = await getDb();
      return db.run('UPDATE testers SET last_used = ? WHERE email = ? OR username = ?', when, email, email);
    }
  };

}
