const sessionDb = require('./sessionDb');

async function listAccounts(sessionId) {
  const db = await sessionDb.getSessionDb(sessionId);
  return db.all('SELECT * FROM accounts ORDER BY id');
}

async function createAccount(sessionId, ownerName, initialCents) {
  const db = await sessionDb.getSessionDb(sessionId);
  // generate a short unique account number (8 digits) and ensure uniqueness
  function genAcc() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
  }
  let accNum = genAcc();
  // try a few times to avoid collision
  for (let i = 0; i < 5; i++) {
    try {
      const res = await db.run('INSERT INTO accounts(owner_name,account_number,balance_cents) VALUES(?,?,?)', ownerName, accNum, initialCents);
      return db.get('SELECT * FROM accounts WHERE id = ?', res.lastID);
    } catch (e) {
      // unique constraint failed, try again
      accNum = genAcc();
      if (i === 4) throw e;
    }
  }
}

async function listTransactions(sessionId) {
  const db = await sessionDb.getSessionDb(sessionId);
  // return transactions enriched with owner names for display
  const q = `SELECT t.*, 
    fa.owner_name AS from_owner_name,
    ta.owner_name AS to_owner_name,
    fa.account_number AS from_account_number,
    ta.account_number AS to_account_number
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
      // record account numbers at time of transaction for auditability
      await db.run('INSERT INTO transactions(from_account,to_account,from_account_number,to_account_number,amount_cents,status,note) VALUES(?,?,?,?,?,?,?)', fromId, toId, from.account_number, to.account_number, amountCents, 'success', note || null);
      const res = await db.get('SELECT * FROM transactions WHERE id = last_insert_rowid()');
      await db.exec('COMMIT');
      return res;
    } catch (err) {
      await db.exec('ROLLBACK').catch(() => {});
      await db.run('INSERT INTO transactions(from_account,to_account,from_account_number,to_account_number,amount_cents,status,note) VALUES(?,?,?,?,?,?,?)', fromId, toId, from ? from.account_number : null, to ? to.account_number : null, amountCents, 'failed', String(err));
      return db.get('SELECT * FROM transactions WHERE id = last_insert_rowid()');
    }
  });
}

module.exports = { listAccounts, createAccount, transfer, listTransactions };
