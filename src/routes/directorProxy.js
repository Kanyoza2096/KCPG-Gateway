'use strict';

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const { requireAuth, requireWorkspace } = require('../middleware/auth');
const { roleAtLeast, hasScopes } = require('../contracts/commands');
const { ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Director Proxy — forwards /director/* to Python backend.
 * Python mounts Director at /director/*.
 *
 * Authorization (defense-in-depth):
 *   - All methods: requireAuth + requireWorkspace
 *   - Reads (GET/HEAD): min role viewer + control.read (or *)
 *   - Mutations (POST/PUT/PATCH/DELETE): min role operator + control.write (or *)
 */
router.use(requireAuth);
router.use(requireWorkspace);

function assertDirectorAccess(req) {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const minRole = mutating ? 'operator' : 'viewer';
  const runtimeRoute = req.path.startsWith('/missions/') && req.path.includes('/orchestration/');
  const requiredScopes = runtimeRoute
    ? (mutating ? ['control.write', 'director.write'] : ['control.read', 'director.read'])
    : (mutating ? ['control.write'] : ['control.read']);

  if (!roleAtLeast(req.user?.role, minRole)) {
    throw new ForbiddenError(
      `Director ${mutating ? 'mutation' : 'read'} requires role >= ${minRole}`
    );
  }
  if (!hasScopes(req.user, requiredScopes)) {
    throw new ForbiddenError(
      `Director ${mutating ? 'mutation' : 'read'} requires scope ${requiredScopes.join(' or ')}`
    );
  }
}

router.all('/*', async (req, res, next) => {
  try {
    assertDirectorAccess(req);

    const targetPath = `/director${req.originalUrl.replace(/^\/director/, '')}`;
    const pythonBaseUrl = config.python.baseUrl;
    const pythonServiceToken = config.python.serviceToken;

    if (!pythonBaseUrl || !pythonServiceToken) {
      return res.status(500).json({
        error: {
          code: 'DIRECTOR_PROXY_NOT_CONFIGURED',
          message: 'Python backend not configured',
        },
      });
    }

    const headers = {
      Authorization: `Bearer ${pythonServiceToken}`,
      'Content-Type': 'application/json',
      'X-Request-Id': req.requestId || '',
      'X-Correlation-ID': req.requestId || '',
    };

    if (req.user?.sub) headers['X-User-Id'] = String(req.user.sub);
    if (req.user?.role) headers['X-User-Role'] = String(req.user.role);
    if (req.workspaceId) headers['X-Workspace-ID'] = String(req.workspaceId);

    // Mission runtime routes require a signed human actor envelope. The
    // Python service token authenticates KCPG as a machine; this HMAC binds
    // the already-authenticated KCPG principal and selected workspace.
    if (req.path.startsWith('/missions/') && req.path.includes('/orchestration/')) {
      const secret = config.python.contextSigningSecret;
      if (!secret || secret.length < 32) {
        return res.status(503).json({
          error: {
            code: 'DIRECTOR_CONTEXT_SIGNING_NOT_CONFIGURED',
            message: 'Signed KCPG actor context is required for Director mission runtime routes',
          },
        });
      }
      const timestamp = String(Date.now());
      const actorId = String(req.user?.sub || '');
      const actorRole = String(req.user?.role || 'viewer').toLowerCase();
      const workspaceId = String(req.workspaceId || '');
      const contextRequestId = String(req.requestId || crypto.randomUUID());
      if (!actorId || !workspaceId || !['viewer', 'operator', 'admin', 'owner'].includes(actorRole)) {
        return res.status(403).json({ error: { code: 'DIRECTOR_CONTEXT_INCOMPLETE', message: 'Authenticated actor and workspace are required' } });
      }
      const canonical = [timestamp, contextRequestId, workspaceId, actorId, actorRole].join('|');
      headers['X-KCPG-Context-Timestamp'] = timestamp;
      headers['X-KCPG-Context-Request-ID'] = contextRequestId;
      headers['X-KCPG-Context-Workspace-ID'] = workspaceId;
      headers['X-KCPG-Context-Actor-ID'] = actorId;
      headers['X-KCPG-Context-Actor-Role'] = actorRole;
      headers['X-KCPG-Context-Signature'] = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
      headers['X-Correlation-ID'] = contextRequestId;
    }

    const response = await axios({
      method: req.method,
      url: `${pythonBaseUrl}${targetPath}`,
      params: req.query,
      data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
      headers,
      validateStatus: () => true,
      timeout: 30_000,
    });

    // A 401 returned by the Python Director at this boundary means the
    // browser/session authentication already passed KCPG, but the internal
    // KCPG → Python service credential was rejected.  Do not misreport that
    // deployment trust failure as the user's bad credentials.
    if (response.status === 401) {
      logger.error('director_service_auth_failed', {
        path: req.originalUrl,
        requestId: req.requestId || null,
      });
      return res.status(502).json({
        error: {
          code: 'DIRECTOR_SERVICE_AUTH_FAILED',
          message: 'KCPG authenticated the request, but the Python Director rejected the internal service credential',
        },
      });
    }

    res.status(response.status);
    if (response.headers['content-type']?.includes('application/json')) {
      res.json(response.data);
    } else {
      res.send(response.data);
    }
  } catch (err) {
    if (err instanceof ForbiddenError) return next(err);
    logger.error('director_proxy_failed', { message: err.message, path: req.originalUrl });
    next(err);
  }
});

module.exports = router;
