'use strict';

const { Server } = require('socket.io');
const config = require('../config');
const { registerNamespaces } = require('./namespaces');
const eventBus = require('../services/eventBus');
const logger = require('../utils/logger');

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  registerNamespaces(io);
  eventBus.attachSocketServer(io);

  logger.info('socket_server_ready', { path: '/socket.io' });
  return io;
}

module.exports = { createSocketServer };
