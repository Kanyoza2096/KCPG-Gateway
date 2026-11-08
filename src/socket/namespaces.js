'use strict';

const { NAMESPACES } = require('../contracts/events');
const { socketAuth } = require('./auth');
const logger = require('../utils/logger');

/**
 * Register namespaces and enforce one active workspace room per socket.
 * A user may be authorized for several workspaces, but a single socket only
 * receives events for the explicitly selected workspace.
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

      // Preserve the token's default workspace for existing clients, but never
      // subscribe automatically to every workspace in the user's access list.
      const defaultWorkspace = user?.workspaceId ? String(user.workspaceId) : null;
      if (defaultWorkspace && canJoinRoom(user, defaultWorkspace)) {
        socket.join(defaultWorkspace);
        socket.data.activeWorkspaceRoom = defaultWorkspace;
      } else {
        socket.data.activeWorkspaceRoom = null;
      }

      socket.on('join', async (room, ack) => {
        try {
          const workspaceId = typeof room === 'string' ? room.trim() : '';
          if (!canJoinRoom(user, workspaceId)) {
            if (typeof ack === 'function') ack({ ok: false, error: 'forbidden' });
            return;
          }

          // A socket must not remain subscribed to its previous workspace
          // after switching context. This applies even when both workspaces
          // are legitimately available to the same principal.
          const previousRoom = socket.data.activeWorkspaceRoom;
          if (previousRoom && previousRoom !== workspaceId) {
            await Promise.resolve(socket.leave(previousRoom));
          }

          await Promise.resolve(socket.join(workspaceId));
          socket.data.activeWorkspaceRoom = workspaceId;
          if (typeof ack === 'function') ack({ ok: true, room: workspaceId });
        } catch (err) {
          if (typeof ack === 'function') ack({ ok: false, error: err.message });
        }
      });

      socket.on('leave', async (room, ack) => {
        try {
          const workspaceId = typeof room === 'string' ? room.trim() : '';
          if (!workspaceId || socket.data.activeWorkspaceRoom !== workspaceId) {
            if (typeof ack === 'function') ack({ ok: false, error: 'not_active_workspace' });
            return;
          }
          await Promise.resolve(socket.leave(workspaceId));
          socket.data.activeWorkspaceRoom = null;
          if (typeof ack === 'function') ack({ ok: true, room: workspaceId });
        } catch (err) {
          if (typeof ack === 'function') ack({ ok: false, error: err.message });
        }
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
  if (user.principalType === 'human' && user.platformRole === 'super_admin') return true;
  return allowed.has(room);
}

module.exports = { registerNamespaces, canJoinRoom };
