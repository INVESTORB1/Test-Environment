const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'src', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

function escapeVal(v) {
  if (v === null || v === undefined) return 'NULL';
  // for simplicity, convert Date objects/string timestamps to text
  const s = v.toString().replace(/'/g, "''");
  return `'${s}'`;
}

function tableToInserts(db, table, columns) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT ${columns.join(',')} FROM ${table}`, (err, rows) => {
      if (err) return reject(err);
      const stmts = rows.map(r => {
        const vals = columns.map(c => {
          const v = r[c];
          return escapeVal(v);
        }).join(',');
        return `INSERT INTO ${table}(${columns.join(',')}) VALUES(${vals});`;
      });
      resolve(stmts.join('\n'));
    });
  });
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('SQLite DB not found at', DB_PATH);
    process.exit(2);
  }
  const db = new sqlite3.Database(DB_PATH);
  // Emit header
  console.log('-- Postgres-compatible dump generated from SQLite');
  console.log('BEGIN;');
  try {
    // invites
    console.log('\n-- invites');
    const invitesCols = ['token','email','used','created_at'];
    console.log(await tableToInserts(db, 'invites', invitesCols));

    // users
    console.log('\n-- users');
    const usersCols = ['id','email','created_at'];
    console.log(await tableToInserts(db, 'users', usersCols));

    // attempts
    console.log('\n-- attempts');
    const attemptsCols = ['id','user_id','lab_id','success','output','duration_ms','created_at'];
    console.log(await tableToInserts(db, 'attempts', attemptsCols));

    // bank_templates
    console.log('\n-- bank_templates');
    const bankCols = ['id','owner_name','balance_cents','created_at'];
    console.log(await tableToInserts(db, 'bank_templates', bankCols));

    // testers
    console.log('\n-- testers');
    const testersCols = ['id','username','email','last_used','created_at'];
    console.log(await tableToInserts(db, 'testers', testersCols));

    console.log('\nCOMMIT;');
  } catch (e) {
    console.error('Error:', e);
    console.log('ROLLBACK;');
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
