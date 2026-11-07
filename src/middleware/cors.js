'use strict';

const cors = require('cors');
const config = require('../config');
const { isAllowedOrigin } = require('../utils/originPolicy');

const corsMiddleware = cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin, config.corsOrigins)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Request-Id',
    'X-Correlation-Id',
    'X-Workspace-ID',
    'X-Control-Plane',
    'Idempotency-Key',
    'traceparent',
  ],
  exposedHeaders: ['X-Request-Id', 'X-Command-Id', 'traceparent'],
});

module.exports = { corsMiddleware };
