require('dotenv').config();
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { MongoClient } = require('mongodb');

(async () => {
  try {
    const username = 'ola';
    const email = 'ola@gmail.com';
    const uri = process.env.MONGODB_URI;
    if (uri) {
      const client = new MongoClient(uri);
      await client.connect();
      const db = client.db(process.env.MONGODB_DB || undefined);
      const byUsername = await db.collection('admin_testers').findOne({ username: { $regex: '^' + username + '$', $options: 'i' } });
      const byEmail = await db.collection('admin_testers').findOne({ email: { $regex: '^' + email + '$', $options: 'i' } });
      console.log('admin_testers by username:', JSON.stringify(byUsername, null, 2));
      console.log('admin_testers by email:', JSON.stringify(byEmail, null, 2));
      await client.close();
    } else {
      console.log('MONGODB_URI not set');
    }

    const dbPath = 'src/data/app.db';
    if (fs.existsSync(dbPath)) {
      const dbs = new sqlite3.Database(dbPath);
      await new Promise((resolve) => {
        dbs.all('SELECT id,email,created_at FROM users WHERE lower(email) = ?', [ 'ola@gmail.com' ], (e, r) => {
          if (e) { console.error('sqlite users error', e); return resolve(); }
          console.log('sqlite users matching ola@gmail.com:', JSON.stringify(r, null, 2));
          resolve();
          dbs.close();
        });
      });
    } else {
      console.log('sqlite db not found at', dbPath);
    }

    const testersFile = 'src/data/testers.json';
    if (fs.existsSync(testersFile)) {
      console.log('local testers.json:', fs.readFileSync(testersFile, 'utf8'));
    } else {
      console.log('local testers.json not found');
    }
  } catch (e) {
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
