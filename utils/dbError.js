'use strict';

function formatDbError(err) {
  if (err?.sqlMessage) return err.sqlMessage;
  if (typeof err?.message === 'string' && err.message.trim()) return err.message.trim();

  const code = err?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return `Database unavailable (${code}). Configure a reachable MySQL server in .env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME).`;
  }
  if (code) return `Database error (${code}).`;

  return 'Internal server error.';
}

module.exports = { formatDbError };
