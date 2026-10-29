'use strict';

const express = require('express');
const pythonClient = require('../services/pythonClient');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

// Personal Operator Mode: Transparent BFF proxy.
// No allowlists, no scope checks. Just attach auth and forward.
router.all('/*', async (req, res, next) => {
  try {
    // Extract the path the frontend requested (e.g., /organism/vitals)
    // We use a wildcard catch-all regex to ensure we get everything.
    const targetPath = req.originalUrl.replace(/^\/api\/v1/, '');
    
    // The workspace ID is critical for the Python backend.
    // If the frontend sends it, use it. Otherwise, fallback to default.
    const headerWorkspace = req.get('X-Workspace-ID');
    const workspaceId = headerWorkspace || process.env.DEFAULT_WORKSPACE_ID || 'ws-e6eb6528d5b9';

    // Sanitize query parameters (remove any secrets the browser might send)
    const query = { ...req.query };
    delete query.token;
    delete query.secret;
    delete query.api_key;
    delete query.apikey;
    delete query.authorization;
    delete query.access_token;
    
    // Inject workspace ID into the query
    if (workspaceId) query.workspace_id = workspaceId;

    // Prepare body for POST/PUT/PATCH
    let body = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
      delete body.token;
      delete body.secret;
      if (workspaceId) body.workspace_id = workspaceId;
    }

    // Forward the request using the existing pythonClient
    // The pythonClient already knows how to attach the Master Token (X-API-Key)
    const result = await pythonClient.callPython({
      method: req.method,
      path: `/api/v1${targetPath}`,
      body,
      query,
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { 
        ...req.user, 
        __requestWorkspaceId: workspaceId 
      },
    });

    // Return the backend's response to the browser
    // Handle raw responses (like text or empty bodies) gracefully
    if (result.status === 204) {
      return res.status(204).end();
    }
    
    // If the data is a string (e.g., Prometheus metrics), send it as text
    if (typeof result.data === 'string') {
      return res.status(result.status).send(result.data);
    }
    
    return res.status(result.status).json(result.data ?? null);

  } catch (err) {
    logger.error('[BFF] Proxy error:', { error: err.message, path: req.originalUrl });
    next(err);
  }
});

module.exports = router;
