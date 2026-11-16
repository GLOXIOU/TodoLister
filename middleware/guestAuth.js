'use strict';

const crypto = require('crypto');
const db     = require('../db');
const { HttpError, wrap, notFound, forbidden } = require('../utils/http');
const { parseId } = require('../utils/validate');

/** Access levels, lowest to highest. "owner" = whitelisted IP. */
const LEVELS = { observer: 0, card_mover: 1, editor: 2, owner: 3 };

const GUEST_SESSION_DAYS = 7;

/** One cookie per shared project, so a guest can open several shares. */
const guestCookieName = projectId => `guest_${projectId}`;

/** Only a SHA-256 of the token is stored, so a DB leak can't be replayed. */
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

const PROJECT_PATH = /^\/(?:api\/projects|share)\/(\d+)(?:\/|$)/;

/**
 * Attach req.guest = { id, project_id, permission } when the request carries a
 * valid guest cookie for the project in the URL. The session only counts while
 * the project is still public with a password, and the permission is read live
 * from the project — so going private or changing the level applies instantly.
 */
async function attachGuest(req, res, next) {
  req.guest = null;
  if (req.isWhitelisted) return next();

  const match = req.path.match(PROJECT_PATH);
  if (!match) return next();

  const token = req.cookies?.[guestCookieName(match[1])];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return next();

  try {
    const [rows] = await db.query(
      `SELECT gs.id, gs.project_id, p.guest_permission AS permission
         FROM guest_sessions gs
         JOIN projects p ON p.id = gs.project_id
        WHERE gs.session_token = ?
          AND gs.project_id = ?
          AND gs.expires_at > NOW()
          AND p.visibility = 'public'
          AND p.share_password_hash IS NOT NULL
        LIMIT 1`,
      [hashToken(token), Number(match[1])]
    );
    if (rows.length) req.guest = rows[0];
  } catch (err) {
    console.error('[attachGuest]', err?.code || err);
  }
  next();
}

/** Only whitelisted IPs (project owners). */
function ownerOnly(req, res, next) {
  if (req.isWhitelisted) return next();
  next(forbidden('Only the project owner can do this.'));
}

/**
 * Resolve the caller's access level on a project.
 * Throws 404 / 403 PRIVATE / 401 PASSWORD_REQUIRED.
 */
async function resolveAccess(req, projectId) {
  const [rows] = await db.query('SELECT id, visibility FROM projects WHERE id = ? LIMIT 1', [projectId]);
  if (!rows.length) throw notFound('Project not found.');

  if (req.isWhitelisted) return 'owner';
  if (rows[0].visibility !== 'public') throw new HttpError(403, 'PRIVATE', 'This project is private.');
  if (!req.guest || req.guest.project_id !== projectId) {
    throw new HttpError(401, 'PASSWORD_REQUIRED', 'Password required.');
  }
  return req.guest.permission;
}

/** Router-level middleware for /api/projects/:projectId/* — sets req.projectId and req.access. */
const projectAccess = wrap(async (req, res, next) => {
  const projectId = parseId(req.params.projectId);
  if (!projectId) throw notFound('Project not found.');
  req.projectId = projectId;
  req.access    = await resolveAccess(req, projectId);
  next();
});

function deniedMessage(access, level) {
  if (level === 'owner')      return 'Only the project owner can do this.';
  if (access === 'observer')  return 'Your access to this project is read-only.';
  return 'Your access to this project only allows moving cards.';
}

/** Require at least `level` on the current project (after projectAccess). */
function requireLevel(level) {
  return (req, res, next) => {
    if (LEVELS[req.access] >= LEVELS[level]) return next();
    next(forbidden(deniedMessage(req.access, level)));
  };
}

const atLeast = (access, level) => LEVELS[access] >= LEVELS[level];

module.exports = {
  LEVELS, GUEST_SESSION_DAYS,
  attachGuest, ownerOnly, resolveAccess, projectAccess, requireLevel, atLeast,
  guestCookieName, hashToken
};
