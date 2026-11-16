'use strict';

/**
 * Idempotent, additive migrations applied at startup so existing installs
 * pick up schema changes without re-running schema.sql by hand.
 */
async function columnExists(db, table, column) {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function ensureSchema(db) {
  // v1.1 — the guest permission level is a project setting, not a per-session one.
  if (!await columnExists(db, 'projects', 'guest_permission')) {
    await db.query(
      `ALTER TABLE projects
         ADD COLUMN guest_permission ENUM('observer','card_mover','editor')
         NOT NULL DEFAULT 'observer' AFTER share_password_hash`
    );
    // Keep whatever level the owner last applied to existing guest sessions.
    await db.query(
      `UPDATE projects p
          SET p.guest_permission = COALESCE(
            (SELECT gs.permission FROM guest_sessions gs
              WHERE gs.project_id = p.id ORDER BY gs.created_at DESC LIMIT 1),
            'observer')`
    );
    console.log('  🛠  Migration applied: projects.guest_permission');
  }
}

async function purgeExpiredGuestSessions(db) {
  await db.query('DELETE FROM guest_sessions WHERE expires_at <= NOW()');
}

module.exports = { ensureSchema, purgeExpiredGuestSessions };
