'use strict';

const config = require('../config');
const { verifyToken, devIdentity } = require('../utils/token');
const { fromRequest } = require('../utils/session');
const logger = require('../utils/logger');

/**
 * Socket.IO middleware: authenticate handshake.
 * Token via Socket.IO auth.token or Authorization header only.
 */
function socketAuth(socket, next) {
  try {
    if (config.auth.disabled) {
      socket.data.user = devIdentity();
      return next();
    }

    const token =
      socket.handshake.auth?.token ||
      extractBearer(socket.handshake.headers?.authorization) ||
      fromRequest({ headers: socket.handshake.headers });

    if (!token) {
      return next(new Error('Unauthorized'));
    }

    socket.data.user = verifyToken(token);
    return next();
  } catch (err) {
    logger.warn('socket_auth_failed', { message: err.message });
    return next(new Error('Unauthorized'));
  }
}

function extractBearer(header) {
  if (!header || typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && value) return value.trim();
  return null;
}

module.exports = { socketAuth };
