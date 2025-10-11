const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('MONGODB_URI is required for mongo adapter');

let clientPromise = null;
async function getClient() {
  if (!clientPromise) {
    clientPromise = MongoClient.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  }
  return clientPromise;
}

async function getDb() {
  const client = await getClient();
  // default DB from connection string
  return client.db();
}

module.exports = {
  // invites
  createInvite: async (token, email) => {
    const db = await getDb();
    return db.collection('invites').updateOne({ token }, { $setOnInsert: { token, email, used: 0, created_at: new Date() } }, { upsert: true });
  },
  findInvite: async (token) => {
    const db = await getDb();
    return db.collection('invites').findOne({ token, used: { $ne: 1 } });
  },
  useInvite: async (token) => {
    const db = await getDb();
    return db.collection('invites').updateOne({ token }, { $set: { used: 1 } });
  },
  allInvites: async () => {
    const db = await getDb();
    return db.collection('invites').find().sort({ created_at: -1 }).toArray();
  },
  // users
  createUser: async (email) => {
    const db = await getDb();
    const res = await db.collection('users').insertOne({ email, created_at: new Date() });
    return db.collection('users').findOne({ _id: res.insertedId });
  },
  findUserByEmail: async (email) => {
    const db = await getDb();
    return db.collection('users').findOne({ email });
  },
  // attempts
  createAttempt: async (userId, labId, success, output, durationMs) => {
    const db = await getDb();
    const res = await db.collection('attempts').insertOne({ user_id: userId, lab_id: labId, success: success ? 1 : 0, output, duration_ms: durationMs, created_at: new Date() });
    return db.collection('attempts').findOne({ _id: res.insertedId });
  },
  getAttemptsByUser: async (userId) => {
    const db = await getDb();
    return db.collection('attempts').find({ user_id: userId }).sort({ created_at: -1 }).toArray();
  },
  // bank templates
  createBankTemplate: async (ownerName, balanceCents) => {
    const db = await getDb();
    const res = await db.collection('bank_templates').insertOne({ owner_name: ownerName, balance_cents: balanceCents, created_at: new Date() });
    return db.collection('bank_templates').findOne({ _id: res.insertedId });
  },
  listBankTemplates: async () => {
    const db = await getDb();
    return db.collection('bank_templates').find().sort({ _id: 1 }).toArray();
  },
  // audits
  logAudit: async (actor, action, details) => {
    const db = await getDb();
    return db.collection('audits').insertOne({ actor, action, details: details || null, created_at: new Date() });
  },
  listAudits: async () => {
    const db = await getDb();
    return db.collection('audits').find().sort({ created_at: -1 }).toArray();
  },
  // users
  listUsers: async () => {
    const db = await getDb();
    return db.collection('users').find().sort({ created_at: -1 }).toArray();
  },
  // testers
  createTester: async (username, email) => {
    const db = await getDb();
    try {
      const res = await db.collection('testers').insertOne({ username, email: email || null, last_used: null, created_at: new Date() });
      return db.collection('testers').findOne({ _id: res.insertedId });
    } catch (err) {
      // duplicate key error
      if (err && err.code === 11000) {
        const e = new Error('duplicate'); e.code = 'DUPLICATE_TESTER'; throw e;
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
    // id could be numeric from sqlite import, treat as either _id or id
    return db.collection('testers').deleteOne({ $or: [{ _id: id }, { id: id }, { id: Number(id) }] });
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
