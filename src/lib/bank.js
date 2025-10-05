const sessionDb = require('./sessionDb');

async function listAccounts(sessionId) {
  const db = await sessionDb.getSessionDb(sessionId);
  return db.all('SELECT * FROM accounts ORDER BY id');
}

async function createAccount(sessionId, ownerName, initialCents) {
  const db = await sessionDb.getSessionDb(sessionId);
  const res = await db.run('INSERT INTO accounts(owner_name,balance_cents) VALUES(?,?)', ownerName, initialCents);
  return db.get('SELECT * FROM accounts WHERE id = ?', res.lastID);
}

async function listTransactions(sessionId) {
  const db = await sessionDb.getSessionDb(sessionId);
  // return transactions enriched with owner names for display
  const q = `SELECT t.*, 
    fa.owner_name AS from_owner_name,
    ta.owner_name AS to_owner_name
    FROM transactions t
    LEFT JOIN accounts fa ON t.from_account = fa.id
    LEFT JOIN accounts ta ON t.to_account = ta.id
    ORDER BY t.created_at DESC`;
  return db.all(q);
}

async function transfer(sessionId, fromId, toId, amountCents, note) {
  const db = await sessionDb.getSessionDb(sessionId);
  // run in transaction
  return db.exec('BEGIN TRANSACTION').then(async () => {
    try {
      const from = await db.get('SELECT * FROM accounts WHERE id = ?', fromId);
      const to = await db.get('SELECT * FROM accounts WHERE id = ?', toId);
      if (!from || !to) throw new Error('Account not found');
      if (amountCents <= 0) throw new Error('Amount must be positive');
      if (from.balance_cents < amountCents) throw new Error('Insufficient funds');
      await db.run('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?', amountCents, fromId);
      await db.run('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?', amountCents, toId);
      const res = await db.run('INSERT INTO transactions(from_account,to_account,amount_cents,status,note) VALUES(?,?,?,?,?)', fromId, toId, amountCents, 'success', note || null);
      await db.exec('COMMIT');
      return db.get('SELECT * FROM transactions WHERE id = ?', res.lastID);
    } catch (err) {
      await db.exec('ROLLBACK').catch(() => {});
      const res = await db.run('INSERT INTO transactions(from_account,to_account,amount_cents,status,note) VALUES(?,?,?,?,?)', fromId, toId, amountCents, 'failed', String(err));
      return db.get('SELECT * FROM transactions WHERE id = ?', res.lastID);
    }
  });
}

module.exports = { listAccounts, createAccount, transfer, listTransactions };
