'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerNamespaces, canJoinRoom } = require('../../src/socket/namespaces');
const { NAMESPACES } = require('../../src/contracts/events');
const { createSocketEventEnvelope } = require('../../src/services/socketEventEnvelope');

function createHarness(user) {
  const handlers = new Map();
  const joined = new Set();
  const left = [];
  const socket = {
    data: { user },
    on: (event, handler) => handlers.set(event, handler),
    join: async (room) => { joined.add(String(room)); },
    leave: async (room) => { joined.delete(String(room)); left.push(String(room)); },
  };
  const namespaces = new Map();
  const io = {
    of: (name) => {
      if (!namespaces.has(name)) {
        namespaces.set(name, {
          use: () => {},
          on: (event, handler) => {
            if (event === 'connection') handler(socket);
          },
        });
      }
      return namespaces.get(name);
    },
  };
  registerNamespaces(io);
  return { socket, joined, left, handlers, namespaceCount: namespaces.size };
}

test('socket auto-joins only its token default workspace, not every authorized workspace', () => {
  const { joined, namespaceCount } = createHarness({
    sub: 'operator-1',
    workspaceId: 'workspace-a',
    workspaceIds: ['workspace-a', 'workspace-b', 'workspace-c'],
  });

  assert.equal(namespaceCount, Object.keys(NAMESPACES).length);
  assert.deepEqual([...joined], ['workspace-a']);
});

test('switching workspace leaves the previous room before acknowledging the new room', async () => {
  const { joined, left, handlers, socket } = createHarness({
    sub: 'operator-1',
    workspaceId: 'workspace-a',
    workspaceIds: ['workspace-a', 'workspace-b'],
  });
  let acknowledgement;
  await handlers.get('join')('workspace-b', (ack) => { acknowledgement = ack; });

  assert.deepEqual([...joined], ['workspace-b']);
  assert.deepEqual(left, ['workspace-a']);
  assert.equal(socket.data.activeWorkspaceRoom, 'workspace-b');
  assert.deepEqual(acknowledgement, { ok: true, room: 'workspace-b' });
});

test('unauthorized workspace join is rejected without changing the active room', async () => {
  const { joined, left, handlers, socket } = createHarness({
    sub: 'operator-1',
    workspaceId: 'workspace-a',
    workspaceIds: ['workspace-a', 'workspace-b'],
  });
  let acknowledgement;
  await handlers.get('join')('workspace-secret', (ack) => { acknowledgement = ack; });

  assert.deepEqual([...joined], ['workspace-a']);
  assert.deepEqual(left, []);
  assert.equal(socket.data.activeWorkspaceRoom, 'workspace-a');
  assert.deepEqual(acknowledgement, { ok: false, error: 'forbidden' });
});

test('super-admin can select any workspace but still has only one active room', async () => {
  const { joined, left, handlers } = createHarness({
    sub: 'admin-1',
    principalType: 'human',
    platformRole: 'super_admin',
    workspaceIds: [],
  });
  await handlers.get('join')('workspace-a', () => {});
  await handlers.get('join')('workspace-b', () => {});

  assert.deepEqual([...joined], ['workspace-b']);
  assert.deepEqual(left, ['workspace-a']);
  assert.equal(canJoinRoom({ principalType: 'human', platformRole: 'super_admin' }, 'workspace-c'), true);
});

test('leave only removes the currently selected workspace room', async () => {
  const { joined, handlers, socket } = createHarness({
    sub: 'operator-1',
    workspaceId: 'workspace-a',
    workspaceIds: ['workspace-a', 'workspace-b'],
  });
  let rejected;
  await handlers.get('leave')('workspace-b', (ack) => { rejected = ack; });
  assert.deepEqual(rejected, { ok: false, error: 'not_active_workspace' });
  assert.deepEqual([...joined], ['workspace-a']);

  let accepted;
  await handlers.get('leave')('workspace-a', (ack) => { accepted = ack; });
  assert.deepEqual(accepted, { ok: true, room: 'workspace-a' });
  assert.deepEqual([...joined], []);
  assert.equal(socket.data.activeWorkspaceRoom, null);
});

test('socket event envelope includes the authoritative room workspace ID', () => {
  const payload = {
    type: 'incident.created',
    ts: '2026-11-08T10:00:00.000Z',
    workspace_id: 'forged-workspace',
    data: { id: 'incident-1', workspace_id: 'forged-workspace' },
  };
  const envelope = createSocketEventEnvelope(payload, 'workspace-a');

  assert.equal(envelope.workspace_id, 'workspace-a');
  assert.equal(envelope.type, 'incident.created');
  assert.equal(envelope.ts, payload.ts);
  assert.deepEqual(envelope.data, payload.data);
});
