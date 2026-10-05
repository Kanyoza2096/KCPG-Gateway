'use strict';

const { NAMESPACES } = require('../contracts/events');
const { socketAuth } = require('./auth');
const logger = require('../utils/logger');

/**
 * Register namespaces and room join rules.
 * Clients may only join rooms they are allowed to see.
 */
function registerNamespaces(io) {
  for (const ns of Object.values(NAMESPACES)) {
    const nsp = io.of(ns);
    nsp.use(socketAuth);

    nsp.on('connection', (socket) => {
      const user = socket.data.user;
      logger.info('socket_connected', {
        namespace: ns,
        user: user?.sub,
        role: user?.role,
      });

      // Never auto-join a global room: it would create a cross-tenant broadcast
      // channel. Workspace rooms are the only default subscription boundary.
      for (const workspaceId of user?.workspaceIds || []) {
        socket.join(String(workspaceId));
      }
      if (user?.workspaceId && !(user.workspaceIds || []).includes(user.workspaceId)) {
        socket.join(String(user.workspaceId));
      }

      socket.on('join', (room, ack) => {
        try {
          const allowed = canJoinRoom(user, room);
          if (!allowed) {
            if (typeof ack === 'function') ack({ ok: false, error: 'forbidden' });
            return;
          }
          socket.join(String(room));
          if (typeof ack === 'function') ack({ ok: true, room });
        } catch (err) {
          if (typeof ack === 'function') ack({ ok: false, error: err.message });
        }
      });

      socket.on('leave', (room, ack) => {
        socket.leave(String(room));
        if (typeof ack === 'function') ack({ ok: true });
      });

      socket.on('disconnect', (reason) => {
        logger.debug('socket_disconnected', {
          namespace: ns,
          user: user?.sub,
          reason,
        });
      });
    });
  }
}

function canJoinRoom(user, room) {
  if (!room || typeof room !== 'string') return false;
  if (!user) return false;
  const allowed = new Set((user.workspaceIds || []).map(String));
  if (user.workspaceId) allowed.add(String(user.workspaceId));
  if (user.scopes?.includes('*') || user.scopes?.includes('workspace:*')) return true;
  return allowed.has(String(room));
}

module.exports = { registerNamespaces };
