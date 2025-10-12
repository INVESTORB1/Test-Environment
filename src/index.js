const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./lib/db');
const email = require('./lib/email');
const bank = require('./lib/bank');
const sessionDb = require('./lib/sessionDb');

const app = express();
// When deployed behind a proxy (Render, Heroku, etc.) trust the proxy so
// req.protocol and req.get('host') reflect the external request. This
// ensures generated absolute URLs (magic links) use https and the correct host.
app.set('trust proxy', true);
// serve static assets (CSS)
app.use('/public', express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: false }));

// Session configuration: prefer Redis when REDIS_URL is provided, else use SQLite store.
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
let sessionStore = null;
// prefer Mongo session store when MONGODB_URI is set
if (process.env.MONGODB_URI) {
  try {
    // Be defensive: connect-mongo v4+ exports an object with `create` (or default.create when transpiled),
    // while older v3 exported a factory function that expects the `session` module.
    const ConnectMongo = require('connect-mongo');
    const debugMongo = !!process.env.MONGODB_DEBUG;
    if (debugMongo) {
      try { console.log('-- MONGODB_DEBUG: connect-mongo export shape:', Object.keys(ConnectMongo || {}).length ? Object.keys(ConnectMongo) : typeof ConnectMongo); } catch (e) { /* ignore */ }
    }
    const mongoUri = process.env.MONGODB_URI;
    const ttlSeconds = 24 * 60 * 60;

    // prefer direct `create` (v4+)
    if (ConnectMongo && typeof ConnectMongo.create === 'function') {
      sessionStore = ConnectMongo.create({ mongoUrl: mongoUri, ttl: ttlSeconds });
    } else if (ConnectMongo && ConnectMongo.default && typeof ConnectMongo.default.create === 'function') {
      // handle transpiled/default export
      sessionStore = ConnectMongo.default.create({ mongoUrl: mongoUri, ttl: ttlSeconds });
    } else if (typeof ConnectMongo === 'function') {
      // older connect-mongo (v3) or transpiled variants: call factory with session
      // The factory may return a constructor function, a store instance, or an interop-wrapped object.
      const factoryResult = ConnectMongo(session);
      if (debugMongo) {
        try { console.log('-- MONGODB_DEBUG: connect-mongo factory result type:', factoryResult && typeof factoryResult, Object.keys(factoryResult || {}).slice(0,10)); } catch (e) { /* ignore */ }
      }
      if (typeof factoryResult === 'function') {
        // constructor function
        sessionStore = new factoryResult({ url: mongoUri, ttl: ttlSeconds });
      } else if (factoryResult && typeof factoryResult === 'object') {
        // already a store instance (has get/set) -> use directly
        if (typeof factoryResult.get === 'function' && typeof factoryResult.set === 'function') {
          sessionStore = factoryResult;
        } else {
          // try common interop shapes: { default: Ctor } or { MongoStore: Ctor }
          const maybeCtor = factoryResult.default || factoryResult.MongoStore;
          if (typeof maybeCtor === 'function') {
            sessionStore = new maybeCtor({ url: mongoUri, ttl: ttlSeconds });
          } else {
            throw new Error('connect-mongo factory did not return a constructor or store instance');
          }
        }
      } else {
        throw new Error('connect-mongo factory returned unexpected type');
      }
    } else {
      throw new Error('Unrecognized connect-mongo export shape');
    }

    console.log('Using MongoDB session store');
  } catch (e) {
    console.warn('MONGODB_URI set but failed to initialize connect-mongo, falling back to other session stores:', e && e.message ? e.message : String(e));
    sessionStore = null;
  }
}
if (process.env.REDIS_URL) {
  // lazily require redis-based store
  try {
    const Redis = require('ioredis');
    const RedisStoreFactory = require('connect-redis');
    const RedisStore = RedisStoreFactory(session);
    const redisClient = new Redis(process.env.REDIS_URL);
    sessionStore = new RedisStore({ client: redisClient });
    console.log('Using Redis session store');
  } catch (e) {
    console.warn('REDIS_URL set but failed to initialize Redis store, falling back to SQLite store', e.message);
  }
}
if (!sessionStore) {
  // fallback to SQLite-backed store using connect-sqlite3 if available
  try {
    const SQLiteStore = require('connect-sqlite3')(session);
    // ensure sessions directory exists (app writes here)
    const sessionsDir = path.join(__dirname, 'data', 'sessions');
    try { require('fs').mkdirSync(sessionsDir, { recursive: true }); } catch (e) { /* ignore */ }
    sessionStore = new SQLiteStore({ dir: sessionsDir, db: 'sessions.sqlite' });
    console.log('Using SQLite session store at', sessionsDir);
  } catch (err) {
    // If the module isn't installed or fails to load we must not crash the app.
    console.warn('connect-sqlite3 not available; falling back to in-memory session store.');
    console.warn('To enable persistent sessions, run: npm install connect-sqlite3 connect-redis ioredis');
    // leave sessionStore null so we'll use default MemoryStore below
    sessionStore = null;
  }
}

