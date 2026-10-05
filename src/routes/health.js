'use strict';

const express = require('express');
const pythonClient = require('../services/pythonClient');
const eventBus = require('../services/eventBus');

const router = express.Router();

/** Liveness — process is up */
router.get('/live', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'kcpg',
    ts: new Date().toISOString(),
  });
});

/** Readiness — critical deps */
router.get('/ready', async (_req, res) => {
  const python = await pythonClient.ping();
  const redis = eventBus.isConnected();

  const ready = python.ok && (!eventBus.isConnected() ? !require('../config').redis.required : true);
  const status = ready ? 'ready' : python.ok ? 'degraded' : 'unavailable';

  res.status(ready ? 200 : 503).json({
    status,
    service: 'kcpg',
    checks: {
      redis,
      python: python.ok,
      pythonStatus: python.status,
    },
    ts: new Date().toISOString(),
  });
});

module.exports = router;
