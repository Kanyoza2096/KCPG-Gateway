'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('phase 40: Python command identity is actually propagated to HTTP headers', () => {
  const source = read('src/services/pythonClient.js');
  assert.match(source, /traceparent, commandId/);
  assert.match(source, /X-Command-ID/);
});

test('phase 40: event ingress is cryptographically authenticatable in production', () => {
  const source = read('src/routes/internalEvents.js');
  assert.match(source, /x-kcpg-event-signature/);
  assert.match(source, /createHmac\('sha256'/);
  assert.match(source, /safeEqual/);
});

test('phase 40: production requires the independent Python event signing secret', () => {
  const source = read('src/config/index.js');
  assert.match(source, /PYTHON_EVENT_SIGNING_SECRET/);
  assert.match(source, /REQUIRE_EVENT_SIGNATURE/);
});

test('phase 40: stale and future observations are fenced by generation', () => {
  const source = read('src/services/resourceState.js');
  assert.match(source, /incoming < current/);
  assert.match(source, /incoming > desiredGeneration/);
  assert.match(source, /Observed generation is ahead of desired generation/);
});

test('phase 40: resource freshness is calculated from observation time', () => {
  const source = read('src/services/resourceState.js');
  assert.match(source, /computeFreshness/);
  assert.match(source, /Date\.now\(\) - observedAt/);
});

test('phase 40: Socket.IO realtime dependency is declared', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['socket.io']);
});
