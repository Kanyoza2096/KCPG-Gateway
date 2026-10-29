'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { verifyToken } = require('../utils/token');
const { UpstreamError } = require('../utils/errors');
const { set, clear, fromRequest } = require('../utils/session');
const { normalizeRole, scopesForRole } = require('../contracts/roles');
const config = require('../config');
const router = express.Router();

function issueGatewayToken(identity) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    sub: identity.principal_id, 
    email: identity.email, 
    role: normalizeRole(identity.role),
    workspace_id: identity.workspace_id, 
    workspace_ids: identity.workspace_ids || [identity.workspace_id],
    scopes: scopesForRole(identity.role), 
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

async function exchangeSupabaseToken(token, req, requestedWorkspaceId = null) {
  if (!config.python.identityExchangeEnabled) return null;
  if (!config.python.serviceToken) {
    const error = new Error('Identity exchange is enabled but PYTHON_SERVICE_TOKEN is not configured');
    error.code = 'IDENTITY_EXCHANGE_SERVICE_CREDENTIAL_MISSING';
    error.statusCode = 503;
    throw error;
  }
  const response = await axios.post(`${config.python.baseUrl}/api/v1/auth/exchange`, {
    access_token: token,
    ...(requestedWorkspaceId ? { workspace_id: requestedWorkspaceId } : {}),
  }, {
    timeout: 10_000, validateStatus: () => true,
    headers: {
      Authorization: `Bearer ${config.python.serviceToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Request-Id': req.requestId || '',
    },
  });
  if (response.status >= 500) {
    throw new UpstreamError(`Identity exchange backend returned HTTP ${response.status}`);
  }
  if (response.status < 200 || response.status >= 300) return null;
  const payload = response.data?.data || response.data;
  const principalId = payload?.principal_id || payload?.sub;
  const workspaceId = payload?.workspace_id || payload?.workspaceId;
  if (!principalId || !workspaceId) return null;
  return {
    principal_id: String(principalId),
    email: payload.email ? String(payload.email) : undefined,
    role: String(payload.role || 'viewer'),
    workspace_id: String(workspaceId),
    permissions: Array.isArray(payload.scopes)
      ? payload.scopes.map(String)
      : (Array.isArray(payload.permissions) ? payload.permissions.map(String) : []),
    workspace_ids: Array.isArray(payload.workspace_ids) ? payload.workspace_ids.map(String) : [String(requestedWorkspaceId || payload.workspace_id)],
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

router.post('/session', async (req, res, next) => {
  const credential = typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';
  if (!credential) return res.status(400).json({ ok: false, error: 'credential is required' });

  // 1. Try the Python exchange (if enabled)
  try {
    const identity = await exchangeSupabaseToken(credential, req);
    if (identity) {
      const gatewayToken = issueGatewayToken(identity);
      set(res, gatewayToken);
      return res.json({
        ok: true,
        status: 'active',
        token: gatewayToken,
        role: identity.role,
        scopes: scopesForRole(identity.role),
        workspaceId: identity.workspace_id,
        principalId: identity.principal_id,
        expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      });
    }
  } catch (err) { 
    console.warn('[SESSION] Exchange failed, falling back to local decode:', err.message);
  }

  // 2. Fallback: Decode Supabase JWT locally
  try {
    const decoded = jwt.decode(credential);
    if (!decoded || !decoded.sub) {
      console.error('[SESSION] Decode failed: Invalid JWT structure');
      return res.status(401).json({ ok: false, error: 'Invalid credential structure' });
    }

    const appMeta = decoded.app_metadata || {};
    const userMeta = decoded.user_metadata || {};
    
    // Extract role and workspace from Supabase metadata
    const role = appMeta.role || userMeta.role || 'viewer';
    const workspaceId = appMeta.workspace_id || userMeta.workspace_id || 'ws-e6eb6528d5b9';
    const workspaceIds = Array.isArray(appMeta.workspace_ids) ? appMeta.workspace_ids 
                       : Array.isArray(userMeta.workspace_ids) ? userMeta.workspace_ids 
                       : [workspaceId];

    const identity = {
      principal_id: decoded.sub,
      email: decoded.email,
      role,
      workspace_id: workspaceId,
      workspace_ids: workspaceIds,
    };

    // Issue the Gateway Token and set the HttpOnly cookie
    const gatewayToken = issueGatewayToken(identity);
    set(res, gatewayToken);

    return res.json({
      ok: true,
      status: 'active',
      token: gatewayToken,
      role: identity.role,
      scopes: scopesForRole(identity.role),
      workspaceId: identity.workspace_id,
      principalId: identity.principal_id,
      expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[SESSION] Decode fallback failed:', err.message);
    return res.status(401).json({ ok: false, error: 'Credential validation failed' });
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
  const credential = typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';
  const workspaceId = String(req.body?.workspace_id || req.body?.workspaceId || '').trim();
  if (!credential || !workspaceId) return res.status(400).json({ ok: false, error: 'credential and workspace_id are required' });
  try {
    const identity = await exchangeSupabaseToken(credential, req, workspaceId);
    if (!identity) return res.status(403).json({ ok: false, error: 'Workspace is not authorized for this identity' });
    const gatewayToken = issueGatewayToken(identity);
    set(res, gatewayToken);
    return res.json({
      ok: true, status: 'active', workspaceId: identity.workspace_id,
      role: normalizeRole(identity.role), scopes: scopesForRole(identity.role),
      principalId: identity.principal_id, email: identity.email, token: gatewayToken,
    });
  } catch (err) { return next(err); }
});

module.exports = router;
