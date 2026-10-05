'use strict';

const express = require('express');
const axios = require('axios');
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
  const requiredScopes = mutating ? ['control.write'] : ['control.read'];

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
