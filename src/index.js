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
// serve static assets (CSS)
app.use('/public', express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({ secret: 'dev-secret', resave: false, saveUninitialized: false }));

// simple middleware to expose user to views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
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
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
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
  res.render('admin', { invites });
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
  // set session
  req.session.user = { id: user.id, email: user.email, role: 'tester' };
  // mark invite used
  await db.useInvite(token);
  res.redirect('/labs');
});

// Protected area
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  next();
}

app.get('/labs', requireAuth, (req, res) => {
  res.render('labs', { labs: [{ id: 1, title: 'Sample Lab', description: 'A practice lab for novices.' }] });
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
  const msg = tx.note || '';
  return res.redirect(`/bank?status=${encodeURIComponent(status)}&msg=${encodeURIComponent(msg)}`);
});

app.post('/bank/reset', requireAuth, async (req, res) => {
  await sessionDb.deleteSessionDb(req.sessionID);
  res.redirect('/bank');
});

app.get('/bank/transactions', requireAuth, async (req, res) => {
  const tx = await bank.listTransactions(req.sessionID);
  res.render('bank-transactions', { tx });
});

app.get('/attempts', requireAuth, async (req, res) => {
  const attempts = await db.getAttemptsByUser(req.session.user.id);
  res.render('attempts', { attempts });
});

app.get('/labs/:id', requireAuth, (req, res) => {
  res.render('lab-detail', { lab: { id: req.params.id, title: 'Sample Lab', instructions: 'Type "hello" in the box and submit.' } });
});

app.post('/labs/:id/run', requireAuth, async (req, res) => {
  const answer = req.body.answer || '';
  const TIMEOUT_MS = 2000;

  function runLab(answer) {
    return new Promise((resolve) => {
      // simulate async work by delaying a bit
      const simulatedMs = 100 + Math.floor(Math.random() * 200);
      setTimeout(() => {
        const ok = answer.trim().toLowerCase() === 'hello';
        const output = ok ? 'Success: matched expected output' : 'Failure: expected "hello"';
        resolve({ ok, output });
      }, simulatedMs);
    });
  }

  const start = Date.now();
  let result;
  try {
    result = await Promise.race([
      runLab(answer),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]);
  } catch (err) {
    result = { ok: false, output: 'Execution timed out' };
  }

  const duration = Date.now() - start;
  db.createAttempt(req.session.user.id, req.params.id, result.ok, result.output, duration).catch(() => {});
  res.render('lab-result', { ok: result.ok, output: result.output });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
