'use strict';

require('dotenv').config();

const express     = require('express');
const session     = require('express-session');
const cookieParser = require('cookie-parser');
const rateLimit   = require('express-rate-limit');
const path        = require('path');
const ipRangeCheck = require('ip-range-check');
const db          = require('./db');

const { ipWhitelist, getClientIp } = require('./middleware/ipWhitelist');
const { attachGuest }              = require('./middleware/guestAuth');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
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

// ── Attach isWhitelisted flag ─────────────────────────────────────────────────
function parseAllowedIps() {
  return (process.env.ALLOWED_IPS || '127.0.0.1,::1')
    .split(',').map(s => s.trim()).filter(Boolean);
}
app.use((req, res, next) => {
  const ip = getClientIp(req);
  try {
    req.isWhitelisted = ipRangeCheck(ip, parseAllowedIps());
  } catch (_) {
    req.isWhitelisted = false;
  }
  next();
});

// ── IP whitelist middleware (blocks non-whitelisted except /share/ routes) ────
app.use(ipWhitelist);

// ── Guest session attachment ──────────────────────────────────────────────────
app.use(attachGuest);

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/projects',                         require('./routes/projects'));
app.use('/api/projects/:projectId',              require('./routes/boards'));
app.use('/api/share',                            require('./routes/share'));

// ── SPA fallback: serve index.html for all non-API routes ────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  // Block non-whitelisted users from HTML pages (except share page)
  if (!req.isWhitelisted && !req.path.startsWith('/share')) {
    // ipWhitelist middleware already handles this, but double-check
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`\n  🚀  TodoLister running at http://localhost:${PORT}\n`);
  db.query('SELECT 1')
    .then(() => console.log('  ✅  MySQL connection ready.\n'))
    .catch(err => {
      const code = err?.code ? ` (${err.code})` : '';
      console.error(`  ❌  MySQL unreachable${code}. Configure a reachable DB in .env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME).\n`);
    });
});
