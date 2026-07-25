'use strict';

const db = require('../db');

/**
 * Attach guest session info to req.guest if a valid token cookie exists.
 * This runs on all requests so that project routes can check permissions.
 */
async function attachGuest(req, res, next) {
  req.guest = null;
  const token = req.cookies?.['guest_token'];
  if (!token) return next();

  try {
    const [rows] = await db.query(
      `SELECT * FROM guest_sessions
       WHERE session_token = ? AND expires_at > NOW()
       LIMIT 1`,
      [token]
    );
    if (rows.length) req.guest = rows[0];
  } catch (_) {}
  next();
}

/**
 * Require at least a specific guest permission level OR whitelisted IP.
 * Levels: observer < card_mover < editor
 */
const LEVELS = { observer: 0, card_mover: 1, editor: 2 };

function requirePermission(level) {
  return (req, res, next) => {
    // Whitelisted IPs always have full access
    if (req.isWhitelisted) return next();

    const guest = req.guest;
    if (!guest) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    }

    // Make sure the guest token is for the right project
    const projectId = parseInt(req.params.projectId || req.body?.projectId);
    if (guest.project_id !== projectId) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Token not valid for this project.' });
    }

    if (LEVELS[guest.permission] >= LEVELS[level]) return next();
    return res.status(403).json({ error: 'FORBIDDEN', message: `Requires ${level} permission.` });
  };
}

module.exports = { attachGuest, requirePermission };