app.use(session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// simple middleware to expose user to views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// friendly display name middleware: prefer username, else the email local-part
app.use((req, res, next) => {
  const user = req.session.user || null;
  if (!user) {
    res.locals.userDisplayName = null;
    return next();
  }
  if (user.username && user.username.trim()) {
    res.locals.userDisplayName = user.username;
    return next();
  }
  if (user.email && typeof user.email === 'string') {
    const local = user.email.split('@')[0];
    res.locals.userDisplayName = local;
    return next();
  }
  res.locals.userDisplayName = user.email || null;
  next();
});

// simple admin flash mechanism
app.use((req, res, next) => {
  res.locals.adminFlash = req.session.adminFlash || null;
  delete req.session.adminFlash;
  next();
});

// helper: currency formatter (cents to formatted Naira)
function formatCurrency(cents) {
  if (cents == null) return '₦0.00';
  return '₦' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
app.use((req, res, next) => {
  res.locals.formatCurrency = formatCurrency;
  next();
});

function formatWhen(whenStr) {
  try {
    const d = new Date(whenStr);
    return d.toLocaleString();
  } catch (e) { return whenStr; }
}
app.use((req, res, next) => { res.locals.formatWhen = formatWhen; next(); });

// Small in-memory lab catalog (extendable)
const LAB_CATALOG = [
  {
    id: 1,
    title: 'Bank Sandbox',
    description: 'A beginner-friendly bank transaction lab',
    problem: 'Perform valid transfers between accounts, avoid overdrafts, and verify transactions are recorded correctly in the transaction log. The lab is sandboxed per session so changes are isolated.',
    steps: [
      'Open the Bank Sandbox and inspect seeded accounts and balances.',
      'Create a new account if you want an additional owner.',
      'Transfer funds from one account to another (From != To). Watch for overdraft prevention.',
      'Open Transaction History to verify the transfer details and timestamps.',
      'Use Reset if you want to return to the seeded state.'
    ],
    hints: [
      'Amounts are entered as currency; use the transfer form to specify amount.',
      'The UI blocks transfers from an account to itself; choose distinct accounts.',
      'If a magic link was emailed, check spam; otherwise use the on-screen link.',
      'Draft your test cases before commencing.'
    ]
  }
];

app.get('/', (req, res) => {
  res.render('index');
});

// Admin: create invite token (no auth for prototype)
// Admin auth middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const pw = req.body.password;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Olamide';
  if (pw === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: 'Invalid password' });
});

app.get('/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.redirect('/');
});

app.get('/admin', requireAdmin, async (req, res) => {
  const invites = await db.allInvites();
  const testers = await db.listTesters();
  res.render('admin', { invites, testers });
});

// Admin: list created users
app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.listUsers();
    res.render('admin-users', { users });
  } catch (e) {
    req.session.adminFlash = { type: 'error', msg: 'Failed to fetch users' };
    res.redirect('/admin');
  }
});

