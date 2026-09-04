'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pythonClient = require('../services/pythonClient');
const { ForbiddenError } = require('../utils/errors');
const { hasScopes } = require('../contracts/commands');
const config = require('../config');

const router = express.Router();

/**
 * Narrow path allowlist for escape-hatch proxying.
 * Prefer BFF + commands over this route.
 */
const ALLOWED_PREFIXES = [
  '/api/v1/workspaces',
  '/api/v1/brands',
  '/api/v1/posts',
  '/api/v1/jobs',
  '/api/v1/analytics',
  '/api/v1/organism',
  '/api/v1/species',
  '/api/v1/council',
  '/api/v1/e2e',
  '/api/v1/workflow',
  '/api/v1/metabolism',
  '/api/v1/slo',
  '/api/v1/timeline',
  '/api/v1/status',
  '/api/v1/dashboard',
  '/api/v1/metrics',
  '/api/v1/integrations',
  '/api/v1/guardian',
  '/api/v1/circulation',
  '/api/v1/pulse',
  '/api/v1/heartbeat',
  '/api/v1/reflexes',
  '/api/v1/dreams',
  '/api/v1/condition',
  '/api/v1/content',
  '/api/v1/autonomous',
  '/api/v1/predictions',
  '/api/v1/quality',
  '/api/v1/competitors',
  '/api/v1/meta',
  '/api/v1/director',
  '/api/v1/ai',
  '/api/v1/security',
  '/api/v1/users',
  '/api/v1/audit',
  '/api/v1/marketplace',
  '/api/v1/tenants',
  '/api/v1/monitoring',
  '/api/v1/chat',
  '/api/v1/features',
  '/api/v1/social',
  '/api/v1/notifications',
  '/api/v1/dataflow',
  '/api/v1/architecture',
  '/api/v1/logs',
  '/api/v1/events',
  '/api/v1/github',
  '/api/v1/pdf',
  '/api/v1/email',
  '/api/v1/payload',
  '/api/v1/scheduler',
  '/api/v1/tasks',
  '/api/v1/settings',
  '/health',
  '/api/health',
];

function isAllowed(path) {
  if (!path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * ALL /api/v1/proxy/*
 * Forwards to Python core with internal auth.
 */
router.all('/*', requireAuth, requireRole('operator'), async (req, res, next) => {
  if (!config.proxy.enabled) return next(new ForbiddenError('Proxy escape hatch is disabled')); 
  try {
    const suffix = req.params[0] ? `/${req.params[0]}` : '';
    // Client calls: /api/v1/proxy/api/v1/posts → path /api/v1/posts
    // Or: /api/v1/proxy/health/live
    let targetPath = suffix || '/';
    if (!targetPath.startsWith('/')) targetPath = `/${targetPath}`;

    if (!isAllowed(targetPath)) {
      throw new ForbiddenError(`Path not allowed for proxy: ${targetPath}`);
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!hasScopes(req.user, ['control.write'])) throw new ForbiddenError('Mutation requires control.write scope');
    }

    const forwardedQuery = { ...req.query };
    for (const key of ['token', 'secret', 'api_key', 'apikey', 'authorization', 'access_token']) delete forwardedQuery[key];

    const result = await pythonClient.callPython({
      method: req.method,
      path: targetPath,
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
      query: forwardedQuery,
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: req.user,
    });

    res.status(result.status).json(result.data ?? null);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
