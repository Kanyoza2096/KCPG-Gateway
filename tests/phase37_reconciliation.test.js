'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/services/resourceState');

test('canonical resource starts unknown and untrusted', async () => {
  const r = await state.get('ws-test', 'Engine', 'director');
  assert.equal(r.spec.generation, 0);
  assert.equal(r.status.observedState, 'unknown');
  assert.equal(state.reconcile(r).decision, 'UNKNOWN');
});

test('desired state increments generation and produces reconcile decision', async () => {
  const r = await state.setDesired({ workspaceId: 'ws-r', kind: 'Engine', id: 'condition', desiredState: 'running' });
  assert.equal(r.spec.generation, 1);
  assert.equal(state.reconcile(r).decision, 'UNKNOWN');
});

test('fresh observed state matching desired state is a NOOP', async () => {
  await state.setDesired({ workspaceId: 'ws-noop', kind: 'Engine', id: 'director', desiredState: 'running' });
  const r = await state.updateObserved({
    workspaceId: 'ws-noop', kind: 'Engine', id: 'director',
    observedState: 'running', observedGeneration: 1, health: 'healthy', source: 'test-controller',
  });
  assert.equal(state.reconcile(r).decision, 'NOOP');
});

test('unhealthy observed state is degraded even when desired differs', async () => {
  await state.setDesired({ workspaceId: 'ws-bad', kind: 'Engine', id: 'trend', desiredState: 'running' });
  const r = await state.updateObserved({
    workspaceId: 'ws-bad', kind: 'Engine', id: 'trend',
    observedState: 'failed', observedGeneration: 1, health: 'unhealthy', source: 'test-controller',
  });
  assert.equal(state.reconcile(r).decision, 'DEGRADED');
});
