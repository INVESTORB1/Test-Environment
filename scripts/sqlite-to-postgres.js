const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'src', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Please set DATABASE_URL to your Postgres connection string');
  process.exit(2);
}

if (!fs.existsSync(DB_PATH)) {
  console.error('SQLite DB not found at', DB_PATH);
  process.exit(2);
}

async function migrate() {
  const sqlite = new sqlite3.Database(DB_PATH);
  const pg = new Pool({ connectionString: DATABASE_URL });

  // helper to run a query with params
  async function pgQuery(sql, params = []) {
    return pg.query(sql, params);
  }

  // wrap in transaction
  const client = await pg.connect();
  try {
    await client.query('BEGIN');

    // invites
    await new Promise((resolve, reject) => {
      sqlite.all('SELECT token, email, used, created_at FROM invites', async (err, rows) => {
        if (err) return reject(err);
        for (const r of rows) {
          await client.query(
            'INSERT INTO invites(token,email,used,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(token) DO NOTHING',
            [r.token, r.email, r.used || 0, r.created_at]
          );
        }
        resolve();
      });
    });

    // users
    await new Promise((resolve, reject) => {
      sqlite.all('SELECT id, email, created_at FROM users', async (err, rows) => {
        if (err) return reject(err);
        for (const r of rows) {
          await client.query(
            'INSERT INTO users(id,email,created_at) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',
            [r.id, r.email, r.created_at]
          );
        }
        resolve();
      });
    });

    // attempts
    await new Promise((resolve, reject) => {
      sqlite.all('SELECT id, user_id, lab_id, success, output, duration_ms, created_at FROM attempts', async (err, rows) => {
        if (err) return reject(err);
        for (const r of rows) {
          await client.query(
            'INSERT INTO attempts(id,user_id,lab_id,success,output,duration_ms,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',
            [r.id, r.user_id, r.lab_id, r.success, r.output, r.duration_ms, r.created_at]
          );
        }
        resolve();
      });
    });

    // bank_templates
    await new Promise((resolve, reject) => {
      sqlite.all('SELECT id, owner_name, balance_cents, created_at FROM bank_templates', async (err, rows) => {
        if (err) return reject(err);
        for (const r of rows) {
          await client.query(
            'INSERT INTO bank_templates(id,owner_name,balance_cents,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
            [r.id, r.owner_name, r.balance_cents, r.created_at]
          );
        }
        resolve();
      });
    });

    // testers
    await new Promise((resolve, reject) => {
      sqlite.all('SELECT id, username, email, last_used, created_at FROM testers', async (err, rows) => {
        if (err) return reject(err);
        for (const r of rows) {
          await client.query(
            'INSERT INTO testers(id,username,email,last_used,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(username) DO NOTHING',
            [r.id, r.username, r.email, r.last_used, r.created_at]
          );
        }
        resolve();
      });
    });

    // update sequences for serial columns to max(id)
    const seqTables = ['users','attempts','bank_templates','testers'];
    for (const t of seqTables) {
      const seqRes = await client.query("SELECT pg_get_serial_sequence($1,'id') as seq", [t]);
      const seqName = seqRes.rows[0].seq;
      if (seqName) {
        const maxRes = await client.query(`SELECT COALESCE(MAX(id),0) as maxid FROM ${t}`);
        const maxId = maxRes.rows[0].maxid || 0;
        await client.query(`SELECT setval($1, $2, true)`, [seqName, maxId]);
      }
    }

    await client.query('COMMIT');
    console.log('Migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pg.end?.();
    sqlite.close();
    process.exit(0);
  }
}

migrate().catch(e => { console.error(e); process.exit(1); });