// Dev debug route: show DB file used and list testers (protected)
app.get('/admin/debug', requireAdmin, async (req, res) => {
  try {
    const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
    const dbFile = path.join(dataDir, 'app.db');
    const testers = await db.listTesters();
    res.json({ dbFile, testers });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Admin: create tester user (username + optional email)
app.post('/admin/testers', requireAdmin, async (req, res) => {
  const username = req.body.username;
  const email = req.body.email || null;
  try {
    await db.createTester(username, email);
    await db.logAudit(req.session.user ? req.session.user.email : 'admin', 'create_tester', `username=${username} email=${email}`);
    req.session.adminFlash = { type: 'success', msg: `Tester '${username}' created` };
  } catch (err) {
    if (err && err.code === 'DUPLICATE_TESTER') {
      req.session.adminFlash = { type: 'error', msg: `Tester '${username}' already exists` };
    } else {
      req.session.adminFlash = { type: 'error', msg: `Error creating tester` };
    }
  }
  res.redirect('/admin');
});

// Admin: revoke/delete tester
app.post('/admin/testers/delete', requireAdmin, async (req, res) => {
  const id = req.body.id;
  if (!id) {
    req.session.adminFlash = { type: 'error', msg: 'Missing tester id' };
    return res.redirect('/admin');
  }
  await db.deleteTester(id);
  await db.logAudit(req.session.user ? req.session.user.email : 'admin', 'delete_tester', `id=${id}`);
  req.session.adminFlash = { type: 'success', msg: 'Tester removed' };
  res.redirect('/admin');
});

// Tester login page (public): testers enter username and the server will create an invite
app.get('/tester-login', (req, res) => {
  res.render('tester-login', { error: null });
});

app.post('/tester-login', async (req, res) => {
  const username = req.body.username;
  // missing username -> 400
  if (!username) {
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(400).json({ error: 'Username required' });
    }
    return res.status(400).render('tester-login', { error: 'Username required' });
  }

  const tester = await db.findTesterByUsername(username);
  // unknown username -> 404
  if (!tester) {
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(404).json({ error: 'Unknown tester username' });
    }
    return res.status(404).render('tester-login', { error: 'Unknown tester username' });
  }
  // create invite for tester email if available, else create with username@example.com fallback
  const email = tester.email || `${tester.username}@example.com`;
  const token = uuidv4();
  await db.createInvite(token, email);
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const link = `${base.replace(/\/$/, '')}/auth/magic/${token}`;
  // show invite-created view with the generated link
  res.render('invite-created', { email, link, sent: false });
});

// Admin bank templates
app.get('/admin/bank', requireAdmin, async (req, res) => {
  const templates = await db.listBankTemplates();
  res.render('admin-bank-templates', { templates });
});

app.post('/admin/bank/templates', requireAdmin, async (req, res) => {
  const owner = req.body.owner;
  const balance = Math.round(parseFloat(req.body.balance || '0') * 100);
  await db.createBankTemplate(owner, balance);
  res.redirect('/admin/bank');
});

app.post('/admin/invite', requireAdmin, async (req, res) => {
  const emailAddr = req.body.email;
  const token = uuidv4();
  await db.createInvite(token, emailAddr);
  await db.logAudit(req.session.user ? req.session.user.email : 'admin', 'create_invite', `email=${emailAddr}`);
  const link = `${req.protocol}://${req.get('host')}/auth/magic/${token}`;
  const sent = await email.sendMagicLink(emailAddr, link).catch(() => false);
  if (sent) {
    res.render('invite-created', { email: emailAddr, link: null, sent: true });
  } else {
    res.render('invite-created', { email: emailAddr, link, sent: false });
  }
});

// Magic link
app.get('/auth/magic/:token', async (req, res) => {
  const token = req.params.token;
  const invite = await db.findInvite(token);
  if (!invite) return res.status(400).send('Invalid or expired invite token');
  // create or find user
  let user = await db.findUserByEmail(invite.email);
  if (!user) {
    user = await db.createUser(invite.email);
  }
  // regenerate session to avoid carrying over previous session data (sandbox files)
  const oldSessionId = req.sessionID;
  await new Promise((resolve, reject) => {
    req.session.regenerate(async (err) => {
      if (err) return reject(err);
      req.session.user = { id: user.id, email: user.email, role: 'tester' };
      resolve();
    });
  });
  // if a tester entry exists with a username for this email, surface it in session
  try {
    const tester = await db.findTesterByEmail(invite.email);
    if (tester && tester.username) req.session.user.username = tester.username;
  } catch (e) {
    // ignore lookup errors
  }
  // mark invite used
  await db.useInvite(token);
  await db.logAudit(user.email, 'login_magic', `invite=${token}`);
  // if this invite was for a pre-created tester, record last_used
  try {
    await db.updateTesterLastUsedByEmail(invite.email, new Date().toISOString());
  } catch (e) {
    // ignore if not a tester or other errors
  }
  // remove the old session DB file (if any) to prevent old user's sandbox from leaking
  try {
    if (oldSessionId && oldSessionId !== req.sessionID) await sessionDb.deleteSessionDb(oldSessionId);
  } catch (e) {}
  res.redirect('/labs');
});

// Protected area
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  next();
}

app.get('/labs', requireAuth, async (req, res) => {
  // get attempts for current user to compute per-lab stats
  const attempts = await db.getAttemptsByUser(req.session.user.id);
  const labsWithStats = LAB_CATALOG.map((l) => {
    const userAttempts = attempts.filter(a => Number(a.lab_id) === Number(l.id));
    return {
      ...l,
      attemptsCount: userAttempts.length,
      lastVisited: userAttempts.length ? userAttempts[0].created_at : null
    };
  });
  res.render('labs', { labs: labsWithStats, user: req.session.user });
});

