const { Client } = require('pg');
const fs = require('fs');

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  // Create tables similar to sqlite schema
  await client.query(`
  CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY,
    email TEXT,
    used INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    lab_id INTEGER,
    success INTEGER,
    output TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS bank_templates (
    id SERIAL PRIMARY KEY,
    owner_name TEXT,
    balance_cents INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS testers (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE,
    email TEXT,
    last_used TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  `);
  console.log('Postgres schema created/verified');
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
