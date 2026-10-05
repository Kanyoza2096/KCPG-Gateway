'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { verifyToken } = require('../utils/token');
const { UpstreamError } = require('../utils/errors');
const { set, clear, fromRequest } = require('../utils/session');
const config = require('../config');
const router = express.Router();

function issueGatewayToken(identity) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    sub: identity.principal_id, email: identity.email, role: identity.role || 'viewer',
    workspace_id: identity.workspace_id, scopes: identity.scopes || [], iat: now, exp: now + 8 * 60 * 60,
  }, config.auth.jwtSecret, { algorithm: 'HS256', audience: config.auth.audience, ...(config.auth.issuer ? { issuer: config.auth.issuer } : {}) });
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

async function exchangeSupabaseToken(token, req) {
  if (!config.python.identityExchangeEnabled) return null;
  if (!config.python.serviceToken) {
    const error = new Error('Identity exchange is enabled but PYTHON_SERVICE_TOKEN is not configured');
    error.code = 'IDENTITY_EXCHANGE_SERVICE_CREDENTIAL_MISSING';
    error.statusCode = 503;
    throw error;
  }
  const response = await axios.post(`${config.python.baseUrl}/api/v1/auth/exchange`, {
    access_token: token,
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

router.post('/control-login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!config.auth.controlPlaneEmail || !config.auth.controlPlanePasswordHash) {
    return res.status(503).json({ ok: false, error: 'Control-plane identity is not configured' });
  }
  if (!email || email !== config.auth.controlPlaneEmail || !verifyPassword(password, config.auth.controlPlanePasswordHash)) {
    return res.status(401).json({ ok: false, error: 'Invalid control-plane credentials' });
  }
  if (!(await validateUpstreamCredential(req))) {
    return res.status(503).json({ ok: false, error: 'Gateway upstream credential validation failed' });
  }
  const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
  if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
  const allowedWorkspaces = config.auth.controlPlaneWorkspaces;
  if (allowedWorkspaces.length && !allowedWorkspaces.includes('*') && !allowedWorkspaces.includes(workspaceId)) {
    return res.status(403).json({ ok: false, error: 'Workspace is not authorized for this control-plane identity' });
  }
  const scopes = [...config.auth.controlPlaneScopes];
  if (config.auth.controlPlaneRole === 'admin' && !scopes.includes('control.admin')) scopes.push('control.admin', 'configuration.write');
  const gatewayToken = issueGatewayToken({
    principal_id: email,
    email,
    role: config.auth.controlPlaneRole,
    workspace_id: workspaceId,
    scopes,
  });
  set(res, gatewayToken);
  return res.json({
    ok: true,
    status: 'active',
    role: config.auth.controlPlaneRole,
    scopes,
    workspaceId,
    principalId: email,
    email,
    token: gatewayToken,
  });
});

// FIXED: Changed from '/' to '/session'
router.post('/session', async (req, res, next) => {
  const credential = typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';
  if (!credential) return res.status(400).json({ ok:false, error:'credential is required' });
  try {
    const identity = await exchangeSupabaseToken(credential, req);
    if (identity) {
      const gatewayToken = issueGatewayToken({ ...identity, scopes: identity.permissions });
      set(res, gatewayToken);
      return res.json({ ok:true, status:'active', token: gatewayToken, role:identity.role, scopes:identity.permissions, workspaceId:identity.workspace_id, principalId:identity.principal_id, expires_at:new Date(Date.now()+8*60*60*1000).toISOString() });
    }
  } catch (err) { return next(err); }
  try {
    const user = verifyToken(credential); set(res, credential);
    return res.json({ ok:true, status:'active', token: credential, role:user.role, scopes:user.scopes, workspaceId:user.workspaceId, expires_at:new Date(Date.now()+8*60*60*1000).toISOString() });
  } catch { return res.status(401).json({ ok:false, error:'Credential validation failed' }); }
});

// FIXED: Changed from '/' to '/session'
router.get('/session', (req,res) => { const token=fromRequest(req); if(!token) return res.status(401).json({ok:false,status:'disconnected'}); try { const user=verifyToken(token); return res.json({ok:true,status:'active',role:user.role,scopes:user.scopes,workspaceId:user.workspaceId,principalId:user.sub,email:user.email}); } catch { clear(res); return res.status(401).json({ok:false,status:'disconnected'}); } });

// FIXED: Changed from '/' to '/session'
router.delete('/session', (_req,res) => { clear(res); res.json({ok:true,status:'revoked'}); });

/**
 * POST /api/v1/auth/session/workspace
 * Re-bind the current control-plane session to another workspace.
 * Issues a new gateway JWT with the same principal/scopes and updated workspace_id.
 * Allowed when: controlPlaneWorkspaces includes * or the target id, or user has workspace:* / * scope.
 */
router.post('/session/workspace', (req, res) => {
  const token = fromRequest(req);
  if (!token) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  let user;
  try {
    user = verifyToken(token);
  } catch {
    clear(res);
    return res.status(401).json({ ok: false, error: 'Invalid session' });
  }
  const workspaceId = String(req.body?.workspace_id || req.body?.workspaceId || '').trim();
  if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspace_id is required' });

  const allowedWorkspaces = config.auth.controlPlaneWorkspaces || [];
  const scopes = Array.isArray(user.scopes) ? user.scopes : [];
  const elevated = scopes.includes('*') || scopes.includes('workspace:*');
  const listAllows =
    !allowedWorkspaces.length ||
    allowedWorkspaces.includes('*') ||
    allowedWorkspaces.includes(workspaceId);
  // Also allow if the operator already had this id in multi-workspace claims
  const prior = new Set((user.workspaceIds || []).map(String));
  if (user.workspaceId) prior.add(String(user.workspaceId));
  const priorAllows = prior.has(workspaceId) || prior.has('*');

  if (!elevated && !listAllows && !priorAllows) {
    return res.status(403).json({ ok: false, error: 'Workspace is not authorized for this identity' });
  }

  const gatewayToken = issueGatewayToken({
    principal_id: user.sub || user.email || 'operator',
    email: user.email,
    role: user.role || config.auth.controlPlaneRole || 'viewer',
    workspace_id: workspaceId,
    scopes: scopes.length ? scopes : (config.auth.controlPlaneScopes || []),
  });
  set(res, gatewayToken);
  return res.json({
    ok: true,
    status: 'active',
    workspaceId,
    role: user.role,
    scopes,
    principalId: user.sub,
    email: user.email,
    token: gatewayToken,
  });
});


module.exports = router;
