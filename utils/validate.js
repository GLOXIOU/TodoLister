'use strict';

const { badRequest } = require('./http');

const PROJECT_STATUSES  = ['in_dev', 'to_fix', 'in_prod', 'paused', 'archived'];
const VISIBILITIES      = ['private', 'public'];
const PRIORITIES        = ['low', 'medium', 'high'];
const GUEST_PERMISSIONS = ['observer', 'card_mover', 'editor'];

/** Positive integer id from a route param or body field, or null. */
function parseId(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

/** Required id field: throws when missing or malformed. */
function id(value, field) {
  const n = parseId(value);
  if (n === null) throw badRequest(`${field} must be a valid id.`);
  return n;
}

/**
 * Text field. Returns undefined when not provided (so updates can skip it),
 * null when explicitly emptied (optional fields only), or the trimmed string.
 */
function text(value, field, max, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw badRequest(`${field} is required.`);
    return undefined;
  }
  if (value === null || value === '') {
    if (required) throw badRequest(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw badRequest(`${field} is required.`);
    return null;
  }
  if (trimmed.length > max) throw badRequest(`${field} must be at most ${max} characters.`);
  return trimmed;
}

function oneOf(value, field, allowed) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
function color(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw badRequest(`${field} must be a hex color like #00ff88.`);
  }
  return value.toLowerCase();
}

/** Optional http(s) URL — rejects javascript:, data:, etc. */
function httpUrl(value, field) {
  const s = text(value, field, 500);
  if (s == null) return s;
  let parsed;
  try { parsed = new URL(s); } catch (_) { throw badRequest(`${field} must be a valid URL.`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest(`${field} must start with http:// or https://.`);
  }
  return s;
}

function bool(value, field) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  throw badRequest(`${field} must be a boolean.`);
}

function int(value, field, { min = 0, max = 1_000_000 } = {}) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/** Share password: undefined = unchanged, null = clear, string = new password. */
function sharePassword(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('share_password must be a string.');
  if (value.length < 4)   throw badRequest('Share password must be at least 4 characters.');
  if (value.length > 128) throw badRequest('Share password must be at most 128 characters.');
  return value;
}

module.exports = {
  PROJECT_STATUSES, VISIBILITIES, PRIORITIES, GUEST_PERMISSIONS,
  parseId, id, text, oneOf, color, httpUrl, bool, int, sharePassword
};
