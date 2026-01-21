// Load local .env first (if present). This is optional for production because
// platform env vars (Render) will override values at runtime.
try { require('dotenv').config(); } catch (e) { /* dotenv not installed/available */ }
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
// allow JSON bodies for AJAX status updates
app.use(express.json());

// Session configuration: prefer Redis when REDIS_URL is provided, else use SQLite store.
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
let sessionStore = null;
// track which store we initialized for runtime diagnostics
let sessionStoreType = 'memory';
// Prefer MongoDB session store when MONGODB_URI is provided (supports connect-mongo v4+),
// else prefer Redis when REDIS_URL is provided, else use SQLite store.
if (process.env.MONGODB_URI) {
  try {
    // Support both connect-mongo v4+ (exports.create) and older v3 (factory that takes session)
    const maybe = require('connect-mongo');
    if (maybe && typeof maybe.create === 'function') {
      // v4+: use create factory
      sessionStore = maybe.create({
        mongoUrl: process.env.MONGODB_URI,
        mongoOptions: { useNewUrlParser: true, useUnifiedTopology: true },
        collectionName: 'sessions'
      });
    } else if (typeof maybe === 'function') {
      // v3 style: require('connect-mongo')(session) returns a Store constructor
      try {
        const MongoStore = maybe(session);
        // older API expects 'url' option
        sessionStore = new MongoStore({ url: process.env.MONGODB_URI, collection: 'sessions' });
      } catch (e2) {
        throw e2;
      }
    } else {
      throw new Error('connect-mongo: unexpected export shape: ' + String(Object.keys(maybe || {})));
    }
  sessionStoreType = 'mongo';
  console.log('Using MongoDB session store');
  } catch (e) {
    // don't crash if module isn't installed or fails to initialize; fall through to other stores
    console.warn('MONGODB_URI set but failed to initialize connect-mongo; falling back to other session stores', e && e.message);
    // For diagnostics, also print the stack at debug level
    if (process.env.DEBUG) console.warn(e && e.stack);
  }
}
// prefer Redis when REDIS_URL is provided, else use SQLite store.
if (process.env.REDIS_URL) {
  // lazily require redis-based store
  try {
    const Redis = require('ioredis');
    const RedisStoreFactory = require('connect-redis');
    const RedisStore = RedisStoreFactory(session);
    const redisClient = new Redis(process.env.REDIS_URL);
    sessionStore = new RedisStore({ client: redisClient });
    sessionStoreType = 'redis';
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
  sessionStoreType = 'sqlite';
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
  ,
  {
    id: 2,
    title: 'Loan Application',
    description: 'quick loan',
    problem: 'Apply for a small quick loan, validate eligibility, and observe approval or rejection flows in a sandboxed environment.',
    steps: [
      'Open the Loan Application lab and review the eligibility criteria.',
      'Fill and submit a loan application with necessary details.',
      'Observe the approval/rejection outcome and any changes to account balances.',
      'Reset the sandbox to try different scenarios.'
    ],
    hints: [
      'Use realistic but small amounts for quick approvals.',
      'If you simulate a poor credit profile, expect rejection.'
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
    // try to include the current git commit (if .git is present) and which session store we initialized
    let gitCommit = null;
    try {
      const cp = require('child_process');
      gitCommit = cp.execSync('git rev-parse --short HEAD').toString().trim();
    } catch (e) {
      gitCommit = process.env.GIT_COMMIT || null;
    }
    res.json({ dbFile, testers, gitCommit, sessionStoreType });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Admin: create tester user (username + optional email)
app.post('/admin/testers', requireAdmin, async (req, res) => {
  const username = req.body.username;
  const email = req.body.email || null;
  try {
    // prefer admin-scoped tester insert when available so admin-created testers
    // are stored separately in Mongo (`admin_testers`) if configured
    if (typeof db.createAdminTester === 'function') {
      await db.createAdminTester(username, email);
    } else {
      await db.createTester(username, email);
    }
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

// Loan Application lab - simple interactive sandbox
app.get('/labs/2', requireAuth, async (req, res) => {
  // optional query params for banner
  const status = req.query.status || null;
  const msg = req.query.msg || null;
  // display the loan application form
  return res.render('lab-loan', { status, msg, userDisplay: res.locals.userDisplayName });
});

app.post('/labs/2/apply', requireAuth, async (req, res) => {
  const name = (req.body.name || '').toString().trim();
  const amount = Math.round(parseFloat(req.body.amount || '0') * 100);
  const income = Math.round(parseFloat(req.body.income || '0') * 100);
  const term = Number(req.body.term || 0);
  if (!name || amount <= 0 || income <= 0 || term <= 0) {
    return res.redirect(`/labs/2?status=failed&msg=${encodeURIComponent('Please provide valid application data')}`);
  }
  try {
    // prepare session DB table for loan applications (keeps loans separate from bank sandbox)
    const dbSession = await sessionDb.getSessionDb(req.sessionID);
    await dbSession.exec(`
      CREATE TABLE IF NOT EXISTS loan_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        amount_cents INTEGER,
        income_cents INTEGER,
        term_months INTEGER,
        status TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Basic quick-loan eligibility rules (sandbox):
    // - max loan amount: ₦100,000
    // - require monthly income >= 1/3 of requested amount
    const MAX_LOAN = 100000 * 100; // in cents
    if (amount > MAX_LOAN) {
      await dbSession.run('INSERT INTO loan_applications(name,amount_cents,income_cents,term_months,status,note) VALUES(?,?,?,?,?,?)', name, amount, income, term, 'rejected', 'exceeds max quick-loan amount');
      await db.logAudit(req.session.user ? req.session.user.email : 'unknown', 'loan_application', `name=${name} amount=${amount} result=rejected_max`);
      return res.redirect(`/labs/2?status=failed&msg=${encodeURIComponent('Loan exceeds quick-loan maximum (₦100,000)')}`);
    }
    if (income * 1 < Math.ceil(amount / 3)) {
      await dbSession.run('INSERT INTO loan_applications(name,amount_cents,income_cents,term_months,status,note) VALUES(?,?,?,?,?,?)', name, amount, income, term, 'rejected', 'insufficient income');
      await db.logAudit(req.session.user ? req.session.user.email : 'unknown', 'loan_application', `name=${name} amount=${amount} result=rejected_income`);
      return res.redirect(`/labs/2?status=failed&msg=${encodeURIComponent('Loan rejected: insufficient income')}`);
    }
    // approved: record the loan application in the loan_applications table (separate from bank sandbox)
    await dbSession.run('INSERT INTO loan_applications(name,amount_cents,income_cents,term_months,status,note) VALUES(?,?,?,?,?,?)', name, amount, income, term, 'approved', 'Quick loan approved (not credited to bank sandbox accounts)');
    await db.logAudit(req.session.user ? req.session.user.email : 'unknown', 'loan_application', `name=${name} amount=${amount} result=approved`);
    return res.redirect(`/labs/2?status=success&msg=${encodeURIComponent('Loan approved (recorded separately)')}`);
  } catch (err) {
    console.error('Loan application error:', err && err.stack ? err.stack : String(err));
    try { await db.logAudit(req.session.user ? req.session.user.email : 'unknown', 'loan_application', `name=${name} amount=${amount} result=error err=${String(err)}`); } catch (e) {}
      try {
        const sdb = await sessionDb.getSessionDb(req.sessionID);
        await sdb.exec(`
          CREATE TABLE IF NOT EXISTS loan_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            amount_cents INTEGER,
            income_cents INTEGER,
            term_months INTEGER,
            status TEXT,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await sdb.run('INSERT INTO loan_applications(name,amount_cents,income_cents,term_months,status,note) VALUES(?,?,?,?,?,?)', name, amount, income, term, 'error', String(err));
      } catch (e) {
        // ignore recording errors
      }
      return res.redirect(`/labs/2?status=failed&msg=${encodeURIComponent('Internal error processing loan application')}`);
  }
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
  const statusRaw = (req.body.status || 'active').toString().toLowerCase();
  const allowed = ['active', 'dormant', 'debit freeze', 'credit freeze', 'total freeze', 'inactive'];
  if (!allowed.includes(statusRaw)) {
    return res.redirect(`/bank?status=failed&msg=${encodeURIComponent('Invalid status. Allowed: ' + allowed.join(', '))}`);
  }
  try {
    await bank.createAccount(req.sessionID, owner, balance, statusRaw);
  } catch (e) {
    return res.redirect(`/bank?status=failed&msg=${encodeURIComponent(String(e))}`);
  }
  // log audit at app-level
  try { await db.logAudit(req.session.user ? req.session.user.email : 'unknown', 'create_account', `owner=${owner} balance=${balance}`); } catch (e) {}
  res.redirect('/bank');
});

// AJAX endpoint to update an individual account status in the session DB
app.post('/bank/accounts/:id/status', requireAuth, async (req, res) => {
  const id = req.params.id;
  const status = (req.body && req.body.status) ? req.body.status.toString().toLowerCase() : null;
  const allowed = ['active', 'dormant', 'debit freeze', 'credit freeze', 'total freeze', 'inactive'];
  if (!status) return res.status(400).json({ error: 'Missing status' });
  if (!allowed.includes(status)) return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` });
  try {
    const acc = await bank.updateAccountStatus(req.sessionID, id, status);
    return res.json({ ok: true, account: acc });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
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
  try {
    const tx = await bank.transfer(req.sessionID, from, to, amount, note);
    const status = tx && tx.status ? tx.status : 'failed';
    // show a clear, user-friendly message on success/failure rather than the raw tx note
    let msg = '';
    if (status === 'success') {
      msg = 'Transaction completed successfully';
    } else if (tx && tx.error) {
      msg = tx.error;
    } else if (tx && tx.note) {
      // fallback to note only for additional context when not success
      msg = tx.note;
    } else {
      msg = 'Transaction failed';
    }
    return res.redirect(`/bank?status=${encodeURIComponent(status)}&msg=${encodeURIComponent(msg)}`);
  } catch (err) {
    // Unexpected error: log and show a helpful message instead of letting the process crash.
    console.error('Unexpected error during transfer:', err && err.stack ? err.stack : String(err));
    try { await db.logAudit(req.session.user ? req.session.user.email : 'unknown', 'transfer_error', `err=${String(err)}`); } catch (e) {}
    // If this looks like a business error (insufficient funds, account not found, status block), surface it to the user.
    const emsg = err && err.message ? err.message : String(err);
    const lowered = String(emsg).toLowerCase();
    if (lowered.includes('insufficient') || lowered.includes('cannot be') || lowered.includes('account not found')) {
      return res.redirect(`/bank?status=failed&msg=${encodeURIComponent(emsg)}`);
    }
    return res.redirect(`/bank?status=failed&msg=${encodeURIComponent('Internal server error during transfer')}`);
  }
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

// global express error handler (last middleware)
app.use(async (err, req, res, next) => {
  console.error('Unhandled Express error:', err && err.stack ? err.stack : String(err));
  // If the request expects JSON, return JSON error
  if (req.accepts('json') && !req.accepts('html')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  // For bank routes try to render the bank page with current accounts and a friendly banner
  if (req.path && req.path.startsWith('/bank')) {
    try {
      const accounts = req.sessionID ? await bank.listAccounts(req.sessionID) : [];
      return res.status(500).render('bank', { accounts, status: 'failed', msg: 'Internal server error' });
    } catch (e) {
      console.error('Failed to load accounts for error page:', e && e.stack ? e.stack : String(e));
      return res.status(500).render('bank', { accounts: [], status: 'failed', msg: 'Internal server error' });
    }
  }
  res.status(500).send('Internal server error');
});

// process-level handlers to avoid the node process exiting silently on unexpected errors.
// We log and keep the process alive so the app remains reachable; in production you may prefer to
// crash and let a process manager restart the service.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err && err.stack ? err.stack : String(err));
});
process.on('unhandledRejection', (reason, p) => {
  console.error('unhandledRejection at:', p, 'reason:', reason && reason.stack ? reason.stack : String(reason));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
