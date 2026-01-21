require('dotenv').config();
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { MongoClient } = require('mongodb');

(async () => {
  try {
    const username = 'bolu';
    const uri = process.env.MONGODB_URI;
    if (uri) {
      const client = new MongoClient(uri);
      await client.connect();
      const db = client.db(process.env.MONGODB_DB || undefined);
      const adminMatch = await db.collection('admin_testers').findOne({ username: { $regex: '^' + username + '$', $options: 'i' } });
      const testersMatch = await db.collection('testers').findOne({ username: { $regex: '^' + username + '$', $options: 'i' } });
      console.log('mongo.admin_testers match:', JSON.stringify(adminMatch, null, 2));
      console.log('mongo.testers match:', JSON.stringify(testersMatch, null, 2));
      await client.close();
    } else {
      console.log('MONGODB_URI not set');
    }

    const dbPath = 'src/data/app.db';
    if (fs.existsSync(dbPath)) {
      const dbs = new sqlite3.Database(dbPath);
      await new Promise((resolve) => {
        dbs.all('SELECT id,email,created_at FROM users', (e, r) => {
          if (e) {
            console.error('sqlite users error', e);
            return resolve();
          }
          console.log('sqlite users (first 50):', JSON.stringify(r.slice(0, 50), null, 2));
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
