'use strict';

const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');
const db        = require('../db');
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const v         = require('../utils/validate');
const { wrap, HttpError, badRequest, notFound } = require('../utils/http');
const { ownerOnly, guestCookieName, hashToken, GUEST_SESSION_DAYS } = require('../middleware/guestAuth');

// Slow down share-password brute forcing: 10 attempts / 15 min per IP and project.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: req => `${req.clientIp}:${req.params.projectId}`,
  message: { error: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' }
});

function projectIdParam(req) {
  const pid = v.parseId(req.params.projectId);
  if (!pid) throw notFound('Project not found.');
  return pid;
}

/**
 * POST /api/share/:projectId/auth
 * Verify share password and set a per-project guest cookie.
 */
router.post('/:projectId/auth', authLimiter, wrap(async (req, res) => {
  const pid      = projectIdParam(req);
  const password = req.body?.password;
  if (typeof password !== 'string' || !password) throw badRequest('Password required.');
  if (password.length > 128) throw new HttpError(401, 'WRONG_PASSWORD', 'Wrong password.');

  const [rows] = await db.query(
    'SELECT visibility, share_password_hash, guest_permission FROM projects WHERE id = ? LIMIT 1', [pid]
  );
  // Same answer for "missing" and "private": don't reveal which ids exist.
  if (!rows.length || rows[0].visibility !== 'public') {
    throw new HttpError(403, 'PRIVATE', 'This project is private or does not exist.');
  }
  const project = rows[0];
  if (!project.share_password_hash) {
    throw new HttpError(403, 'NO_PASSWORD', 'This project has no share password yet.');
  }
  if (!await bcrypt.compare(password, project.share_password_hash)) {
    throw new HttpError(401, 'WRONG_PASSWORD', 'Wrong password.');
  }

  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + GUEST_SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO guest_sessions (project_id, session_token, permission, expires_at) VALUES (?, ?, ?, ?)`,
    [pid, hashToken(token), project.guest_permission, expiresAt]
  );

  res.cookie(guestCookieName(pid), token, {
    httpOnly: true,
    sameSite: 'strict',
    secure:   req.secure,
    path:     '/',
    expires:  expiresAt
  });

  res.json({ ok: true, permission: project.guest_permission });
}));

/**
 * PUT /api/share/:projectId/permission
 * Set the guest permission level of a project. Applies to current guests immediately.
 */
router.put('/:projectId/permission', ownerOnly, wrap(async (req, res) => {
  const pid        = projectIdParam(req);
  const permission = v.oneOf(req.body?.permission, 'permission', v.GUEST_PERMISSIONS);
  if (!permission) throw badRequest(`permission must be one of: ${v.GUEST_PERMISSIONS.join(', ')}.`);

  const [r] = await db.query('UPDATE projects SET guest_permission = ? WHERE id = ?', [permission, pid]);
  if (!r.affectedRows) throw notFound('Project not found.');
  res.json({ ok: true });
}));

/**
 * DELETE /api/share/:projectId/revoke
 * Revoke all guest sessions for a project.
 */
router.delete('/:projectId/revoke', ownerOnly, wrap(async (req, res) => {
  const pid = projectIdParam(req);
  const [r] = await db.query('DELETE FROM guest_sessions WHERE project_id = ?', [pid]);
  res.json({ ok: true, revoked: r.affectedRows });
}));

module.exports = router;
