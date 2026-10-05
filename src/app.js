'use strict';

const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const { requestId } = require('./middleware/requestId');
const { tracing } = require('./middleware/tracing');
const { logging } = require('./middleware/logging');
const { corsMiddleware } = require('./middleware/cors');
const { globalRateLimit } = require('./middleware/rateLimit');
const { errorHandler } = require('./middleware/errorHandler');
const { metricsMiddleware } = require('./middleware/metrics');
const { requestOriginGuard } = require('./middleware/originGuard');
const metrics = require('./services/metrics');
const routes = require('./routes');
const logger = require('./utils/logger');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(requestId);
  app.use(tracing);
  app.use(logging);
  app.use(corsMiddleware);
  app.use(requestOriginGuard);
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(globalRateLimit);
  app.use(metricsMiddleware);

  // Canonical gateway route composition. No broad Supabase or arbitrary backend
  // proxy is mounted here: every browser API surface must be explicitly allowlisted.
  app.use(routes);

  app.get('/metrics', (req, res) => {
    const expected = config.metrics.scrapeToken;
    if (expected && req.headers.authorization !== `Bearer ${expected}`) {
      return res.status(401).type('text/plain').send('unauthorized\n');
    }
    res.type('text/plain').send(metrics.prometheus());
  });

  app.get('/', (_req, res) => {
    res.json({
      service: 'kanyoza-control-plane-gateway',
      version: config.version,
      auth: 'gateway-session',
      backend: config.python.baseUrl,
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
