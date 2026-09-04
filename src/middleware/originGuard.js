'use strict';

const config = require('../config');
const { ForbiddenError } = require('../utils/errors');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requestOriginGuard(req, _res, next) {
  if (!MUTATING.has(req.method) || !req.path.startsWith('/api/')) return next();

  const origin = req.get('Origin');
  if (!origin) return next(); // server-to-server clients do not send Origin

  if (config.corsOrigins.includes(origin)) return next();
  return next(new ForbiddenError('Request origin is not allowed'));
}

module.exports = { requestOriginGuard };
