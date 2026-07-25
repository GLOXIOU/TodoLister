'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const bcrypt   = require('bcryptjs');
const defaults = require('../config/defaults.json');
const { formatDbError } = require('../utils/dbError');

// ── List all projects ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, description, repo_url, status, visibility, created_at, updated_at
       FROM projects ORDER BY updated_at DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' });
  }
});

// ── Get single project ────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, description, repo_url, status, visibility, created_at, updated_at
       FROM projects WHERE id = ? LIMIT 1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    const project = rows[0];

    // Non-whitelisted guests can only see public projects they have a token for
    if (!req.isWhitelisted) {
      if (project.visibility === 'private') {
        return res.status(403).json({ error: 'PRIVATE', message: 'This project is private.' });
      }
      if (!req.guest || req.guest.project_id !== project.id) {
        return res.status(401).json({ error: 'PASSWORD_REQUIRED' });
      }
    }

    res.json(project);
  } catch (e) {
    res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' });
  }
});

// ── Create project ────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  const { name, description, repo_url, status, visibility, share_password } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });

  let hash = null;
  if (visibility === 'public' && share_password) {
    hash = await bcrypt.hash(share_password, 10);
  }

  let conn = null;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO projects (name, description, repo_url, status, visibility, share_password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, description || null, repo_url || null, status || 'in_dev', visibility || 'private', hash]
    );
    const projectId = result.insertId;

    // Seed default categories & statuses
    for (const cat of defaults.categories) {
      await conn.query(
        `INSERT INTO categories (project_id, name, color, position) VALUES (?, ?, ?, ?)`,
        [projectId, cat.name, cat.color, cat.position]
      );
    }
    for (const st of defaults.statuses) {
      await conn.query(
        `INSERT INTO statuses (project_id, name, color, position) VALUES (?, ?, ?, ?)`,
        [projectId, st.name, st.color, st.position]
      );
    }
    // Empty note
    await conn.query(`INSERT INTO notes (project_id, content) VALUES (?, '')`, [projectId]);

    await conn.commit();
    res.status(201).json({ id: projectId });
  } catch (e) {
    if (conn) await conn.rollback();
    res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' });
  } finally {
    if (conn) conn.release();
  }
});

// ── Update project ────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  const { name, description, repo_url, status, visibility, share_password, guest_permission } = req.body;

  try {
    // Build dynamic update
    const fields = [];
    const vals   = [];

    if (name        !== undefined) { fields.push('name = ?');        vals.push(name); }
    if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
    if (repo_url    !== undefined) { fields.push('repo_url = ?');    vals.push(repo_url); }
    if (status      !== undefined) { fields.push('status = ?');      vals.push(status); }
    if (visibility  !== undefined) { fields.push('visibility = ?');  vals.push(visibility); }

    if (share_password !== undefined) {
      if (share_password === '') {
        fields.push('share_password_hash = ?'); vals.push(null);
      } else {
        const hash = await bcrypt.hash(share_password, 10);
        fields.push('share_password_hash = ?'); vals.push(hash);
      }
    }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });

    vals.push(req.params.id);
    await db.query(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' });
  }
});

// ── Delete project ────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  try {
    await db.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' });
  }
});

module.exports = router;
