'use strict';

const logger = require('../utils/logger');

function logging(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('http_request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: Date.now() - start,
      user: req.user?.sub || null,
    });
  });
  next();
}

module.exports = { logging };
