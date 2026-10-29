'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('phase 39: every authoritative control-plane data route requires workspace context', () => {
  const source = read('src/routes/controlPlane.js');
  for (const route of ['/overview', '/organism/body', '/species/scale', '/council/status', '/autonomy', '/engines', '/organisms']) {
    assert.match(source, new RegExp(`router\\.get\\('${route.replace('/', '\\/')}', requireAuth, requireRole\\('viewer'\\), requireWorkspace`));
  }
});

test('phase 39: commands carry transaction identity and expected verification contract', () => {
  const source = read('src/services/commandPolicy.js');
  assert.match(source, /transactionId/);
  assert.match(source, /expectedEventTypes/);
  assert.match(source, /expectedResultState/);
  assert.match(source, /uncertain/);
});

test('phase 39: resource observations cannot manufacture current desired generation', () => {
  const source = read('src/services/resourceState.js');
  assert.match(source, /observedGeneration/);
  assert.doesNotMatch(source, /observedGeneration:\s*resource\.spec\.generation/);
});

test('phase 39: event ingress requires an authenticated, time-bounded event envelope', () => {
  const source = read('src/routes/internalEvents.js');
  assert.match(source, /event_id/);
  assert.match(source, /issued_at/);
  assert.match(source, /maxSkewMs/);
  assert.match(source, /Unexpected event type for command transaction/);
});

test('phase 39: production deployment supplies metrics credential and explicit proxy trust', () => {
  const source = read('render.yaml');
  assert.match(source, /key: METRICS_SCRAPE_TOKEN/);
  assert.match(source, /key: TRUST_PROXY/);
});

test('phase 39: BFF rejects conflicting workspace selectors', () => {
  const source = read('src/routes/bff.js');
  assert.match(source, /Conflicting workspace context supplied/);
  assert.match(source, /Sensitive read requires control\.read scope/);
});
