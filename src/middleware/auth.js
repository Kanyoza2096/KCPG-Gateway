'use strict';

const config = require('../config');
const { extractToken, verifyToken, devIdentity } = require('../utils/token');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { roleAtLeast } = require('../contracts/commands');

/**
 * Require a valid JWT (or dev identity when AUTH_DISABLED).
 */
function requireAuth(req, res, next) {
  try {
    if (config.auth.disabled) {
      req.user = devIdentity();
      return next();
    }
    const token = extractToken(req);
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return next(err instanceof UnauthorizedError ? err : new UnauthorizedError(err.message));
  }
}

/**
 * Optional auth: attach user if token present, else continue as anonymous.
 */
function optionalAuth(req, res, next) {
  try {
    if (config.auth.disabled) {
      req.user = devIdentity();
      return next();
    }
    const token = extractToken(req);
    if (token) req.user = verifyToken(token);
    return next();
  } catch {
    return next();
  }
}

/**
 * Require minimum role (viewer < operator < owner).
 */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roleAtLeast(req.user.role, minRole)) {
      return next(new ForbiddenError(`Requires role: ${minRole}`));
    }
    return next();
  };
}

function requireWorkspace(req, res, next) {
  const candidates = [req.params.workspaceId, req.body?.workspace_id, req.query?.workspace_id, req.headers['x-workspace-id']].filter((v) => v != null && String(v).trim() !== '').map(String);
  const unique = [...new Set(candidates)];
  if (unique.length > 1) return next(new ForbiddenError('Conflicting workspace context supplied'));
  const workspaceId = unique[0] || String(req.user?.workspaceId || '');
  if (!workspaceId) return next(new ForbiddenError('Workspace context required'));
  const allowed = new Set((req.user?.workspaceIds || []).map(String));
  if (req.user?.workspaceId) allowed.add(String(req.user.workspaceId));
  if (!allowed.has(workspaceId) && !req.user?.scopes?.includes('*') && !req.user?.scopes?.includes('workspace:*')) return next(new ForbiddenError('Workspace access denied'));
  req.workspaceId = workspaceId;
  return next();
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
  requireWorkspace,
};