// Bank sandbox routes
app.get('/bank', requireAuth, async (req, res) => {
  // initialize session from templates if empty
  const accounts = await bank.listAccounts(req.sessionID);
  if (!accounts || accounts.length === 0) {
    const templates = await db.listBankTemplates();
    for (const t of templates) {
      await bank.createAccount(req.sessionID, t.owner_name, t.balance_cents);
    }
  }
  const finalAccounts = await bank.listAccounts(req.sessionID);
  const status = req.query.status || null;
  const msg = req.query.msg || null;
  res.render('bank', { accounts: finalAccounts, status, msg });
});

app.post('/bank/accounts', requireAuth, async (req, res) => {
  const owner = req.body.owner;
  const balance = Math.round(parseFloat(req.body.balance || '0') * 100);
  await bank.createAccount(req.sessionID, owner, balance);
  // log audit at app-level
  try { await db.logAudit(req.session.user ? req.session.user.email : 'unknown', 'create_account', `owner=${owner} balance=${balance}`); } catch (e) {}
  res.redirect('/bank');
});

app.post('/bank/transfer', requireAuth, async (req, res) => {
  const rawFrom = req.body.from;
  const rawTo = req.body.to;
  // basic server-side validation: ensure a real account was chosen
  if (!rawFrom || !rawTo) {
    return res.redirect(`/bank?status=failed&msg=${encodeURIComponent('Please choose both From and To accounts')}`);
  }
  const from = Number(rawFrom);
  const to = Number(rawTo);
  if (from === to) {
    return res.redirect(`/bank?status=failed&msg=${encodeURIComponent('From and To accounts must be different')}`);
  }
  // prefer explicit cents field from client-side helper when available
  const amount = req.body.amount_cents ? Number(req.body.amount_cents) : Math.round(parseFloat(req.body.amount || '0') * 100);
  const note = req.body.note;
  const tx = await bank.transfer(req.sessionID, from, to, amount, note);
  const status = tx.status || 'failed';
  // show a clear, user-friendly message on success/failure rather than the raw tx note
  let msg = '';
  if (status === 'success') {
    msg = 'Transaction completed successfully';
  } else if (tx.error) {
    msg = tx.error;
  } else if (tx.note) {
    // fallback to note only for additional context when not success
    msg = tx.note;
  }
  return res.redirect(`/bank?status=${encodeURIComponent(status)}&msg=${encodeURIComponent(msg)}`);
});

app.post('/bank/reset', requireAuth, async (req, res) => {
  await sessionDb.deleteSessionDb(req.sessionID);
  try { await db.logAudit(req.session.user ? req.session.user.email : 'unknown', 'reset_sandbox', `session=${req.sessionID}`); } catch (e) {}
  res.redirect('/bank');
});

// Admin audit CSV download
app.get('/admin/audit.csv', requireAdmin, async (req, res) => {
  const rows = await db.listAudits();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${Date.now()}.csv"`);
  res.write('id,actor,action,details,created_at\n');
  for (const r of rows) {
    const line = [r.id, r.actor || '', r.action || '', (r.details || '').replace(/\r?\n/g, ' '), r.created_at].map(v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',');
    res.write(line + '\n');
  }
  res.end();
});

app.get('/bank/transactions', requireAuth, async (req, res) => {
  const tx = await bank.listTransactions(req.sessionID);
  res.render('bank-transactions', { tx });
});

// CSV download for transactions
app.get('/bank/transactions.csv', requireAuth, async (req, res) => {
  const tx = await bank.listTransactions(req.sessionID);
  // CSV header
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${Date.now()}.csv"`);
  const header = ['id','from_account','from_owner','to_account','to_owner','amount_cents','status','note','created_at'];
  const rows = tx.map(t => [
    t.id,
    t.from_account,
    t.from_owner_name || '',
    t.to_account,
    t.to_owner_name || '',
    t.amount_cents,
    t.status,
    (t.note || '').replace(/\r?\n/g, ' '),
    t.created_at
  ]);
  // write CSV
  res.write(header.join(',') + '\n');
  for (const r of rows) {
    // simple CSV escape: wrap fields that contain comma or quotes
    const line = r.map(v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',');
    res.write(line + '\n');
  }
  res.end();
});

app.get('/attempts', requireAuth, async (req, res) => {
  const attempts = await db.getAttemptsByUser(req.session.user.id);
  res.render('attempts', { attempts });
});

app.get('/labs/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const lab = LAB_CATALOG.find(l => l.id === id);
  if (!lab) return res.status(404).send('Lab not found');
  res.render('lab-detail', { lab });
});



app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/tester-login'));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
