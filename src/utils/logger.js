'use strict';

const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[config.logLevel] ?? 20;

function log(level, message, meta) {
  if ((LEVELS[level] ?? 99) < min) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(meta && typeof meta === 'object' ? meta : meta != null ? { meta } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
