'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const session = require('./session');
const { normalizeRole, scopesForRole } = require('../contracts/roles');
const { UnauthorizedError } = require('./errors');

/**
 * Extract Bearer token from Authorization header only.
 * Query-string credentials are deliberately rejected to prevent URL/log/referrer leakage.
 */
function extractToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || typeof header !== 'string') return session.fromRequest(req);
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) return null;
  return parts[1].trim();
}

/**
 * Verify JWT and return payload.
 * Expected claims (flexible): sub, role, workspace_id / workspaceId, email
 */
function verifyToken(token) {
  if (!token) throw new UnauthorizedError('Missing token');

  try {
    const opts = {
      algorithms: ['HS256'],
    };
    if (config.auth.issuer) opts.issuer = config.auth.issuer;
    if (config.auth.audience) opts.audience = config.auth.audience;

    const payload = jwt.verify(token, config.auth.jwtSecret, opts);
    return normalizeClaims(payload);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Token expired');
    }
    throw new UnauthorizedError('Invalid token');
  }
}

function normalizeClaims(payload) {
  const role = (payload.role || payload.user_role || 'viewer').toLowerCase();
  return {
    sub: payload.sub || payload.user_id || payload.uid || null,
    email: payload.email || null,
    role: normalizeRole(role),
    workspaceId: payload.workspace_id || payload.workspaceId || payload.ws || null,
    workspaceIds: normalizeWorkspaceIds(payload),
    scopes: scopesForRole(role),
    raw: payload,
  };
}

function normalizeWorkspaceIds(payload) {
  const values = [];
  const candidates = [payload.workspace_id, payload.workspaceId, payload.ws];
  for (const v of candidates) if (typeof v === 'string' && v.trim()) values.push(v.trim());
  for (const key of ['workspace_ids', 'workspaceIds', 'workspaces']) {
    const v = payload[key];
    if (Array.isArray(v)) for (const id of v) if (typeof id === 'string' && id.trim()) values.push(id.trim());
  }
  return [...new Set(values)];
}

function normalizeScopes(payload) {
  const raw = payload.scopes ?? payload.scope ?? [];
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === 'string');
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  return [];
}

/**
 * Dev-only identity when AUTH_DISABLED=true.
 */
function devIdentity() {
  return {
    sub: 'dev-user',
    email: 'dev@localhost',
    role: 'owner',
    workspaceId: 'platform',
    workspaceIds: ['platform'],
    scopes: ['*'],
    raw: { dev: true },
  };
}

module.exports = {
  extractToken,
  verifyToken,
  normalizeClaims,
  devIdentity,
};
