'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const pythonClient = require('../services/pythonClient');
const { ForbiddenError } = require('../utils/errors');
const { roleAtLeast, hasScopes } = require('../contracts/commands');

const router = express.Router();

// Browser-facing Control Plane BFF surface. This is deliberately an allowlist,
// not a general reverse proxy. It mirrors the real CP data-access contract.
const READ_PREFIXES = [
  '/health',
  '/api/health',
  '/posts', '/messages', '/analytics', '/bot', '/jobs', '/brands', '/guardian',
  '/schedule', '/metrics', '/traces', '/ai', '/image', '/persona', '/workspaces',
  '/users', '/knowledge', '/keys', '/workflow', '/plugins', '/dashboard',
  '/integrations', '/audit-logs', '/logs', '/monitoring', '/organism', '/condition',
  '/predictions', '/quality', '/competitors', '/applications', '/repos', '/services',
  '/topology', '/alerts', '/rules', '/events', '/circulation', '/pulse', '/meta',
  '/council', '/autonomy', '/owner', '/rate-limits', '/system', '/slo', '/timeline',
  '/status', '/features', '/notifications', '/schedule', '/ai/brain',
];

const OWNER_MUTATION_PREFIXES = [
  '/keys', '/owner', '/workspaces', '/users', '/social-accounts', '/meta/heal',
  '/meta/resolve', '/council/vote', '/workflow', '/guardian', '/circulation/heal',
];

const SENSITIVE_READ_PREFIXES = ['/keys', '/owner', '/users', '/audit-logs', '/logs', '/integrations', '/social-accounts', '/applications', '/plugins', '/workspaces', '/secrets'];
const GLOBAL_READ_PREFIXES = ['/status', '/features'];

const MUTATION_PREFIXES = [
  '/posts', '/messages', '/guardian', '/schedule', '/ai', '/image', '/persona',
  '/workspaces', '/users', '/knowledge', '/keys', '/workflow', '/plugins',
  '/condition', '/quality', '/council', '/circulation', '/meta', '/autonomy',
  '/owner', '/rules', '/bot', '/social-accounts', '/brands', '/applications',
];

function matches(pathname, prefixes) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function validateWorkspace(req) {
  const userWorkspace = req.user?.workspaceId ? String(req.user.workspaceId) : '';
  const allowedWorkspaces = new Set((req.user?.workspaceIds || []).map(String));
  if (userWorkspace) allowedWorkspaces.add(userWorkspace);
  const headerWorkspace = req.get('X-Workspace-ID');
  const queryWorkspace = typeof req.query.workspace_id === 'string' ? req.query.workspace_id : '';
  const bodyWorkspace = req.body && typeof req.body.workspace_id === 'string' ? req.body.workspace_id : '';
  const supplied = [headerWorkspace, queryWorkspace, bodyWorkspace].filter(Boolean).map(String);

  const unique = [...new Set(supplied)];
  if (unique.length > 1) throw new ForbiddenError('Conflicting workspace context supplied');
  if (unique.length && !allowedWorkspaces.has(unique[0]) && !req.user?.scopes?.includes('*') && !req.user?.scopes?.includes('workspace:*')) {
    throw new ForbiddenError('Workspace access denied');
  }
  if (unique.length) return unique[0];
  if (userWorkspace) return userWorkspace;
  return '';
}

function mutationAllowed(req) {
  if (!matches(req.path, MUTATION_PREFIXES)) return false;
  if (!roleAtLeast(req.user?.role, 'operator')) return false;
  if (req.user?.scopes?.includes('*')) return true;
  return hasScopes(req.user, ['control.write']);
}

router.use(requireAuth);
router.all('/*', async (req, res, next) => {
  try {
    const targetPath = `/${req.params[0] || ''}`.replace(/\/+/g, '/');
    if (targetPath.includes('..') || !matches(targetPath, READ_PREFIXES)) {
      throw new ForbiddenError('Control Plane endpoint is not exposed by the gateway');
    }

    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (mutating && !mutationAllowed(req)) {
      throw new ForbiddenError('Mutation requires operator control.write scope');
    }
    if (mutating && matches(targetPath, OWNER_MUTATION_PREFIXES) && !roleAtLeast(req.user?.role, 'owner')) {
      throw new ForbiddenError('Owner authorization required for this mutation');
    }

    const workspaceId = validateWorkspace(req);
    const globalRead = !mutating && matches(targetPath, GLOBAL_READ_PREFIXES);
    if (!globalRead && !workspaceId) throw new ForbiddenError('Workspace context required');
    if (!mutating && matches(targetPath, SENSITIVE_READ_PREFIXES) && !hasScopes(req.user, ['control.read'])) {
      throw new ForbiddenError('Sensitive read requires control.read scope');
    }
    const query = { ...req.query };
    delete query.token;
    delete query.secret;
    delete query.api_key;
    delete query.apikey;
    delete query.authorization;
    delete query.access_token;
    if (workspaceId) query.workspace_id = workspaceId;

    let body = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
      delete body.token;
      delete body.secret;
      if (workspaceId) body.workspace_id = workspaceId;
    }

    const result = await pythonClient.callPython({
      method: req.method,
      path: `/api/v1${targetPath}`,
      body,
      query,
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: workspaceId || undefined },
    });

    res.status(result.status).json(result.data ?? null);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
