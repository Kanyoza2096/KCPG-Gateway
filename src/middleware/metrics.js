'use strict';

const metrics = require('../services/metrics');

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.observeRequest({ durationMs, statusCode: res.statusCode });
  });
  next();
}

module.exports = { metricsMiddleware };
