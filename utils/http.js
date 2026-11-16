'use strict';

const { formatDbError } = require('./dbError');

/**
 * An error that maps directly to an HTTP response: { error: code, message }.
 */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code   = code;
  }
}

const badRequest = message => new HttpError(400, 'VALIDATION', message);
const notFound   = (message = 'Not found.') => new HttpError(404, 'NOT_FOUND', message);
const forbidden  = (message = 'You are not allowed to do this.') => new HttpError(403, 'FORBIDDEN', message);

/**
 * Wrap an async route handler so rejected promises reach the error handler
 * instead of becoming unhandled rejections (which crash Node).
 */
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'BAD_JSON', message: 'Malformed JSON body.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'TOO_LARGE', message: 'Request body too large.' });
  }

  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: err?.code || 'INTERNAL', message: formatDbError(err) });
}

module.exports = { HttpError, badRequest, notFound, forbidden, wrap, errorHandler };
