'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { contract, SECTION_DEFINITIONS } = require('../src/contracts/commandCenterTruth');
const fs = require('fs');
const path = require('path');

test('V72.1 defines the ten canonical Command Center truth sections', () => {
  const c = contract();
  assert.deepEqual(Object.keys(c.sections), [
    'businessHealth','objectives','opportunities','risks','decisions','workforce','operations','outcomes','evidence','governance'
  ]);
  for (const section of Object.values(c.sections)) {
    assert.equal(section.actionAuthorityGranted, false);
    assert.equal(section.freshnessRequired, true);
    assert.equal(section.evidenceRequired, true);
    assert.equal(section.confidenceRequired, true);
  }
});

test('V72.1 contract keeps consequential execution outside the read model', () => {
  const c = contract();
  assert.deepEqual(c.consequentialCommandPath, [
    'KCPG_GATEWAY','GOVERNANCE','ACTION_KERNEL','DURABLE_OUTBOX','CONNECTOR_PROVIDER','RECONCILIATION'
  ]);
});

test('V72.1 exposes a gateway truth-contract route', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'commandCenter.js'), 'utf8');
  assert.match(file, /router\.get\('\/truth-contract'/);
  assert.match(file, /requireAuth/);
  assert.match(file, /requireRole\('viewer'\)/);
  assert.match(file, /requireWorkspace/);
  assert.match(file, /commandCenterTruthContract/);
});

test('V72.1 section source keys are explicit and non-empty', () => {
  for (const [key, def] of Object.entries(SECTION_DEFINITIONS)) {
    assert.ok(key);
    assert.ok(def.sourceKeys.length > 0);
  }
});
