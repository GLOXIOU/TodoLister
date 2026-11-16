'use strict';

const ipRangeCheck = require('ip-range-check');

/**
 * Parse the ALLOWED_IPS env var into an array of strings/CIDRs.
 */
function parseAllowedIps() {
  const raw = process.env.ALLOWED_IPS || '127.0.0.1,::1';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Parse TRUST_PROXY into a value for Express' "trust proxy" setting.
 * Unset/false → X-Forwarded-For is ignored (the socket address is used).
 */
function parseTrustProxy(raw) {
  const v = (raw || '').trim();
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Client IP as seen by Express. `req.ip` only honours X-Forwarded-For when
 * "trust proxy" is configured, so the header cannot be spoofed to bypass the
 * whitelist. IPv4-mapped IPv6 addresses (::ffff:1.2.3.4) are normalised.
 */
function getClientIp(req) {
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function isAllowedIp(ip, allowed = parseAllowedIps()) {
  try {
    return ipRangeCheck(ip, allowed);
  } catch (_) {
    return false; // ipRangeCheck throws on malformed input
  }
}

let warnedAboutProxy = false;

/** Sets req.clientIp and req.isWhitelisted for every request. */
function attachWhitelistFlag(req, res, next) {
  req.clientIp      = getClientIp(req);
  req.isWhitelisted = isAllowedIp(req.clientIp);

  if (!warnedAboutProxy && req.headers['x-forwarded-for'] && !req.app.get('trust proxy')) {
    warnedAboutProxy = true;
    console.warn(
      '  ⚠  Received X-Forwarded-For but TRUST_PROXY is not set — the header is ignored.\n' +
      '     If TodoLister runs behind a reverse proxy, set TRUST_PROXY in .env (e.g. TRUST_PROXY=loopback).'
    );
  }
  next();
}

// Routes reachable without a whitelisted IP. Each has its own auth.
const SHARE_PAGE = /^\/share\/\d+\/?$/;
const SHARE_AUTH = /^\/api\/share\/\d+\/auth$/;
const GUEST_API  = /^\/api\/projects\/(\d+)(?:\/|$)/;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Hard IP whitelist gate. Non-whitelisted clients can only reach:
 *  - the /share/:id page and the share password endpoint;
 *  - the API of the one public project their guest session was issued for.
 * Static assets are served before this middleware (see server.js).
 */
function ipWhitelist(req, res, next) {
  if (req.isWhitelisted) return next();
  if (SHARE_PAGE.test(req.path) || SHARE_AUTH.test(req.path)) return next();

  const guestApi = req.path.match(GUEST_API);
  if (guestApi) {
    if (req.guest && req.guest.project_id === Number(guestApi[1])) return next();
    // Lets the share page fall back to its password form.
    return res.status(401).json({ error: 'PASSWORD_REQUIRED', message: 'Password required.' });
  }

  // Return JSON for API calls, HTML page otherwise
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'You are not authorized to use this service.'
    });
  }

  res.status(403).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Access Denied — TodoLister</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0a0a;color:#fff;font-family:'JetBrains Mono',monospace;
         display:flex;align-items:center;justify-content:center;min-height:100vh;
         flex-direction:column;gap:1.5rem;text-align:center;padding:2rem}
    .icon{font-size:3rem}
    h1{color:#ff4444;font-size:1.5rem;letter-spacing:.05em}
    p{color:#666;font-size:.9rem;max-width:400px;line-height:1.6}
    code{color:#00ff88;background:#111;padding:.2em .5em;border-radius:3px}
  </style>
</head>
<body>
  <div class="icon">🚫</div>
  <h1>ACCESS DENIED</h1>
  <p>Your IP (<code>${escapeHtml(req.clientIp)}</code>) is not authorized to access this service.<br>
  Contact the administrator to be added to the whitelist.</p>
</body>
</html>
  `);
}

module.exports = { ipWhitelist, attachWhitelistFlag, getClientIp, parseTrustProxy, isAllowedIp };
