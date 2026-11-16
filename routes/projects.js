'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const bcrypt   = require('bcryptjs');
const defaults = require('../config/defaults.json');
const v        = require('../utils/validate');
const { wrap, badRequest, notFound } = require('../utils/http');
const { withTransaction } = require('../utils/transaction');
const { ownerOnly, resolveAccess } = require('../middleware/guestAuth');

const PUBLIC_FIELDS = 'id, name, description, repo_url, status, visibility, created_at, updated_at';
const OWNER_FIELDS  = `${PUBLIC_FIELDS}, guest_permission, (share_password_hash IS NOT NULL) AS has_share_password`;

function toOwnerJson(row) {
  return { ...row, has_share_password: Boolean(row.has_share_password) };
}

// ── List all projects ─────────────────────────────────────────────────────────
router.get('/', ownerOnly, wrap(async (req, res) => {
  const [rows] = await db.query(`SELECT ${OWNER_FIELDS} FROM projects ORDER BY updated_at DESC`);
  res.json(rows.map(toOwnerJson));
}));

// ── Get single project ────────────────────────────────────────────────────────
// Owners get share settings; guests get the public fields plus their level.
router.get('/:id', wrap(async (req, res) => {
  const id = v.parseId(req.params.id);
  if (!id) throw notFound('Project not found.');

  const access  = await resolveAccess(req, id);
  const isOwner = access === 'owner';
  const [rows]  = await db.query(
    `SELECT ${isOwner ? OWNER_FIELDS : PUBLIC_FIELDS} FROM projects WHERE id = ? LIMIT 1`, [id]
  );
  if (!rows.length) throw notFound('Project not found.');

  res.json({ ...(isOwner ? toOwnerJson(rows[0]) : rows[0]), access });
}));

// ── Create project ────────────────────────────────────────────────────────────
router.post('/', ownerOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const name             = v.text(b.name, 'Name', 120, { required: true });
  const description      = v.text(b.description, 'Description', 10000) ?? null;
  const repo_url         = v.httpUrl(b.repo_url, 'Repository URL') ?? null;
  const status           = v.oneOf(b.status, 'status', v.PROJECT_STATUSES) ?? 'in_dev';
  const visibility       = v.oneOf(b.visibility, 'visibility', v.VISIBILITIES) ?? 'private';
  const guest_permission = v.oneOf(b.guest_permission, 'guest_permission', v.GUEST_PERMISSIONS) ?? 'observer';
  const password         = v.sharePassword(b.share_password);

  if (visibility === 'public' && !password) {
    throw badRequest('A share password is required for public projects.');
  }
  const hash = password ? await bcrypt.hash(password, 10) : null;

  const projectId = await withTransaction(async conn => {
    const [result] = await conn.query(
      `INSERT INTO projects (name, description, repo_url, status, visibility, share_password_hash, guest_permission)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description, repo_url, status, visibility, hash, guest_permission]
    );
    const pid = result.insertId;

    // Seed default categories & statuses
    await conn.query(
      'INSERT INTO categories (project_id, name, color, position) VALUES ?',
      [defaults.categories.map(c => [pid, c.name, c.color, c.position])]
    );
    await conn.query(
      'INSERT INTO statuses (project_id, name, color, position) VALUES ?',
      [defaults.statuses.map(s => [pid, s.name, s.color, s.position])]
    );
    await conn.query(`INSERT INTO notes (project_id, content) VALUES (?, '')`, [pid]);
    return pid;
  });

  res.status(201).json({ id: projectId });
}));

// ── Update project ────────────────────────────────────────────────────────────
router.put('/:id', ownerOnly, wrap(async (req, res) => {
  const id = v.parseId(req.params.id);
  if (!id) throw notFound('Project not found.');

  const [existingRows] = await db.query(
    'SELECT visibility, share_password_hash FROM projects WHERE id = ? LIMIT 1', [id]
  );
  if (!existingRows.length) throw notFound('Project not found.');
  const existing = existingRows[0];

  const b = req.body || {};
  const updates = {
    name:             v.text(b.name, 'Name', 120, { required: b.name !== undefined }),
    description:      v.text(b.description, 'Description', 10000),
    repo_url:         v.httpUrl(b.repo_url, 'Repository URL'),
    status:           v.oneOf(b.status, 'status', v.PROJECT_STATUSES),
    visibility:       v.oneOf(b.visibility, 'visibility', v.VISIBILITIES),
    guest_permission: v.oneOf(b.guest_permission, 'guest_permission', v.GUEST_PERMISSIONS)
  };
  const password = v.sharePassword(b.share_password);

  const fields = [];
  const vals   = [];
  for (const [col, val] of Object.entries(updates)) {
    if (val !== undefined) { fields.push(`${col} = ?`); vals.push(val); }
  }
  if (password !== undefined) {
    fields.push('share_password_hash = ?');
    vals.push(password === null ? null : await bcrypt.hash(password, 10));
  }
  if (!fields.length) throw badRequest('Nothing to update.');

  const finalVisibility  = updates.visibility ?? existing.visibility;
  const finalHasPassword = password === undefined ? Boolean(existing.share_password_hash) : password !== null;
  if (finalVisibility === 'public' && !finalHasPassword) {
    throw badRequest('A share password is required for public projects.');
  }

  // Going private or changing the password logs every guest out.
  const revokeGuests =
    (finalVisibility === 'private' && existing.visibility === 'public') || password !== undefined;

  await withTransaction(async conn => {
    vals.push(id);
    await conn.query(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, vals);
    if (revokeGuests) await conn.query('DELETE FROM guest_sessions WHERE project_id = ?', [id]);
  });

  res.json({ ok: true, guests_revoked: revokeGuests });
}));

// ── Delete project ────────────────────────────────────────────────────────────
router.delete('/:id', ownerOnly, wrap(async (req, res) => {
  const id = v.parseId(req.params.id);
  if (!id) throw notFound('Project not found.');
  const [r] = await db.query('DELETE FROM projects WHERE id = ?', [id]);
  if (!r.affectedRows) throw notFound('Project not found.');
  res.json({ ok: true });
}));

module.exports = router;
