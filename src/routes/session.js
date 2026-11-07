'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { verifyToken } = require('../utils/token');
const { UpstreamError, UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { set, clear, fromRequest } = require('../utils/session');
const { normalizeRole, scopesForRole } = require('../contracts/roles');
const config = require('../config');
const rateLimit = require('express-rate-limit');
const { authStore } = require('../services/redisRateLimitStore');
const router = express.Router();

function issueGatewayToken(identity) {
  const now = Math.floor(Date.now() / 1000);
  const platformRole = ['super_admin', 'operator'].includes(identity.platform_role) ? identity.platform_role : '';
  const scopes = scopesForRole(identity.role);
  if (platformRole === 'super_admin') scopes.push('*');
  else if (platformRole === 'operator') scopes.push('platform:health:read', 'platform:workspaces:read', 'platform:operations:read');
  return jwt.sign({
    sub: identity.principal_id, 
    email: identity.email, 
    role: normalizeRole(identity.role),
    workspace_id: identity.workspace_id, 
    workspace_ids: identity.workspace_ids || [identity.workspace_id],
    scopes,
    platform_role: platformRole || undefined,
    platform_permissions: Array.isArray(identity.platform_permissions) ? identity.platform_permissions : [],
    principal_type: 'human',
    iat: now, 
    exp: now + 60 * 60,
  }, config.auth.jwtSecret, { 
    algorithm: 'HS256', 
    audience: config.auth.audience, 
    ...(config.auth.issuer ? { issuer: config.auth.issuer } : {}) 
  });
}

async function validateUpstreamCredential(req) {
  if (!config.python.serviceToken) return false;
  try {
    const response = await axios.get(`${config.python.baseUrl}/api/v1/system/auth/validate`, {
      timeout: 8_000, validateStatus: () => true,
      headers: { Authorization: `Bearer ${config.python.serviceToken}`, Accept: 'application/json', 'X-Request-Id': req.requestId || '' },
    });
    return response.status >= 200 && response.status < 300 && response.data?.ok === true;
  } catch { return false; }
}

const passwordAuthRateLimit = rateLimit({
  windowMs: 60_000,
  max: config.isProd ? 5 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  ...(config.isProd ? { store: authStore, passOnStoreError: false } : {}),
  message: { ok: false, error: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again shortly.' },
});

async function exchangePasswordIdentity(email, password, req) {
  if (!config.python.identityExchangeEnabled) {
    const error = new Error('Canonical identity exchange is disabled; session creation is unavailable');
    error.code = 'IDENTITY_EXCHANGE_DISABLED';
    error.statusCode = 503;
    throw error;
  }
  if (!config.python.serviceToken) {
    const error = new Error('Identity exchange is enabled but PYTHON_SERVICE_TOKEN is not configured');
    error.code = 'IDENTITY_EXCHANGE_SERVICE_CREDENTIAL_MISSING';
    error.statusCode = 503;
    throw error;
  }
  let response;
  try {
    response = await axios.post(`${config.python.baseUrl}/api/v1/auth/exchange`, { email, password }, {
      timeout: 12_000, validateStatus: () => true,
      headers: {
        Authorization: `Bearer ${config.python.serviceToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Request-Id': req.requestId || '',
      },
    });
  } catch (err) {
    throw new UpstreamError('Canonical identity exchange backend is unavailable', { cause: err.code || err.message });
  }
  if (response.status === 401) throw new UnauthorizedError('Invalid email or password');
  if (response.status === 403) throw new ForbiddenError('Identity is not authorized for a workspace');
  if (response.status < 200 || response.status >= 300) {
    throw new UpstreamError(`Identity exchange backend returned HTTP ${response.status}`);
  }
  const payload = response.data?.data || response.data;
  const principalId = payload?.principal_id || payload?.sub;
  const workspaceId = payload?.workspace_id || payload?.workspaceId;
  if (!principalId || !workspaceId) throw new UpstreamError('Identity exchange returned an incomplete principal');
  return {
    principal_id: String(principalId),
    email: payload.email ? String(payload.email) : undefined,
    role: String(payload.role || 'viewer'),
    workspace_id: String(workspaceId),
    permissions: Array.isArray(payload.scopes) ? payload.scopes.map(String) : [],
    workspace_ids: [String(workspaceId)],
    platform_role: ['super_admin', 'operator'].includes(payload.platformRole) ? payload.platformRole : '',
    platform_permissions: Array.isArray(payload.platformPermissions) ? payload.platformPermissions.map(String) : [],
    principal_type: 'human',
  };
}

async function exchangeWorkspaceIdentity(session, workspaceId, req) {
  if (!config.python.identityExchangeEnabled || !config.python.serviceToken) {
    throw new UpstreamError('Canonical workspace authorization is unavailable');
  }
  let response;
  try {
    response = await axios.post(`${config.python.baseUrl}/api/v1/auth/workspace`, {
      principal_id: session.sub,
      workspace_id: workspaceId,
    }, {
      timeout: 10_000, validateStatus: () => true,
      headers: {
        Authorization: `Bearer ${config.python.serviceToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Request-Id': req.requestId || '',
      },
    });
  } catch (err) {
    throw new UpstreamError('Canonical workspace authorization backend is unavailable', { cause: err.code || err.message });
  }
  if (response.status === 401) throw new UnauthorizedError('Gateway session is no longer valid');
  if (response.status === 403) throw new ForbiddenError('Workspace is not authorized for this identity');
  if (response.status < 200 || response.status >= 300) throw new UpstreamError(`Workspace authorization backend returned HTTP ${response.status}`);
  const payload = response.data?.data || response.data;
  if (String(payload?.principal_id || '') !== String(session.sub) || String(payload?.workspace_id || '') !== workspaceId) {
    throw new UpstreamError('Workspace authorization returned a mismatched principal');
  }
  return {
    principal_id: String(session.sub),
    email: session.email || undefined,
    role: String(payload.role || 'viewer'),
    workspace_id: workspaceId,
    workspace_ids: [workspaceId],
    platform_role: ['super_admin', 'operator'].includes(payload.platformRole) ? payload.platformRole : '',
    platform_permissions: Array.isArray(payload.platformPermissions) ? payload.platformPermissions.map(String) : [],
    principal_type: 'human',
  };
}

function verifyPassword(password, encoded) {
  try {
    const [saltB64, hashB64] = String(encoded || '').split(':');
    if (!saltB64 || !hashB64 || !password) return false;
    const crypto = require('node:crypto');
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

function resolveControlPlaneWorkspace(requestedWorkspaceId) {
  const allowedWorkspaces = Array.isArray(config.auth.controlPlaneWorkspaces)
    ? config.auth.controlPlaneWorkspaces.map(String)
    : [];
  const wildcard = allowedWorkspaces.includes('*');

  if (requestedWorkspaceId) {
    if (!allowedWorkspaces.length || wildcard || allowedWorkspaces.includes(requestedWorkspaceId)) {
      return { workspaceId: requestedWorkspaceId };
    }
    return { error: { status: 403, body: { ok: false, error: 'Workspace is not authorized for this control-plane identity' } } };
  }

  if (!wildcard && allowedWorkspaces.length === 1) {
    return { workspaceId: allowedWorkspaces[0] };
  }

  if (wildcard) {
    const fallback = String(config.auth.controlPlaneDefaultWorkspace || '').trim();
    if (fallback) return { workspaceId: fallback };
  }

  return {
    error: {
      status: 409,
      body: {
        ok: false,
        error: allowedWorkspaces.length
          ? 'Multiple workspaces are available; workspaceId must be selected'
          : 'No workspace is configured for this control-plane identity',
        workspaces: allowedWorkspaces,
      },
    },
  };
}

router.post('/control-login', async (_req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'CONTROL_LOGIN_RETIRED',
    message: 'Password/role/scope configuration in the gateway environment is retired. Authenticate with the identity provider and exchange the user credential through /auth/session.',
  });
});

router.post('/session', passwordAuthRateLimit, async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ ok: false, error: 'email and password are required' });

  try {
    // The backend identity exchange is the only trust boundary for browser credentials.
    // Never decode unverified JWT claims or fall back to user-editable metadata.
    const identity = await exchangePasswordIdentity(email, password, req);
    const gatewayToken = issueGatewayToken(identity);
    set(res, gatewayToken);
    return res.json({
      ok: true,
      status: 'active',
      role: identity.role,
      scopes: identity.platform_role === 'super_admin'
        ? [...new Set([...scopesForRole(identity.role), '*'])]
        : identity.platform_role === 'operator'
          ? [...new Set([...scopesForRole(identity.role), 'platform:health:read', 'platform:workspaces:read', 'platform:operations:read'])]
          : scopesForRole(identity.role),
      workspaceId: identity.workspace_id,
      principalId: identity.principal_id,
      platformRole: identity.platform_role || null,
      platformPermissions: identity.platform_permissions,
      expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/session', (req, res) => {
  const token = fromRequest(req);
  if (!token) return res.status(401).json({ ok: false, status: 'disconnected' });
  try {
    const user = verifyToken(token);
    return res.json({
      ok: true,
      status: 'active',
      role: user.role,
      scopes: user.scopes,
      workspaceId: user.workspaceId,
      principalId: user.sub,
      email: user.email,
      platformRole: user.platformRole || null,
      platformPermissions: user.platformPermissions || [],
    });
  } catch {
    clear(res);
    return res.status(401).json({ ok: false, status: 'disconnected' });
  }
});

router.delete('/session', (_req, res) => {
  clear(res);
  res.json({ ok: true, status: 'revoked' });
});

router.post('/session/workspace', async (req, res, next) => {
  const workspaceId = String(req.body?.workspace_id || req.body?.workspaceId || '').trim();
  if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspace_id is required' });
  const token = fromRequest(req);
  if (!token) return res.status(401).json({ ok: false, error: 'Authentication required' });
  try {
    const current = verifyToken(token);
    if (current.principalType !== 'human' || !current.sub) {
      throw new ForbiddenError('Human Gateway session required');
    }
    const identity = await exchangeWorkspaceIdentity(current, workspaceId, req);
    const gatewayToken = issueGatewayToken(identity);
    set(res, gatewayToken);
    return res.json({
      ok: true,
      status: 'active',
      workspaceId: identity.workspace_id,
      role: normalizeRole(identity.role),
      scopes: identity.platform_role === 'super_admin'
        ? [...new Set([...scopesForRole(identity.role), '*'])]
        : identity.platform_role === 'operator'
          ? [...new Set([...scopesForRole(identity.role), 'platform:health:read', 'platform:workspaces:read', 'platform:operations:read'])]
          : scopesForRole(identity.role),
      principalId: identity.principal_id,
      email: identity.email,
      platformRole: identity.platform_role || null,
      platformPermissions: identity.platform_permissions,
    });
  } catch (err) { return next(err); }
});

module.exports = router;
