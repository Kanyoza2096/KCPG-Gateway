'use strict';

const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const config = require('../config');

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const code = err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
  const message = err.message || 'Internal server error';

  if (status >= 500) {
    logger.error('request_error', {
      requestId: req.requestId,
      code,
      message,
      stack: config.isDev ? err.stack : undefined,
    });
  } else {
    logger.warn('client_error', {
      requestId: req.requestId,
      code,
      message,
      status,
    });
  }

  // CORS misconfiguration surfaces as Error from cors package
  if (err.message && err.message.startsWith('CORS blocked')) {
    return res.status(403).json({
      error: { code: 'CORS_BLOCKED', message: err.message, requestId: req.requestId },
    });
  }

  const body = {
    error: {
      code,
      message: status >= 500 && config.isProd ? 'Internal server error' : message,
      requestId: req.requestId,
    },
  };

  if (err.details && !config.isProd) {
    body.error.details = err.details;
  }

  if (err instanceof AppError && err.details) {
    body.error.details = err.details;
  }

  res.status(status).json(body);
}

module.exports = { errorHandler };
