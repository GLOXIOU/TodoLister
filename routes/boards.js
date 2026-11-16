'use strict';

const express = require('express');
const router  = express.Router({ mergeParams: true });
const db      = require('../db');
const v       = require('../utils/validate');
const { wrap, HttpError, badRequest, notFound, forbidden } = require('../utils/http');
const { withTransaction } = require('../utils/transaction');
const { projectAccess, requireLevel, atLeast } = require('../middleware/guestAuth');

/*
 * Permission matrix (owner = whitelisted IP, others = guest levels):
 *   view board & notes ............ observer+
 *   move / reorder cards .......... card_mover+
 *   edit cards, categories,
 *   statuses and notes ............ editor+
 */
router.use(projectAccess);

const byPosition = 'ORDER BY position, id';

// ════════════════════════════════════════════════════════════
// FULL BOARD DATA
// ════════════════════════════════════════════════════════════
router.get('/board', wrap(async (req, res) => {
  const pid = req.projectId;
  const [[categories], [statuses], [cards]] = await Promise.all([
    db.query(`SELECT * FROM categories WHERE project_id = ? ${byPosition}`, [pid]),
    db.query(`SELECT * FROM statuses   WHERE project_id = ? ${byPosition}`, [pid]),
    db.query(`SELECT * FROM cards      WHERE project_id = ? ${byPosition}`, [pid])
  ]);
  res.json({ categories, statuses, cards });
}));

