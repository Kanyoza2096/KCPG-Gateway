'use strict';

/**
 * Build the public Socket.IO envelope with an authoritative workspace scope.
 * The room selected by the gateway is authoritative; payload data cannot
 * override the outer workspace identifier consumed by clients.
 */
function createSocketEventEnvelope(payload, workspaceId) {
  return {
    type: payload.type,
    ts: payload.ts || new Date().toISOString(),
    workspace_id: String(workspaceId),
    data: payload.data !== undefined ? payload.data : payload,
  };
}

module.exports = { createSocketEventEnvelope };
