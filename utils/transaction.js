'use strict';

const db = require('../db');

/**
 * Run `fn(conn)` inside a transaction on a dedicated pool connection.
 * Commits on success, rolls back on any error, always releases the connection.
 */
async function withTransaction(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* connection may be dead */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { withTransaction };
