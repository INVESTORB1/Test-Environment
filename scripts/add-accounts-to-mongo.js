#!/usr/bin/env node
// Usage:
//  node scripts/add-accounts-to-mongo.js tester <username> [email]
//  node scripts/add-accounts-to-mongo.js user <email>
//  node scripts/add-accounts-to-mongo.js bulk <path-to-json-file>
// JSON bulk format example: [{"type":"tester","username":"alice","email":"a@e.com"},{"type":"user","email":"b@e.com"}]

require('dotenv').config({ path: '.env' });
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set in .env. Aborting.');
  process.exit(2);
}

function usage() {
  console.log('Usage:');
  console.log('  node scripts/add-accounts-to-mongo.js tester <username> [email]');
  console.log('  node scripts/add-accounts-to-mongo.js user <email>');
  console.log('  node scripts/add-accounts-to-mongo.js bulk <path-to-json-file>');
}

async function main() {
  const [,, cmd, a1, a2] = process.argv;
  if (!cmd) {
    usage();
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  try {
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
    const db = client.db(dbName);

    async function insertTester(username, email) {
      if (!username) throw new Error('username required for tester');
      const now = new Date();
      const doc = { username, email: email || null, last_used: null, created_at: now };
      try {
        const res = await db.collection('testers').insertOne(doc);
        console.log('Inserted tester:', { id: res.insertedId.toString(), username, email });
      } catch (err) {
        if (err && (err.code === 11000 || (err.code && String(err.code).includes('11000')))) {
          console.error('Duplicate tester (username or email already exists)');
        } else {
          throw err;
        }
      }
    }

    async function insertUser(email) {
      if (!email) throw new Error('email required for user');
      const now = new Date();
      const doc = { email, created_at: now };
      try {
        const res = await db.collection('users').insertOne(doc);
        console.log('Inserted user:', { id: res.insertedId.toString(), email });
      } catch (err) {
        if (err && (err.code === 11000 || (err.code && String(err.code).includes('11000')))) {
          console.error('Duplicate user (email already exists)');
        } else {
          throw err;
        }
      }
    }

    if (cmd === 'tester') {
      await insertTester(a1, a2);
    } else if (cmd === 'user') {
      await insertUser(a1);
    } else if (cmd === 'bulk') {
      const fs = require('fs');
      const fp = a1;
      if (!fp) {
        console.error('bulk requires a file path');
        process.exit(1);
      }
      const raw = fs.readFileSync(fp, 'utf8');
      const arr = JSON.parse(raw || '[]');
      if (!Array.isArray(arr)) throw new Error('bulk file must contain an array');
      for (const item of arr) {
        if (!item.type) { console.warn('Skipping item without type', item); continue; }
        if (item.type === 'tester') {
          await insertTester(item.username, item.email);
        } else if (item.type === 'user') {
          await insertUser(item.email);
        } else {
          console.warn('Unknown type, skipping:', item.type);
        }
      }
    } else {
      usage();
      process.exit(1);
    }

    await client.close();
  } catch (e) {
    console.error('Error:', e && e.message ? e.message : e);
    try { await client.close(); } catch (_) {}
    process.exit(1);
  }
}

main();
