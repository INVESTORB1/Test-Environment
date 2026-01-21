const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// If MONGODB_URI is present, provide a Mongo-backed testers collection so
// multiple deployments (localhost, Render) can share the same testers data.
// This augments the existing DATABASE_URL/Postgres or SQLite code paths by
// overriding only the testers-related functions when a Mongo connection exists.
const MONGODB_URI = process.env.MONGODB_URI || null;
let mongoClient = null;
let mongoTestersColl = null;
let mongoAdminTestersColl = null;
async function initMongoIfConfigured() {
  if (!MONGODB_URI) return null;
  if (mongoClient && mongoTestersColl) return { client: mongoClient, coll: mongoTestersColl };
  try {
    const { MongoClient } = require('mongodb');
    // mongodb v4+ removed some legacy options; pass only the URI and let the driver
    // choose sensible defaults. Also avoid using the WHATWG URL parser on
    // mongodb+srv URIs which will throw — parse the DB name more defensively.
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    const dbName = process.env.MONGODB_DB || (function () {
      try {
        const u = new URL(MONGODB_URI);
        return u.pathname ? u.pathname.replace(/^\//, '') : 'test';
      } catch (e) {
        // fallback: try to extract the path segment after the host
        const m = String(MONGODB_URI).match(/\/([^/?]+)(?:[?]|$)/);
        return (m && m[1]) ? m[1] : 'test';
      }
    })();
    const db = mongoClient.db(dbName);
  mongoTestersColl = db.collection('testers');
  mongoAdminTestersColl = db.collection('admin_testers');
  // Ensure unique indexes on username and email to preserve duplicate semantics
  await mongoTestersColl.createIndex({ username: 1 }, { unique: true, sparse: true });
  await mongoTestersColl.createIndex({ email: 1 }, { unique: true, sparse: true });
  // admin_testers should follow same uniqueness constraints
  await mongoAdminTestersColl.createIndex({ username: 1 }, { unique: true, sparse: true });
  await mongoAdminTestersColl.createIndex({ email: 1 }, { unique: true, sparse: true });
    console.log('Connected to MongoDB for shared testers at', MONGODB_URI);
    return { client: mongoClient, coll: mongoTestersColl };
  } catch (e) {
    console.warn('MONGODB_URI set but failed to initialize MongoDB client, falling back to local testers:', e && e.message ? e.message : e);
    mongoClient = null;
    mongoTestersColl = null;
    return null;
  }
}

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
  listUsers: async () => all('SELECT * FROM users ORDER BY created_at DESC'),
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
    // create an admin-scoped tester (try Mongo admin_testers when available; fallback to regular create)
    createAdminTester: async (username, email) => {
      try {
        // ensure mongo client is initialized if configured
        await initMongoIfConfigured();
        if (mongoAdminTestersColl) {
          const now = new Date().toISOString();
          const insert = { username, email: email || null, last_used: null, created_at: now };
          const res = await mongoAdminTestersColl.insertOne(insert);
          return { id: res.insertedId ? String(res.insertedId) : null, username, email: email || null, last_used: null, created_at: now };
        }
      } catch (e) {
        // ignore and fallback
      }
      // fallback to normal createTester (postgres)
      return module.exports.createTester(username, email);
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

  async function listUsers() {
    const db = await getDb();
    return db.all('SELECT * FROM users ORDER BY created_at DESC');
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
  listUsers,
    // audits
    logAudit: async (actor, action, details) => {
      const db = await getDb();
      return db.run('INSERT INTO audits(actor,action,details) VALUES(?,?,?)', actor, action, details || null);
    },
    listAudits: async () => {
      const db = await getDb();
      return db.all('SELECT * FROM audits ORDER BY created_at DESC');
    },
    // tester helpers (in-memory store)
    // Note: testers are stored in-memory for this environment so created testers
    // are available during the process lifetime and used for simple username checks.
    // This keeps compatibility with the existing API and error semantics.
    // In-memory store structure: { id, username, email, last_used, created_at }
    _testersStore: (() => {
      // persistent testers file
      const TESTERS_FILE = path.join(DATA_DIR, 'testers.json');
      try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }

      // load existing testers if present
      let arr = [];
      let nextId = 1;
      try {
        if (fs.existsSync(TESTERS_FILE)) {
          const raw = fs.readFileSync(TESTERS_FILE, 'utf8');
          const parsed = JSON.parse(raw || '[]');
          if (Array.isArray(parsed)) {
            arr = parsed.map((t) => ({ ...t }));
            // compute next id
            nextId = arr.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;
          }
        }
      } catch (e) {
        console.warn('Failed to load testers.json, starting with empty list:', e && e.message ? e.message : e);
        arr = [];
        nextId = 1;
      }
      // persist helper: write atomically
      const persist = (items) => {
        try {
          const tmp = TESTERS_FILE + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
          fs.renameSync(tmp, TESTERS_FILE);
        } catch (e) {
          console.warn('Failed to persist testers.json:', e && e.message ? e.message : e);
        }
      };

      return {
        all: () => arr.slice(),
        findByUsername: (u) => arr.find(t => t.username === u) || null,
        findByEmail: (e) => arr.find(t => t.email === e) || null,

        create: (username, email) => {
          if (!username) throw new Error('username required');
          if (arr.find(t => t.username === username)) {
            const e = new Error('duplicate');
            e.code = 'DUPLICATE_TESTER';
            throw e;
          }
          const tester = {
            id: nextId++,
            username,
            email: email || null,
            last_used: null,
            created_at: new Date().toISOString()
          };
          arr.push(tester);
          persist(arr);
          return tester;
        },
        deleteById: (id) => {
          const idx = arr.findIndex(t => Number(t.id) === Number(id));
          if (idx === -1) return { changes: 0 };
          arr.splice(idx, 1);
          persist(arr);
          return { changes: 1 };
        },
        updateLastUsedByUsername: (username, when) => {
          const t = arr.find(x => x.username === username);
          if (!t) return { changes: 0 };
          t.last_used = when;
          persist(arr);
          return { changes: 1 };
        },
        updateLastUsedByEmailOrUsername: (emailOrUsername, when) => {
          const t = arr.find(x => x.email === emailOrUsername || x.username === emailOrUsername);
          if (!t) return { changes: 0 };
          t.last_used = when;
          persist(arr);
          return { changes: 1 };
        }
      };
    })(),

    createTester: async (username, email) => {
      // Create and return the created tester object
      return module.exports._testersStore.create(username, email);
    },
    createAdminTester: async (username, email) => {
      // try to create in Mongo admin_testers when configured; else fall back to local testers
      try {
        await initMongoIfConfigured();
        if (mongoAdminTestersColl) {
          const now = new Date().toISOString();
          const insert = { username, email: email || null, last_used: null, created_at: now };
          const res = await mongoAdminTestersColl.insertOne(insert);
          return { id: res.insertedId ? String(res.insertedId) : null, username, email: email || null, last_used: null, created_at: now };
        }
      } catch (e) {
        // fall through
      }
      return module.exports._testersStore.create(username, email);
    },
    listTesters: async () => {
      return module.exports._testersStore.all();
    },
    findTesterByUsername: async (username) => {
      return module.exports._testersStore.findByUsername(username);
    },
    findTesterByEmail: async (email) => {
      return module.exports._testersStore.findByEmail(email);
    },
    deleteTester: async (id) => {
      // if Mongo is configured, attempt to delete from Mongo collection as well
      try {
        const m = await initMongoIfConfigured();
        if (m && m.coll) {
          // Mongo expects an ObjectId or native id; we store numeric ids in sqlite, so we'll try numeric first
          const maybeNum = Number(id);
          if (!Number.isNaN(maybeNum)) {
            const res = await m.coll.deleteOne({ sqlite_id: maybeNum });
            if (res && res.deletedCount) return { changes: res.deletedCount };
          }
          // fallback to deleting by _id string
          const res2 = await m.coll.deleteOne({ _id: id });
          if (res2 && res2.deletedCount) return { changes: res2.deletedCount };
        }
      } catch (e) {
        // ignore mongo delete errors and fall back to local
      }
      return module.exports._testersStore.deleteById(id);
    },
    updateTesterLastUsed: async (username, when) => {
      try {
        const m = await initMongoIfConfigured();
        if (m && m.coll) {
          const res = await m.coll.updateOne({ username }, { $set: { last_used: when } });
          if (res && res.matchedCount) return { changes: res.modifiedCount || res.matchedCount };
        }
      } catch (e) {}
      return module.exports._testersStore.updateLastUsedByUsername(username, when);
    },
    updateTesterLastUsedByEmail: async (email, when) => {
      try {
        const m = await initMongoIfConfigured();
        if (m && m.coll) {
          const res = await m.coll.updateOne({ $or: [{ email }, { username: email }] }, { $set: { last_used: when } });
          if (res && res.matchedCount) return { changes: res.modifiedCount || res.matchedCount };
        }
      } catch (e) {}
      return module.exports._testersStore.updateLastUsedByEmailOrUsername(email, when);
    }
  };

}

