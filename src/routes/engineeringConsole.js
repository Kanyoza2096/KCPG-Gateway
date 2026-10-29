'use strict';

const express = require('express');
const { requireAuth, requireRole, requireWorkspace } = require('../middleware/auth');
const { hasScopes } = require('../contracts/commands');
const pythonClient = require('../services/pythonClient');
const { ForbiddenError } = require('../utils/errors');

const router = express.Router();
const UPSTREAM_PREFIX = '/api/v1/engineering/console';

function requireScope(scope) {
  return (req, _res, next) => {
    if (!hasScopes(req.user, [scope])) return next(new ForbiddenError(`Engineering console requires ${scope} scope`));
    return next();
  };
}

function boundedInteger(value, fallback, min, max, field) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    const error = new Error(`${field} must be an integer between ${min} and ${max}`);
    error.status = 400;
    error.code = 'BAD_REQUEST';
    throw error;
  }
  return parsed;
}

function safeString(value, { field, min = 1, max, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return undefined;
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    const error = new Error(`${field} must be a string between ${min} and ${max} characters`);
    error.status = 400;
    error.code = 'BAD_REQUEST';
    throw error;
  }
  return value.trim();
}

function cleanQuery(query, workspaceId) {
  const clean = {};
  for (const [key, value] of Object.entries(query || {})) {
    if (['token', 'secret', 'api_key', 'apikey', 'authorization', 'access_token', 'workspace_id'].includes(key)) continue;
    clean[key] = value;
  }
  clean.workspace_id = workspaceId;
  return clean;
}

async function forward(req, res, next, { method, path, body, query } = {}) {
  try {
    const result = await pythonClient.callPython({
      method: method || req.method,
      path: `${UPSTREAM_PREFIX}${path || ''}`,
      body,
      query: query === undefined ? undefined : cleanQuery(query, req.workspaceId),
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: req.workspaceId },
      gatewayContext: { actorId: req.user?.sub, actorRole: req.user?.role, workspaceId: req.workspaceId, requestId: req.requestId },
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status).json(result.data ?? null);
  } catch (err) {
    next(err);
  }
}

// All reads are authenticated and workspace-scoped. Mutations require both an
// operator role and the explicit control.write scope; the upstream repeats its
// own authentication and workflow-policy checks.
router.get('/capabilities', requireAuth, requireRole('viewer'), requireScope('control.read'), requireWorkspace,
  (req, res, next) => forward(req, res, next, { path: '/capabilities', query: req.query }));

router.get('/tasks', requireAuth, requireRole('viewer'), requireScope('control.read'), requireWorkspace,
  (req, res, next) => {
    try {
      const limit = boundedInteger(req.query.limit, 30, 1, 100, 'limit');
      return forward(req, res, next, { path: '/tasks', query: { limit } });
    } catch (err) { return next(err); }
  });

router.post('/tasks', requireAuth, requireRole('operator'), requireScope('control.write'), requireWorkspace,
  (req, res, next) => {
    try {
      const objective = safeString(req.body?.objective, { field: 'objective', max: 12000 });
      const criteria = req.body?.acceptance_criteria ?? [];
      if (!Array.isArray(criteria) || criteria.length > 30 || criteria.some((x) => typeof x !== 'string' || !x.trim() || x.length > 1000)) {
        const error = new Error('acceptance_criteria must contain at most 30 nonempty strings of at most 1000 characters');
        error.status = 400; error.code = 'BAD_REQUEST'; throw error;
      }
      const idempotencyKey = safeString(req.body?.idempotency_key, { field: 'idempotency_key', max: 200, optional: true });
      const body = { objective, acceptance_criteria: criteria.map((x) => x.trim()), workspace_id: req.workspaceId };
      if (idempotencyKey) body.idempotency_key = idempotencyKey;
      return forward(req, res, next, { method: 'POST', path: '/tasks', body });
    } catch (err) { return next(err); }
  });

router.get('/tasks/:taskId', requireAuth, requireRole('viewer'), requireScope('control.read'), requireWorkspace,
  (req, res, next) => forward(req, res, next, { path: `/tasks/${encodeURIComponent(req.params.taskId)}` }));

router.get('/tasks/:taskId/events', requireAuth, requireRole('viewer'), requireScope('control.read'), requireWorkspace,
  (req, res, next) => {
    try {
      const afterSequence = boundedInteger(req.query.after_sequence, 0, 0, Number.MAX_SAFE_INTEGER, 'after_sequence');
      const limit = boundedInteger(req.query.limit, 200, 1, 500, 'limit');
      return forward(req, res, next, { path: `/tasks/${encodeURIComponent(req.params.taskId)}/events`, query: { after_sequence: afterSequence, limit } });
    } catch (err) { return next(err); }
  });

router.post('/tasks/:taskId/plan/generate', requireAuth, requireRole('operator'), requireScope('control.write'), requireWorkspace,
  (req, res, next) => forward(req, res, next, { method: 'POST', path: `/tasks/${encodeURIComponent(req.params.taskId)}/plan/generate`, body: { workspace_id: req.workspaceId } }));

router.post('/tasks/:taskId/plan', requireAuth, requireRole('operator'), requireScope('control.write'), requireWorkspace,
  (req, res, next) => {
    const steps = req.body?.steps;
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 30 || steps.some((x) => typeof x !== 'string' || !x.trim() || x.length > 2000)) {
      const error = new Error('steps must contain 1 to 30 nonempty strings of at most 2000 characters');
      error.status = 400; error.code = 'BAD_REQUEST'; return next(error);
    }
    return forward(req, res, next, { method: 'POST', path: `/tasks/${encodeURIComponent(req.params.taskId)}/plan`, body: { steps: steps.map((x) => x.trim()), workspace_id: req.workspaceId } });
  });

router.post('/tasks/:taskId/decision', requireAuth, requireRole('operator'), requireScope('control.write'), requireWorkspace,
  (req, res, next) => {
    const decision = req.body?.decision;
    const expectedRevision = req.body?.expected_revision;
    if (!['approve', 'reject'].includes(decision) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      const error = new Error('decision must be approve or reject and expected_revision must be a positive integer');
      error.status = 400; error.code = 'BAD_REQUEST'; return next(error);
    }
    return forward(req, res, next, { method: 'POST', path: `/tasks/${encodeURIComponent(req.params.taskId)}/decision`, body: { decision, expected_revision: expectedRevision, workspace_id: req.workspaceId } });
  });

module.exports = router;
