'use strict';

require('dotenv').config();

const express      = require('express');
const session      = require('express-session');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const db           = require('./db');

const { ipWhitelist, attachWhitelistFlag, parseTrustProxy } = require('./middleware/ipWhitelist');
const { attachGuest }       = require('./middleware/guestAuth');
const { errorHandler }      = require('./utils/http');
const { ensureSchema, purgeExpiredGuestSessions } = require('./utils/schema');

const app       = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

// Only trust X-Forwarded-For when explicitly behind a reverse proxy.
// Otherwise any client could claim a whitelisted IP with a forged header.
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
app.disable('x-powered-by');

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── Static assets (CSS/JS only — no data) are needed by the /share page too ───
app.use(express.static(PUBLIC_DIR, { index: false }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests. Slow down a bit.' }
}));

// ── Body & cookie parsing ─────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict' }
}));

// ── Access control: whitelist flag → guest session → hard gate ────────────────
app.use(attachWhitelistFlag);
app.use(attachGuest);
app.use(ipWhitelist);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/projects',            require('./routes/projects'));
app.use('/api/projects/:projectId', require('./routes/boards'));
app.use('/api/share',               require('./routes/share'));
app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown API route.' }));

// ── SPA fallback: the gate above already filtered who gets here ───────────────
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
async function prepareDatabase() {
  try {
    await db.query('SELECT 1');
    console.log('  ✅  MySQL connection ready.\n');
  } catch (err) {
    const code = err?.code ? ` (${err.code})` : '';
    console.error(`  ❌  MySQL unreachable${code}. Configure a reachable DB in .env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME).\n`);
    return;
  }
  try {
    await ensureSchema(db);
    await purgeExpiredGuestSessions(db);
    setInterval(() => purgeExpiredGuestSessions(db).catch(() => {}), 6 * 60 * 60 * 1000).unref();
  } catch (err) {
    console.error('  ❌  Schema check failed:', err?.sqlMessage || err?.message || err);
  }
}

if (require.main === module) {
  const PORT = parseInt(process.env.PORT) || 3000;
  app.listen(PORT, () => {
    console.log(`\n  🚀  TodoLister running at http://localhost:${PORT}\n`);
    prepareDatabase();
  });
}

module.exports = app;
