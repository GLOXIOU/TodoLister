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
 * Normalise the IP from the request.
 * Handles IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
 */
function getClientIp(req) {
  const raw =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '';
  return raw.replace(/^::ffff:/, '');
}

/**
 * Hard IP whitelist middleware.
 * Blocks everything if the client IP is not in ALLOWED_IPS.
 * Guest routes (/share/*) bypass this check so that a non-whitelisted user
 * can still access a specific public project after entering the password.
 */
function ipWhitelist(req, res, next) {
  // Allow guest share routes through — they have their own auth
  if (req.path.startsWith('/share/') || req.path.startsWith('/api/share/')) {
    return next();
  }

  const allowed = parseAllowedIps();
  const clientIp = getClientIp(req);

  try {
    if (ipRangeCheck(clientIp, allowed)) {
      return next();
    }
  } catch (_) {
    // ipRangeCheck throws on malformed input — still block
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
  <p>Your IP (<code>${clientIp}</code>) is not authorized to access this service.<br>
  Contact the administrator to be added to the whitelist.</p>
</body>
</html>
  `);
}

module.exports = { ipWhitelist, getClientIp };
