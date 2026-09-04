'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const { globalStore, commandStore } = require('../services/redisRateLimitStore');

const globalRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  ...(config.isProd ? { store: globalStore, passOnStoreError: false } : {}),
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    },
  },
});

/** Stricter limit for command mutations */
const commandRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  ...(config.isProd ? { store: commandStore, passOnStoreError: false } : {}),
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many commands',
    },
  },
});

module.exports = { globalRateLimit, commandRateLimit };
