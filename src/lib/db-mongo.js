const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('MONGODB_URI is required for mongo adapter');

let clientPromise = null;
let dbInstance = null;

async function getDb() {
  if (!clientPromise) {
    clientPromise = MongoClient.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  }
  if (!dbInstance) {
    const client = await clientPromise;
    dbInstance = client.db();
    // create useful indexes (no-op if already present)
    try {
      await dbInstance.collection('invites').createIndex({ token: 1 }, { unique: true });
      await dbInstance.collection('users').createIndex({ email: 1 }, { unique: true });
      await dbInstance.collection('testers').createIndex({ username: 1 }, { unique: true });
      await dbInstance.collection('audits').createIndex({ created_at: 1 });
    } catch (e) {
      // ignore index creation errors
    }
  }
  return dbInstance;
}

module.exports = {
  createInvite: async (token, email) => {
    const db = await getDb();
    return db.collection('invites').insertOne({ token, email, used: 0, created_at: new Date().toISOString() });
  },

  findInvite: async (token) => {
    const db = await getDb();
    return db.collection('invites').findOne({ token, used: 0 });
  },

  useInvite: async (token) => {
    const db = await getDb();
    return db.collection('invites').updateOne({ token }, { $set: { used: 1 } });
  },

  allInvites: async () => {
    const db = await getDb();
    return db.collection('invites').find().sort({ created_at: -1 }).toArray();
  },

  createUser: async (email) => {
    const db = await getDb();
    const res = await db.collection('users').insertOne({ email, created_at: new Date().toISOString() });
    return db.collection('users').findOne({ _id: res.insertedId });
  },

  findUserByEmail: async (email) => {
    const db = await getDb();
    return db.collection('users').findOne({ email });
  },

  listUsers: async () => {
    const db = await getDb();
    return db.collection('users').find().sort({ created_at: -1 }).toArray();
  },

  createAttempt: async (userId, labId, success, output, durationMs) => {
    const db = await getDb();
    const res = await db.collection('attempts').insertOne({ user_id: userId, lab_id: labId, success: !!success, output, duration_ms: durationMs, created_at: new Date().toISOString() });
    return db.collection('attempts').findOne({ _id: res.insertedId });
  },

  getAttemptsByUser: async (userId) => {
    const db = await getDb();
    return db.collection('attempts').find({ user_id: userId }).sort({ created_at: -1 }).toArray();
  },

  createBankTemplate: async (ownerName, balanceCents) => {
    const db = await getDb();
    const res = await db.collection('bank_templates').insertOne({ owner_name: ownerName, balance_cents: balanceCents, created_at: new Date().toISOString() });
    return db.collection('bank_templates').findOne({ _id: res.insertedId });
  },

  listBankTemplates: async () => {
    const db = await getDb();
    return db.collection('bank_templates').find().sort({ _id: 1 }).toArray();
  },

  logAudit: async (actor, action, details) => {
    const db = await getDb();
    return db.collection('audits').insertOne({ actor, action, details: details || null, created_at: new Date().toISOString() });
  },

  listAudits: async () => {
    const db = await getDb();
    return db.collection('audits').find().sort({ created_at: -1 }).toArray();
  },

  createTester: async (username, email) => {
    const db = await getDb();
    try {
      const res = await db.collection('testers').insertOne({ username, email: email || null, last_used: null, created_at: new Date().toISOString() });
      return db.collection('testers').findOne({ _id: res.insertedId });
    } catch (err) {
      if (err && err.code === 11000) {
        const e = new Error('duplicate');
        e.code = 'DUPLICATE_TESTER';
        throw e;
      }
      throw err;
    }
  },

  listTesters: async () => {
    const db = await getDb();
    return db.collection('testers').find().sort({ _id: 1 }).toArray();
  },

  findTesterByUsername: async (username) => {
    const db = await getDb();
    return db.collection('testers').findOne({ username });
  },

  findTesterByEmail: async (email) => {
    const db = await getDb();
    return db.collection('testers').findOne({ email });
  },

  deleteTester: async (id) => {
    const db = await getDb();
    // id could be a string ObjectId or numeric id migrated from sqlite; try both
    try {
      return db.collection('testers').deleteOne({ _id: ObjectId(id) });
    } catch (e) {
      return db.collection('testers').deleteOne({ $or: [{ _id: id }, { id: id }, { id: Number(id) }] });
    }
  },

  updateTesterLastUsed: async (username, when) => {
    const db = await getDb();
    return db.collection('testers').updateOne({ username }, { $set: { last_used: when } });
  },

  updateTesterLastUsedByEmail: async (email, when) => {
    const db = await getDb();
    return db.collection('testers').updateOne({ $or: [{ email }, { username: email }] }, { $set: { last_used: when } });
  }
};