// ════════════════════════════════════════════════════════════
// CATEGORIES & STATUSES (same shape: name, color, position, hidden)
// ════════════════════════════════════════════════════════════
function laneRoutes(table, defaultColor) {
  router.post(`/${table}`, requireLevel('editor'), wrap(async (req, res) => {
    const name  = v.text(req.body?.name, 'Name', 80, { required: true });
    const color = v.color(req.body?.color, 'Color') ?? defaultColor;
    const [[{ next }]] = await db.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ${table} WHERE project_id = ?`, [req.projectId]
    );
    const [r] = await db.query(
      `INSERT INTO ${table} (project_id, name, color, position) VALUES (?, ?, ?, ?)`,
      [req.projectId, name, color, next]
    );
    res.status(201).json({ id: r.insertId, position: next });
  }));

  // PUT /:table/order { ids: [...] } — the full list in its new order.
  // Declared before /:id so "order" isn't parsed as an id.
  router.put(`/${table}/order`, requireLevel('editor'), wrap(async (req, res) => {
    const raw = req.body?.ids;
    if (!Array.isArray(raw) || !raw.length || raw.length > 500) throw badRequest('ids must be a non-empty array.');
    const ids = raw.map(x => v.id(x, 'ids[]'));
    if (new Set(ids).size !== ids.length) throw badRequest('ids must be unique.');

    await withTransaction(async conn => {
      const [rows] = await conn.query(`SELECT id FROM ${table} WHERE project_id = ? FOR UPDATE`, [req.projectId]);
      const current = new Set(rows.map(r => r.id));
      // Requiring the complete set rejects stale orders (someone added/removed one meanwhile).
      if (current.size !== ids.length || !ids.every(id => current.has(id))) {
        throw new HttpError(409, 'STALE_ORDER', 'The board changed in the meantime. Reload and try again.');
      }
      const cases = ids.map(() => 'WHEN ? THEN ?').join(' ');
      await conn.query(
        `UPDATE ${table} SET position = CASE id ${cases} END WHERE project_id = ? AND id IN (?)`,
        [...ids.flatMap((id, i) => [id, i]), req.projectId, ids]
      );
    });
    res.json({ ok: true });
  }));

  router.put(`/${table}/:id`, requireLevel('editor'), wrap(async (req, res) => {
    const id = v.id(req.params.id, 'id');
    const b  = req.body || {};
    const updates = {
      name:     v.text(b.name, 'Name', 80, { required: b.name !== undefined }),
      color:    v.color(b.color, 'Color'),
      hidden:   v.bool(b.hidden, 'hidden'),
      position: v.int(b.position, 'position')
    };
    const fields = []; const vals = [];
    for (const [col, val] of Object.entries(updates)) {
      if (val !== undefined) { fields.push(`${col} = ?`); vals.push(col === 'hidden' ? Number(val) : val); }
    }
    if (!fields.length) throw badRequest('Nothing to update.');

    vals.push(id, req.projectId);
    const [r] = await db.query(`UPDATE ${table} SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`, vals);
    if (!r.affectedRows) throw notFound();
    res.json({ ok: true });
  }));

  router.delete(`/${table}/:id`, requireLevel('editor'), wrap(async (req, res) => {
    const id  = v.id(req.params.id, 'id');
    const [r] = await db.query(`DELETE FROM ${table} WHERE id = ? AND project_id = ?`, [id, req.projectId]);
    if (!r.affectedRows) throw notFound();
    res.json({ ok: true });
  }));
}

laneRoutes('categories', '#00ff88');
laneRoutes('statuses',   '#555');

// ════════════════════════════════════════════════════════════
// CARDS
// ════════════════════════════════════════════════════════════

/** Ensure category/status ids belong to this project (no cross-project refs). */
async function assertLane(conn, projectId, categoryId, statusId) {
  if (categoryId !== undefined) {
    const [r] = await conn.query('SELECT 1 FROM categories WHERE id = ? AND project_id = ?', [categoryId, projectId]);
    if (!r.length) throw badRequest('Unknown category for this project.');
  }
  if (statusId !== undefined) {
    const [r] = await conn.query('SELECT 1 FROM statuses WHERE id = ? AND project_id = ?', [statusId, projectId]);
    if (!r.length) throw badRequest('Unknown status for this project.');
  }
}

async function nextCardPosition(conn, projectId, categoryId, statusId) {
  const [[{ next }]] = await conn.query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards
      WHERE project_id = ? AND category_id = ? AND status_id = ?`,
    [projectId, categoryId, statusId]
  );
  return next;
}

router.post('/cards', requireLevel('editor'), wrap(async (req, res) => {
  const b = req.body || {};
  const title       = v.text(b.title, 'Title', 255, { required: true });
  const description = v.text(b.description, 'Description', 10000) ?? null;
  const priority    = v.oneOf(b.priority, 'priority', v.PRIORITIES) ?? 'medium';
  const category_id = v.id(b.category_id, 'category_id');
  const status_id   = v.id(b.status_id, 'status_id');

  await assertLane(db, req.projectId, category_id, status_id);
  const position = await nextCardPosition(db, req.projectId, category_id, status_id);

  const [r] = await db.query(
    `INSERT INTO cards (project_id, category_id, status_id, title, description, priority, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.projectId, category_id, status_id, title, description, priority, position]
  );
  res.status(201).json({ id: r.insertId, position });
}));

router.put('/cards/:id', requireLevel('card_mover'), wrap(async (req, res) => {
  const id = v.id(req.params.id, 'id');
  const b  = req.body || {};

  const content = {
    title:       v.text(b.title, 'Title', 255, { required: b.title !== undefined }),
    description: v.text(b.description, 'Description', 10000),
    priority:    v.oneOf(b.priority, 'priority', v.PRIORITIES)
  };
  const move = {
    category_id: b.category_id === undefined ? undefined : v.id(b.category_id, 'category_id'),
    status_id:   b.status_id   === undefined ? undefined : v.id(b.status_id, 'status_id'),
    position:    v.int(b.position, 'position')
  };

  const editsContent = Object.values(content).some(val => val !== undefined);
  if (editsContent && !atLeast(req.access, 'editor')) {
    throw forbidden('Your access to this project only allows moving cards.');
  }

  const [cardRows] = await db.query(
    'SELECT category_id, status_id FROM cards WHERE id = ? AND project_id = ? LIMIT 1', [id, req.projectId]
  );
  if (!cardRows.length) throw notFound('Card not found.');
  const card = cardRows[0];

  await assertLane(db, req.projectId, move.category_id, move.status_id);

  // Changing lane without an explicit position drops the card at the bottom.
  const newCat    = move.category_id ?? card.category_id;
  const newStatus = move.status_id   ?? card.status_id;
  if (move.position === undefined && (newCat !== card.category_id || newStatus !== card.status_id)) {
    move.position = await nextCardPosition(db, req.projectId, newCat, newStatus);
  }

  const fields = []; const vals = [];
  for (const [col, val] of Object.entries({ ...content, ...move })) {
    if (val !== undefined) { fields.push(`${col} = ?`); vals.push(val); }
  }
  if (!fields.length) throw badRequest('Nothing to update.');

  vals.push(id, req.projectId);
  await db.query(`UPDATE cards SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`, vals);
  res.json({ ok: true, position: move.position });
}));

/**
 * POST /cards/:id/move  { category_id, status_id, index }
 * Move a card into a lane at `index` (0 = top) and renumber that lane.
 */
router.post('/cards/:id/move', requireLevel('card_mover'), wrap(async (req, res) => {
  const id          = v.id(req.params.id, 'id');
  const category_id = v.id(req.body?.category_id, 'category_id');
  const status_id   = v.id(req.body?.status_id, 'status_id');
  const index       = v.int(req.body?.index, 'index') ?? Number.MAX_SAFE_INTEGER;

  const positions = await withTransaction(async conn => {
    const [cardRows] = await conn.query(
      'SELECT id FROM cards WHERE id = ? AND project_id = ? FOR UPDATE', [id, req.projectId]
    );
    if (!cardRows.length) throw notFound('Card not found.');
    await assertLane(conn, req.projectId, category_id, status_id);

    const [laneRows] = await conn.query(
      `SELECT id FROM cards
        WHERE project_id = ? AND category_id = ? AND status_id = ? AND id <> ?
        ${byPosition} FOR UPDATE`,
      [req.projectId, category_id, status_id, id]
    );
    const ids = laneRows.map(r => r.id);
    ids.splice(Math.min(index, ids.length), 0, id);

    await conn.query('UPDATE cards SET category_id = ?, status_id = ? WHERE id = ?', [category_id, status_id, id]);
    const cases = ids.map(() => 'WHEN ? THEN ?').join(' ');
    await conn.query(
      `UPDATE cards SET position = CASE id ${cases} END WHERE id IN (?)`,
      [...ids.flatMap((cardId, i) => [cardId, i]), ids]
    );
    return ids.map((cardId, i) => ({ id: cardId, position: i }));
  });

  res.json({ ok: true, positions });
}));

router.delete('/cards/:id', requireLevel('editor'), wrap(async (req, res) => {
  const id  = v.id(req.params.id, 'id');
  const [r] = await db.query('DELETE FROM cards WHERE id = ? AND project_id = ?', [id, req.projectId]);
  if (!r.affectedRows) throw notFound('Card not found.');
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════
// NOTES
// ════════════════════════════════════════════════════════════
router.get('/notes', wrap(async (req, res) => {
  const [rows] = await db.query(
    'SELECT content, updated_at FROM notes WHERE project_id = ? LIMIT 1', [req.projectId]
  );
  res.json(rows[0] || { content: '' });
}));

router.put('/notes', requireLevel('editor'), wrap(async (req, res) => {
  const content = req.body?.content ?? '';
  if (typeof content !== 'string') throw badRequest('content must be a string.');
  if (content.length > 1_000_000) throw badRequest('Notes are too long.');
  await db.query(
    `INSERT INTO notes (project_id, content) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content)`,
    [req.projectId, content]
  );
  res.json({ ok: true });
}));

module.exports = router;
