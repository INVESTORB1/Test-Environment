const sqlite3 = require('sqlite3').verbose();
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'src', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Please set MONGODB_URI to your MongoDB connection string');
  process.exit(2);
}

if (!fs.existsSync(DB_PATH)) {
  console.error('SQLite DB not found at', DB_PATH);
  process.exit(2);
}

async function migrate() {
  const sqlite = new sqlite3.Database(DB_PATH);
  // mongodb v4+ : avoid passing legacy parser/topology options
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();

  // helper to run a sqlite query and return rows
  function sqliteAll(sql) {
    return new Promise((resolve, reject) => {
      sqlite.all(sql, (err, rows) => { if (err) return reject(err); resolve(rows); });
    });
  }

  try {
    // invites
    const invites = await sqliteAll('SELECT token, email, used, created_at FROM invites');
    if (invites && invites.length) {
      for (const r of invites) {
        await db.collection('invites').updateOne({ token: r.token }, { $set: { token: r.token, email: r.email, used: r.used || 0, created_at: r.created_at ? new Date(r.created_at) : new Date() } }, { upsert: true });
      }
    }

    // users
    const users = await sqliteAll('SELECT id, email, created_at FROM users');
    if (users && users.length) {
      for (const r of users) {
        await db.collection('users').updateOne({ email: r.email }, { $set: { email: r.email, created_at: r.created_at ? new Date(r.created_at) : new Date(), legacy_id: r.id } }, { upsert: true });
      }
    }

    // attempts
    const attempts = await sqliteAll('SELECT id, user_id, lab_id, success, output, duration_ms, created_at FROM attempts');
    if (attempts && attempts.length) {
      for (const r of attempts) {
        await db.collection('attempts').updateOne({ id: r.id }, { $set: { id: r.id, user_id: r.user_id, lab_id: r.lab_id, success: r.success, output: r.output, duration_ms: r.duration_ms, created_at: r.created_at ? new Date(r.created_at) : new Date() } }, { upsert: true });
      }
    }

    // bank_templates
    const banks = await sqliteAll('SELECT id, owner_name, balance_cents, created_at FROM bank_templates');
    if (banks && banks.length) {
      for (const r of banks) {
        await db.collection('bank_templates').updateOne({ id: r.id }, { $set: { id: r.id, owner_name: r.owner_name, balance_cents: r.balance_cents, created_at: r.created_at ? new Date(r.created_at) : new Date() } }, { upsert: true });
      }
    }

    // testers
    const testers = await sqliteAll('SELECT id, username, email, last_used, created_at FROM testers');
    if (testers && testers.length) {
      for (const r of testers) {
        await db.collection('testers').updateOne({ username: r.username }, { $set: { id: r.id, username: r.username, email: r.email || null, last_used: r.last_used ? new Date(r.last_used) : null, created_at: r.created_at ? new Date(r.created_at) : new Date() } }, { upsert: true });
      }
    }

    // audits
    const audits = await sqliteAll('SELECT id, actor, action, details, created_at FROM audits');
    if (audits && audits.length) {
      for (const r of audits) {
        await db.collection('audits').updateOne({ id: r.id }, { $set: { id: r.id, actor: r.actor, action: r.action, details: r.details, created_at: r.created_at ? new Date(r.created_at) : new Date() } }, { upsert: true });
      }
    }

    console.log('Migration to MongoDB complete');
  } catch (err) {
    console.error('Migration failed', err);
  } finally {
    sqlite.close();
    await client.close();
    process.exit(0);
  }
}

migrate().catch(e => { console.error(e); process.exit(1); });
