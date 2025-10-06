#!/usr/bin/env node
const { v4: uuidv4 } = require('uuid');
const db = require('../src/lib/db');

async function run(email) {
  const token = uuidv4();
  await db.createInvite(token, email || 'friend@example.com');
  console.log('Invite created. Token:', token);
  const base = process.env.BASE_URL || 'http://localhost:3000';
  console.log('Magic link:', `${base.replace(/\/$/, '')}/auth/magic/${token}`);
  process.exit(0);
}

const email = process.argv[2];
run(email).catch(err => { console.error(err); process.exit(1); });
