const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bff = fs.readFileSync(path.join(root, 'src/routes/bff.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/services/pythonClient.js'), 'utf8');
const socketAuth = fs.readFileSync(path.join(root, 'src/socket/auth.js'), 'utf8');

test('final release preserves explicitly authorized secondary workspace', () => {
  assert.match(bff, /allowedWorkspaces/);
  assert.match(bff, /Workspace access denied/);
  assert.match(bff, /__requestWorkspaceId: workspaceId/);
});

test('python client honors gateway-selected workspace context', () => {
  assert.match(client, /user\?\.__requestWorkspaceId \|\| user\?\.workspaceId/);
});

test('Socket.IO realtime authentication uses session/header credentials, not query strings', () => {
  assert.match(socketAuth, /fromRequest\(\{ headers: socket\.handshake\.headers \}\)/);
  assert.doesNotMatch(socketAuth, /query/);
});
