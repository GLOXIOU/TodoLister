'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { formatDbError } = require('../utils/dbError');

/**
 * POST /api/share/:projectId/auth
 * Verify share password and set a guest_token cookie.
 */
router.post('/:projectId/auth', async (req, res) => {
  try {
    const { password } = req.body;
    const pid = parseInt(req.params.projectId);

    if (!password) return res.status(400).json({ error: 'Password required.' });

    const [rows] = await db.query(
      'SELECT id, visibility, share_password_hash FROM projects WHERE id = ? LIMIT 1', [pid]
    );
    if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    const project = rows[0];
    if (project.visibility !== 'public') {
      return res.status(403).json({ error: 'PRIVATE', message: 'This project is private.' });
    }
    if (!project.share_password_hash) {
      return res.status(403).json({ error: 'NO_PASSWORD', message: 'Project has no share password set.' });
    }

    const match = await bcrypt.compare(password, project.share_password_hash);
    if (!match) return res.status(401).json({ error: 'WRONG_PASSWORD' });

    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [existing] = await db.query(
      `SELECT permission FROM guest_sessions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`, [pid]
    );
    const permission = existing[0]?.permission || 'editor';

    await db.query(
      `INSERT INTO guest_sessions (project_id, session_token, permission, expires_at)
       VALUES (?, ?, ?, ?)`,
      [pid, token, permission, expiresAt]
    );

    res.cookie('guest_token', token, {
      httpOnly: true,
      sameSite: 'strict',
      expires: expiresAt
    });

    res.json({ ok: true, permission });
  } catch (e) {
    res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' });
  }
});

/**
 * PUT /api/share/:projectId/permission
 * Change guest permission level (whitelisted owners only).
 */
router.put('/:projectId/permission', async (req, res) => {
  try {
    if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
    const { permission } = req.body;
    const valid = ['observer', 'card_mover', 'editor'];
    if (!valid.includes(permission)) {
      return res.status(400).json({ error: `Permission must be one of: ${valid.join(', ')}` });
    }
    await db.query(
      `UPDATE guest_sessions SET permission = ? WHERE project_id = ? AND expires_at > NOW()`,
      [permission, req.params.projectId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' });
  }
});

/**
 * DELETE /api/share/:projectId/revoke
 * Revoke all guest sessions for a project.
 */
router.delete('/:projectId/revoke', async (req, res) => {
  try {
    if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
    await db.query('DELETE FROM guest_sessions WHERE project_id = ?', [req.params.projectId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' });
  }
});

module.exports = router;
