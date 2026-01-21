#!/usr/bin/env node
// Simple smoke test (programmatic) for the Bank sandbox flow:
// 1. create two accounts
// 2. perform a transfer
// 3. delete one account
// 4. verify transactions still exist and contain owner/account info

const assert = require('assert');
const { v4: uuidv4 } = require('uuid');
const sessionDb = require('../src/lib/sessionDb');
const bank = require('../src/lib/bank');

async function run() {
  const sessionId = uuidv4();
  console.log('Using session id:', sessionId);
  try {
    // ensure session DB exists
    await sessionDb.getSessionDb(sessionId);

    // create two accounts
    const a1 = await bank.createAccount(sessionId, 'Alice', 100000); // ₦1000.00
    const a2 = await bank.createAccount(sessionId, 'Bob', 50000); // ₦500.00
    console.log('Created accounts:', a1.id, a2.id);
    assert(a1 && a2, 'Accounts not created');

    // perform transfer from Alice -> Bob (₦200.00)
    const amount = 20000; // cents
    const tx = await bank.transfer(sessionId, a1.id, a2.id, amount, 'smoke test transfer');
    assert(tx && tx.status === 'success', 'Transfer failed: ' + JSON.stringify(tx));
    console.log('Transfer recorded id:', tx.id);

    // ensure transaction is visible
    const before = await bank.listTransactions(sessionId);
    assert(before && before.length >= 1, 'No transactions found after transfer');
    const found = before.find(t => Number(t.id) === Number(tx.id));
    assert(found, 'Created transaction not found in listTransactions');
    console.log('Transaction before delete exists, from_owner_name:', found.from_owner_name, 'from_account_number:', found.from_account_number);

    // delete account a1
    const delRes = await bank.deleteAccount(sessionId, a1.id);
    console.log('deleteAccount result:', delRes);
    // account should no longer be in listAccounts
    const accounts = await bank.listAccounts(sessionId);
    assert(!accounts.some(a => Number(a.id) === Number(a1.id)), 'Deleted account still present in listAccounts');

    // transactions should still be present and retain account/owner info
    const after = await bank.listTransactions(sessionId);
    const foundAfter = after.find(t => Number(t.id) === Number(tx.id));
    assert(foundAfter, 'Transaction missing after account delete');
    assert(foundAfter.from_account_number || foundAfter.from_owner_name, 'Transaction lost account/owner info after delete');
    console.log('Transaction after delete preserved:', { id: foundAfter.id, from_account_number: foundAfter.from_account_number, from_owner_name: foundAfter.from_owner_name });

    console.log('\nSMOKE TEST PASSED');
    // cleanup session DB file
    try { await sessionDb.deleteSessionDb(sessionId); } catch (e) {}
    process.exit(0);
  } catch (err) {
    console.error('SMOKE TEST FAILED:', err && err.stack ? err.stack : err);
    try { await sessionDb.deleteSessionDb(sessionId); } catch (e) {}
    process.exit(2);
  }
}

run();
