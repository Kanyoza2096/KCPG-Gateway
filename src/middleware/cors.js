'use strict';

const cors = require('cors');
const config = require('../config');

// ═══════════════════════════════════════════════════════════════════════
// ⚠️  TEMPORARY — CORS OPENED FOR DEV/TESTING
// Date opened: 2026-09-22
// Revert: restore the origin() allowlist below (see commented block).
// After reverting: rotate PYTHON_SERVICE_TOKEN on both gateway and Python
// service, and clear any credentials that passed through during this window.
// ═══════════════════════════════════════════════════════════════════════

const corsMiddleware = cors({
  origin(origin, callback) {
    // TEMPORARY: accept every origin.
    // Reminder: credentials: true means the browser will attach cookies,
    // so this also permits cross-site authenticated requests.
    return callback(null, true);

    // ── ORIGINAL — restore to revert ────────────────────────────────
    // if (!origin) return callback(null, true); // same-origin / server-to-server
    // if (config.corsOrigins.includes('*')) return callback(null, true);
    // if (config.corsOrigins.includes(origin)) return callback(null, true);
    // return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Correlation-Id', 'X-Workspace-ID', 'traceparent'],
  exposedHeaders: ['X-Request-Id', 'X-Command-Id', 'traceparent'],
});

module.exports = { corsMiddleware };