// If Mongo is configured, override testers functions used in the Postgres branch
// (when DATABASE_URL is present) too. This keeps a single shared implementation
// for testers when MONGODB_URI is set.
(async () => {
  if (!MONGODB_URI) return;
  // Initialize mongo client but do not block module load on network
  await initMongoIfConfigured();
  if (!mongoTestersColl) return;
  // Helper to map mongo doc to the shape used elsewhere
  const mapDoc = (doc) => {
    if (!doc) return null;
    return {
      id: doc.sqlite_id || String(doc._id),
      username: doc.username,
      email: doc.email || null,
      last_used: doc.last_used || null,
      created_at: doc.created_at || (doc._id && doc._id.getTimestamp && doc._id.getTimestamp().toISOString()) || null
    };
  };
  // Attach Mongo-backed implementations where appropriate
  const exported = module.exports;
  if (exported) {
    // createTester: maintain duplicate semantics
    exported.createTester = async (username, email) => {
      if (!username) throw new Error('username required');
      try {
        const now = new Date().toISOString();
        const insert = { username, email: email || null, last_used: null, created_at: now };
        const res = await mongoTestersColl.insertOne(insert);
        return mapDoc({ ...insert, _id: res.insertedId });
      } catch (err) {
        // duplicate key
        if (err && (err.code === 11000 || (err.code && String(err.code).includes('11000')))) {
          const e = new Error('duplicate');
          e.code = 'DUPLICATE_TESTER';
          throw e;
        }
        throw err;
      }
    };
    exported.listTesters = async () => {
      // combine both regular testers and admin-created testers so admin UI shows both
      const [docsA, docsB] = await Promise.all([
        mongoTestersColl.find({}).toArray(),
        mongoAdminTestersColl.find({}).toArray()
      ]);
      const all = docsA.concat(docsB).sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return ta - tb;
      });
      return all.map(mapDoc);
    };
    exported.findTesterByUsername = async (username) => {
      // search admin_testers first, then testers
      const doc = await mongoAdminTestersColl.findOne({ username }) || await mongoTestersColl.findOne({ username });
      return mapDoc(doc);
    };
    exported.findTesterByEmail = async (email) => {
      const doc = await mongoAdminTestersColl.findOne({ email }) || await mongoTestersColl.findOne({ email });
      return mapDoc(doc);
    };
    exported.deleteTester = async (id) => {
      // try numeric sqlite_id first across both collections
      const maybeNum = Number(id);
      if (!Number.isNaN(maybeNum)) {
        const [r1, r2] = await Promise.all([
          mongoTestersColl.deleteOne({ sqlite_id: maybeNum }),
          mongoAdminTestersColl.deleteOne({ sqlite_id: maybeNum })
        ]);
        return { changes: (r1.deletedCount || 0) + (r2.deletedCount || 0) };
      }
      // try _id in both collections
      try {
        const { ObjectId } = require('mongodb');
        const oid = ObjectId.isValid(id) ? new ObjectId(id) : id;
        const [r1, r2] = await Promise.all([
          mongoTestersColl.deleteOne({ _id: oid }),
          mongoAdminTestersColl.deleteOne({ _id: oid })
        ]);
        return { changes: (r1.deletedCount || 0) + (r2.deletedCount || 0) };
      } catch (e) {
        const [r1, r2] = await Promise.all([
          mongoTestersColl.deleteOne({ _id: id }),
          mongoAdminTestersColl.deleteOne({ _id: id })
        ]);
        return { changes: (r1.deletedCount || 0) + (r2.deletedCount || 0) };
      }
    };
    exported.updateTesterLastUsed = async (username, when) => {
      const res = await mongoAdminTestersColl.updateOne({ username }, { $set: { last_used: when } });
      if (res && res.matchedCount) return { changes: res.modifiedCount || res.matchedCount };
      const res2 = await mongoTestersColl.updateOne({ username }, { $set: { last_used: when } });
      return { changes: res2.modifiedCount || res2.matchedCount };
    };
    exported.updateTesterLastUsedByEmail = async (email, when) => {
      const res = await mongoAdminTestersColl.updateOne({ $or: [{ email }, { username: email }] }, { $set: { last_used: when } });
      if (res && res.matchedCount) return { changes: res.modifiedCount || res.matchedCount };
      const res2 = await mongoTestersColl.updateOne({ $or: [{ email }, { username: email }] }, { $set: { last_used: when } });
      return { changes: res2.modifiedCount || res2.matchedCount };
    };

    // allow creating testers specifically as admin-created entries
    exported.createAdminTester = async (username, email) => {
      if (!username) throw new Error('username required');
      try {
        const now = new Date().toISOString();
        const insert = { username, email: email || null, last_used: null, created_at: now };
        const res = await mongoAdminTestersColl.insertOne(insert);
        return mapDoc({ ...insert, _id: res.insertedId });
      } catch (err) {
        if (err && (err.code === 11000 || (err.code && String(err.code).includes('11000')))) {
          const e = new Error('duplicate');
          e.code = 'DUPLICATE_TESTER';
          throw e;
        }
        throw err;
      }
    };
  }
})();
