#!/usr/bin/env node
// Usage: set MONGODB_URI or pass as first arg
// Example: $env:MONGODB_URI='mongodb+srv://user:pass@cluster0.../test' ; node scripts/migrate-testers-to-mongo.js
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { MongoClient } = require('mongodb');

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI || process.argv[2];
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is required (env or first arg)');
    process.exit(2);
  }

  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'src', 'data');
  const DB_PATH = path.join(DATA_DIR, 'app.db');

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  const rows = await db.all('SELECT id, username, email, last_used, created_at FROM testers');
  console.log(`Found ${rows.length} testers in sqlite at ${DB_PATH}`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const dbName = process.env.MONGODB_DB || (function () {
    try {
      const u = new URL(MONGODB_URI);
      return u.pathname ? u.pathname.replace(/^\//, '') : 'test';
    } catch (e) {
      const m = String(MONGODB_URI).match(/\/([^/?]+)(?:[?]|$)/);
      return (m && m[1]) ? m[1] : 'test';
    }
  })();
  const mdb = client.db(dbName);
  const coll = mdb.collection('testers');
  await coll.createIndex({ username: 1 }, { unique: true, sparse: true });
  await coll.createIndex({ email: 1 }, { unique: true, sparse: true });

  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    if (!r || !r.username) continue;
    const filter = { username: r.username };
    const doc = {
      username: r.username,
      email: r.email || null,
      last_used: r.last_used || null,
      created_at: r.created_at || new Date().toISOString(),
      sqlite_id: Number(r.id)
    };
    const res = await coll.updateOne(filter, { $set: doc, $setOnInsert: { created_at: doc.created_at } }, { upsert: true });
    if (res.upsertedCount && res.upsertedCount > 0) inserted += 1; else if (res.modifiedCount && res.modifiedCount > 0) updated += 1;
  }

  console.log(`Migration finished. inserted=${inserted} updated=${updated}`);
  await client.close();
  await db.close();
}

main().catch(err => {
  console.error('Migration failed:', err && err.message ? err.message : err);
  process.exit(1);
});
