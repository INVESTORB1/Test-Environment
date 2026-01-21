const sessionDb = require('./sessionDb');

// canonical allowed statuses
const ALLOWED_STATUSES = ['active', 'dormant', 'debit freeze', 'credit freeze', 'total freeze', 'inactive'];

async function listAccounts(sessionId) {
  const db = await sessionDb.getSessionDb(sessionId);
  // only return accounts that haven't been soft-deleted
  return db.all("SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY id");
}

async function createAccount(sessionId, ownerName, initialCents, status = 'active') {
  const db = await sessionDb.getSessionDb(sessionId);
  // generate a short unique account number (8 digits) and ensure uniqueness
  function genAcc() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
  }
  let accNum = genAcc();
  // try a few times to avoid collision
  // normalize and validate status
  status = (status || 'active').toString().toLowerCase();
  if (!ALLOWED_STATUSES.includes(status)) throw new Error(`Invalid status '${status}'. Allowed: ${ALLOWED_STATUSES.join(', ')}`);
  for (let i = 0; i < 5; i++) {
    try {
      const res = await db.run('INSERT INTO accounts(owner_name,account_number,status,balance_cents) VALUES(?,?,?,?)', ownerName, accNum, status, initialCents);
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
    COALESCE(fa.owner_name, t.from_owner_name) AS from_owner_name,
    COALESCE(ta.owner_name, t.to_owner_name) AS to_owner_name,
    COALESCE(fa.account_number, t.from_account_number) AS from_account_number,
    COALESCE(ta.account_number, t.to_account_number) AS to_account_number
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
    // declare here so the catch block can reference them when mapping error messages
    let from = null;
    let to = null;
    try {
      from = await db.get('SELECT * FROM accounts WHERE id = ?', fromId);
      to = await db.get('SELECT * FROM accounts WHERE id = ?', toId);
      if (!from || !to) throw new Error('Account not found');
      if (amountCents <= 0) throw new Error('Amount must be positive');
      // enforce status rules
      const sFrom = (from.status || 'active').toLowerCase();
      const sTo = (to.status || 'active').toLowerCase();
      const allowDebit = (s) => (s === 'active' || s === 'credit freeze');
      const allowCredit = (s) => (s === 'active' || s === 'debit freeze');
      if (!allowDebit(sFrom)) throw new Error(`Account ${fromId} cannot be debited due to status (${from.status})`);
      if (!allowCredit(sTo)) throw new Error(`Account ${toId} cannot be credited due to status (${to.status})`);
      if (from.balance_cents < amountCents) throw new Error('Insufficient funds');
      await db.run('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?', amountCents, fromId);
      await db.run('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?', amountCents, toId);
      // record account numbers at time of transaction for auditability
  await db.run('INSERT INTO transactions(from_account,to_account,from_account_number,to_account_number,from_owner_name,to_owner_name,amount_cents,status,note) VALUES(?,?,?,?,?,?,?,?,?)', fromId, toId, from.account_number, to.account_number, from.owner_name, to.owner_name, amountCents, 'success', note || null);
      const res = await db.get('SELECT * FROM transactions WHERE id = last_insert_rowid()');
      await db.exec('COMMIT');
      return res;
    } catch (err) {
      await db.exec('ROLLBACK').catch(() => {});
      // Create concise, user-friendly failure messages for business errors
      let failureNote = String(err);
      try {
        const msg = err && err.message ? err.message.toString() : '';
        if (msg.includes('cannot be debited')) {
          const st = from && from.status ? from.status : 'unknown';
          if (st === 'debit freeze') {
            failureNote = `Account ${fromId} is on debit freeze and cannot be debited.`;
          } else if (st === 'credit freeze') {
            // unlikely: credit_freeze allows debit, but handle defensively
            failureNote = `Account ${fromId} is on credit freeze and cannot be debited.`;
          } else {
            failureNote = `Account ${fromId} is currently '${st}' and cannot be debited.`;
          }
        } else if (msg.includes('cannot be credited')) {
          const st = to && to.status ? to.status : 'unknown';
          if (st === 'credit freeze') {
            failureNote = `Account ${toId} is on credit freeze and cannot be credited.`;
          } else if (st === 'debit freeze') {
            // unlikely: debit_freeze allows credit, but handle defensively
            failureNote = `Account ${toId} is on debit freeze and cannot be credited.`;
          } else {
            failureNote = `Account ${toId} is currently '${st}' and cannot be credited.`;
          }
        } else if (msg.toLowerCase().includes('insufficient funds')) {
          failureNote = 'Insufficient funds';
        } else if (msg.toLowerCase().includes('account not found')) {
          failureNote = 'One or more accounts not found';
        }
      } catch (e) {
        // fallback to the original error if mapping fails
        failureNote = String(err);
      }

    await db.run('INSERT INTO transactions(from_account,to_account,from_account_number,to_account_number,from_owner_name,to_owner_name,amount_cents,status,note) VALUES(?,?,?,?,?,?,?,?,?)', fromId, toId, from ? from.account_number : null, to ? to.account_number : null, from ? from.owner_name : null, to ? to.owner_name : null, amountCents, 'failed', failureNote);
      return db.get('SELECT * FROM transactions WHERE id = last_insert_rowid()');
    }
  });
}

async function updateAccountStatus(sessionId, accountId, newStatus) {
  const db = await sessionDb.getSessionDb(sessionId);
  newStatus = (newStatus || '').toString().toLowerCase();
  if (!ALLOWED_STATUSES.includes(newStatus)) throw new Error(`Invalid status '${newStatus}'. Allowed: ${ALLOWED_STATUSES.join(', ')}`);
  await db.run('UPDATE accounts SET status = ? WHERE id = ?', newStatus, accountId);
  return db.get('SELECT * FROM accounts WHERE id = ?', accountId);
}

// Delete an account from the session DB.
// NOTE: we intentionally preserve past transactions for audit/history purposes.
// Transactions referencing the deleted account will remain in the transactions table
// and retain their recorded account_number/from_account_number fields so historical
// activity is not lost when an account is removed from the sandbox.
async function deleteAccount(sessionId, accountId) {
  const db = await sessionDb.getSessionDb(sessionId);
  // Soft-delete the account so we preserve the row for transaction history
  // and retain owner/account_number for auditing.
  const res = await db.run('UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', accountId);
  return { changes: res && res.changes ? res.changes : 0 };
}

module.exports = { listAccounts, createAccount, transfer, listTransactions, updateAccountStatus, deleteAccount };
