#!/usr/bin/env node
const db = require('../src/lib/db');

async function run() {
  console.log('Seeding bank templates...');
  await db.createBankTemplate('Alice Example', 1000000); // 10,000.00
  await db.createBankTemplate('Bob Sample', 500000); // 5,000.00
  await db.createBankTemplate('Carol Demo', 250000); // 2,500.00
  console.log('seed complete');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
