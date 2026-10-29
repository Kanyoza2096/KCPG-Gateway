'use strict';

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('../config');

const router = express.Router();

// A transparent proxy for personal use.
// No allowlists, no scope checks. Just attach the Master Token and forward.
router.use('/', createProxyMiddleware({
  target: config.python.baseUrl, // e.g., https://kanyoza-digital-organism.onrender.com
  changeOrigin: true,
  // We are mounted at /api/v1, so we forward to /api/v1 on the backend
  pathRewrite: (path, req) => {
    // If the frontend sends /api/v1/organism/vitals, we want the backend to receive /api/v1/organism/vitals
    return `/api/v1${path}`;
  },
  headers: {
    // Inject the master token so the Python backend accepts the request
    'X-API-Key': config.python.masterToken || process.env.MASTER_TOKEN,
    // Inject the workspace ID so the backend doesn't default to "platform"
    'X-Workspace-ID': process.env.DEFAULT_WORKSPACE_ID || 'ws-e6eb6528d5b9',
  },
  onProxyReq: (proxyReq, req, res) => {
    // Forward correlation IDs for tracing
    if (req.headers['x-correlation-id']) {
      proxyReq.setHeader('x-correlation-id', req.headers['x-correlation-id']);
    }
    // Forward the user's session cookie if they have one (optional, but good for backend logs)
    if (req.headers.cookie) {
      proxyReq.setHeader('cookie', req.headers.cookie);
    }
  },
  onError: (err, req, res) => {
    console.error('[BFF Proxy Error]', err.message);
    res.status(502).json({
      error: {
        code: 'BACKEND_UNAVAILABLE',
        message: 'Failed to reach the Python backend',
        detail: err.message,
      },
    });
  },
}));

module.exports = router;
