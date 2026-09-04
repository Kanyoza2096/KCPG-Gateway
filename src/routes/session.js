'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { verifyToken } = require('../utils/token');
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
  if (!config.identityExchangeEnabled) return null;
  const response = await axios.get(`${config.python.baseUrl}/api/v1/context/me`, {
    timeout: 10_000, validateStatus: () => true,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-Request-Id': req.requestId || '' },
  });
  if (response.status < 200 || response.status >= 300) return null;
  const payload = response.data?.data || response.data;
  if (!payload?.principal_id || !payload?.workspace_id) return null;
  return { principal_id: String(payload.principal_id), email: payload.email ? String(payload.email) : undefined,
    role: String(payload.role || 'viewer'), workspace_id: String(payload.workspace_id),
    permissions: Array.isArray(payload.permissions) ? payload.permissions.map(String) : [] };
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
  });
});

router.post('/', async (req, res, next) => {
  const credential = typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';
  if (!credential) return res.status(400).json({ ok:false, error:'credential is required' });
  try {
    const identity = await exchangeSupabaseToken(credential, req);
    if (identity) {
      const gatewayToken = issueGatewayToken({ ...identity, scopes: identity.permissions });
      set(res, gatewayToken);
      return res.json({ ok:true, status:'active', role:identity.role, scopes:identity.permissions, workspaceId:identity.workspace_id, principalId:identity.principal_id, expires_at:new Date(Date.now()+8*60*60*1000).toISOString() });
    }
  } catch (err) { return next(err); }
  try {
    const user = verifyToken(credential); set(res, credential);
    return res.json({ ok:true, status:'active', role:user.role, scopes:user.scopes, workspaceId:user.workspaceId, expires_at:new Date(Date.now()+8*60*60*1000).toISOString() });
  } catch { return res.status(401).json({ ok:false, error:'Credential validation failed' }); }
});
router.get('/', (req,res) => { const token=fromRequest(req); if(!token) return res.status(401).json({ok:false,status:'disconnected'}); try { const user=verifyToken(token); return res.json({ok:true,status:'active',role:user.role,scopes:user.scopes,workspaceId:user.workspaceId,principalId:user.sub,email:user.email}); } catch { clear(res); return res.status(401).json({ok:false,status:'disconnected'}); } });
router.delete('/', (_req,res) => { clear(res); res.json({ok:true,status:'revoked'}); });
module.exports = router;
