'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('HTTP credentials are header-only', () => {
  const token = read('src/utils/token.js');
  assert.doesNotMatch(token, /req\.query\?\.token/);
  assert.match(token, /authorization/i);
});

test('Socket credentials do not use query strings', () => {
  const auth = read('src/socket/auth.js');
  assert.doesNotMatch(auth, /handshake\.query\?\.token/);
  assert.match(auth, /handshake\.auth\?\.token/);
});

test('production proxy is disabled by configuration', () => {
  const config = read('src/config/index.js');
  const proxy = read('src/routes/proxy.js');
  assert.match(config, /PROXY_ENABLED/);
  assert.match(proxy, /Proxy escape hatch is disabled/);
});

test('production requires dedicated Python service credential', () => {
  const config = read('src/config/index.js');
  assert.match(config, /PYTHON_SERVICE_TOKEN/);
  assert.match(config, /length < 32/);
});

test('commands require explicit scopes and never use semantic aliases', () => {
  const registry = read('contracts/control-plane-command-registry.v1.json');
  const commands = read('src/contracts/commands.js');
  const policy = read('src/services/commandPolicy.js');
  assert.match(registry, /"scopes":/);
  assert.match(policy, /hasScopes/);
  assert.doesNotMatch(registry, /best-effort|closest real endpoint|No dedicated resume/i);
  assert.doesNotMatch(registry, /"id":\s*"service\.restart"/);
});

test('event fanout is workspace-scoped', () => {
  const ns = read('src/socket/namespaces.js');
  const bus = read('src/services/eventBus.js');
  assert.doesNotMatch(ns, /socket\.join\('global'\)/);
  assert.match(bus, /event_dropped_missing_workspace/);
  assert.match(bus, /workspaceId is required/);
});

test('production readiness is not unconditional', () => {
  const health = read('src/routes/health.js');
  const server = read('server.js');
  assert.doesNotMatch(health, /const ready = true/);
  assert.match(server, /Redis is required in production/);
});
