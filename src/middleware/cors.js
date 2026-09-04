'use strict';

const cors = require('cors');
const config = require('../config');

const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // same-origin / server-to-server
    if (config.corsOrigins.includes('*')) return callback(null, true);
    if (config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Correlation-Id', 'X-Workspace-ID', 'traceparent'],
  exposedHeaders: ['X-Request-Id', 'X-Command-Id', 'traceparent'],
});

module.exports = { corsMiddleware };
