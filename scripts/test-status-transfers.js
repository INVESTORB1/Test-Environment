#!/usr/bin/env node
const bank = require('../src/lib/bank');
const sessionDb = require('../src/lib/sessionDb');
const { v4: uuidv4 } = require('uuid');

function fmt(cents) {
  if (cents == null) return '₦0.00';
  return '₦' + (cents / 100).toFixed(2);
}

async function run() {
  const sessionId = `test-${uuidv4()}`;
  console.log('Using session:', sessionId);
  try {
    // create accounts with different statuses
    const aDebitFreeze = await bank.createAccount(sessionId, 'Alice', 100000, 'debit freeze'); // 1000
    const aCreditFreeze = await bank.createAccount(sessionId, 'Bob', 100000, 'credit freeze');
    const aDormant = await bank.createAccount(sessionId, 'Carol', 100000, 'dormant');
    const aInactive = await bank.createAccount(sessionId, 'Dan', 100000, 'inactive');
    const aActive = await bank.createAccount(sessionId, 'Eve', 100000, 'active');

    const accounts = [aDebitFreeze, aCreditFreeze, aDormant, aInactive, aActive];
    console.log('Created accounts:');
    for (const a of accounts) {
      console.log(`  id=${a.id} owner=${a.owner_name} status=${a.status} balance=${fmt(a.balance_cents)}`);
    }

    const tests = [
      { from: aDebitFreeze.id, to: aActive.id, desc: 'debit freeze (from) -> active (to)' },
      { from: aActive.id, to: aCreditFreeze.id, desc: 'active (from) -> credit freeze (to)' },
      { from: aDormant.id, to: aActive.id, desc: 'dormant (from) -> active (to)' },
      { from: aActive.id, to: aDormant.id, desc: 'active (from) -> dormant (to)' },
      { from: aInactive.id, to: aActive.id, desc: 'inactive (from) -> active (to)' },
      { from: aActive.id, to: aInactive.id, desc: 'active (from) -> inactive (to)' },
      { from: aCreditFreeze.id, to: aActive.id, desc: 'credit freeze (from) -> active (to)' },
      { from: aActive.id, to: aDebitFreeze.id, desc: 'active (from) -> debit freeze (to)' }
    ];

    for (const t of tests) {
      console.log('\nTest:', t.desc);
      try {
        const tx = await bank.transfer(sessionId, t.from, t.to, 10000, `test ${t.desc}`); // 100.00
        console.log('  tx.status =', tx.status);
        console.log('  tx.note   =', tx.note);
      } catch (err) {
        console.error('  transfer threw unexpected exception:', String(err));
      }
    }

  } finally {
    // cleanup session DB
    try {
      await sessionDb.deleteSessionDb(sessionId);
      console.log('\nCleaned up session DB for', sessionId);
    } catch (e) {
      console.warn('Failed to delete session DB:', e && e.message ? e.message : e);
    }
  }
}

run().catch(e => {
  console.error('Test script failed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
