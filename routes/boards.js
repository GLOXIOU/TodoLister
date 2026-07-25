'use strict';

const express = require('express');
const router  = express.Router({ mergeParams: true });
const db      = require('../db');
const { requirePermission } = require('../middleware/guestAuth');
const { formatDbError } = require('../utils/dbError');

// ── Helper: verify project access ─────────────────────────────────────────────
async function checkAccess(req, res) {
  const pid = parseInt(req.params.projectId);
  const [rows] = await db.query('SELECT id, visibility FROM projects WHERE id = ? LIMIT 1', [pid]);
  if (!rows.length) { res.status(404).json({ error: 'NOT_FOUND' }); return null; }
  const project = rows[0];

  if (!req.isWhitelisted) {
    if (project.visibility === 'private') {
      res.status(403).json({ error: 'PRIVATE' }); return null;
    }
    if (!req.guest || req.guest.project_id !== pid) {
      res.status(401).json({ error: 'PASSWORD_REQUIRED' }); return null;
    }
  }
  return project;
}

// ════════════════════════════════════════════════════════════
// FULL BOARD DATA
// ════════════════════════════════════════════════════════════
router.get('/board', async (req, res) => {
  try {
    if (!await checkAccess(req, res)) return;
    const pid = req.params.projectId;

    const [categories] = await db.query(
      'SELECT * FROM categories WHERE project_id = ? ORDER BY position', [pid]);
    const [statuses]   = await db.query(
      'SELECT * FROM statuses   WHERE project_id = ? ORDER BY position', [pid]);
    const [cards]      = await db.query(
      'SELECT * FROM cards      WHERE project_id = ? ORDER BY position', [pid]);

    res.json({ categories, statuses, cards });
  } catch (e) { res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' }); }
});

// ════════════════════════════════════════════════════════════
// CATEGORIES
// ════════════════════════════════════════════════════════════
router.post('/categories', requirePermission('editor'), async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required.' });
  const [r] = await db.query(
    'INSERT INTO categories (project_id, name, color) VALUES (?, ?, ?)',
    [req.params.projectId, name, color || '#00ff88']
  );
  res.status(201).json({ id: r.insertId });
});

router.put('/categories/:id', async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  const { name, color, hidden, position } = req.body;
  const fields = []; const vals = [];
  if (name     !== undefined) { fields.push('name = ?');     vals.push(name); }
  if (color    !== undefined) { fields.push('color = ?');    vals.push(color); }
  if (hidden   !== undefined) { fields.push('hidden = ?');   vals.push(hidden ? 1 : 0); }
  if (position !== undefined) { fields.push('position = ?'); vals.push(position); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing.' });
  vals.push(req.params.id, req.params.projectId);
  await db.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`, vals);
  res.json({ ok: true });
});

router.delete('/categories/:id', async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  await db.query('DELETE FROM categories WHERE id = ? AND project_id = ?',
    [req.params.id, req.params.projectId]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// STATUSES
// ════════════════════════════════════════════════════════════
router.post('/statuses', async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required.' });
  const [r] = await db.query(
    'INSERT INTO statuses (project_id, name, color) VALUES (?, ?, ?)',
    [req.params.projectId, name, color || '#555']
  );
  res.status(201).json({ id: r.insertId });
});

router.put('/statuses/:id', async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  const { name, color, hidden, position } = req.body;
  const fields = []; const vals = [];
  if (name     !== undefined) { fields.push('name = ?');     vals.push(name); }
  if (color    !== undefined) { fields.push('color = ?');    vals.push(color); }
  if (hidden   !== undefined) { fields.push('hidden = ?');   vals.push(hidden ? 1 : 0); }
  if (position !== undefined) { fields.push('position = ?'); vals.push(position); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing.' });
  vals.push(req.params.id, req.params.projectId);
  await db.query(`UPDATE statuses SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`, vals);
  res.json({ ok: true });
});

router.delete('/statuses/:id', async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  await db.query('DELETE FROM statuses WHERE id = ? AND project_id = ?',
    [req.params.id, req.params.projectId]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// CARDS
// ════════════════════════════════════════════════════════════
router.post('/cards', requirePermission('editor'), async (req, res) => {
  const { title, description, category_id, status_id, priority } = req.body;
  if (!title || !category_id || !status_id) {
    return res.status(400).json({ error: 'title, category_id, status_id required.' });
  }
  try {
    const [r] = await db.query(
      `INSERT INTO cards (project_id, category_id, status_id, title, description, priority)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.projectId, category_id, status_id, title, description || null, priority || 'medium']
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) { res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' }); }
});

router.put('/cards/:id', requirePermission('card_mover'), async (req, res) => {
  const { title, description, category_id, status_id, priority, position } = req.body;
  const fields = []; const vals = [];
  if (title       !== undefined) { fields.push('title = ?');       vals.push(title); }
  if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
  if (category_id !== undefined) { fields.push('category_id = ?'); vals.push(category_id); }
  if (status_id   !== undefined) { fields.push('status_id = ?');   vals.push(status_id); }
  if (priority    !== undefined) { fields.push('priority = ?');    vals.push(priority); }
  if (position    !== undefined) { fields.push('position = ?');    vals.push(position); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing.' });
  vals.push(req.params.id, req.params.projectId);
  await db.query(
    `UPDATE cards SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`, vals);
  res.json({ ok: true });
});

router.delete('/cards/:id', requirePermission('editor'), async (req, res) => {
  if (!req.isWhitelisted) return res.status(403).json({ error: 'FORBIDDEN' });
  await db.query('DELETE FROM cards WHERE id = ? AND project_id = ?',
    [req.params.id, req.params.projectId]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// NOTES
// ════════════════════════════════════════════════════════════
router.get('/notes', async (req, res) => {
  try {
    if (!await checkAccess(req, res)) return;
    const [rows] = await db.query(
      'SELECT content, updated_at FROM notes WHERE project_id = ? LIMIT 1',
      [req.params.projectId]
    );
    res.json(rows[0] || { content: '' });
  } catch (e) { res.status(500).json({ error: formatDbError(e), code: e?.code || 'INTERNAL' }); }
});

router.put('/notes', requirePermission('editor'), async (req, res) => {
  const { content } = req.body;
  await db.query(
    `INSERT INTO notes (project_id, content) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content)`,
    [req.params.projectId, content || '']
  );
  res.json({ ok: true });
});

module.exports = router;
