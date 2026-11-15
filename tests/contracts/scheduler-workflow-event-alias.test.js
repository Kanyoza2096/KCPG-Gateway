'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EVENTS,
  EVENT_NAMESPACE,
  NAMESPACES,
  canonicalEventName,
} = require('../../src/contracts/events');

test('Python scheduler workflow events canonicalize to declared KCPG lifecycle events', () => {
  assert.equal(canonicalEventName('scheduler.workflow_started'), EVENTS.WORKFLOW_STARTED);
  assert.equal(canonicalEventName('scheduler.workflow_completed'), EVENTS.WORKFLOW_COMPLETED);
  assert.equal(canonicalEventName('scheduler.workflow_failed'), EVENTS.WORKFLOW_FAILED);
});

test('scheduler workflow lifecycle events retain the dashboard namespace', () => {
  for (const type of [
    'scheduler.workflow_started',
    'scheduler.workflow_completed',
    'scheduler.workflow_failed',
  ]) {
    const canonical = canonicalEventName(type);
    assert.equal(EVENT_NAMESPACE[canonical], NAMESPACES.DASHBOARD);
  }
});
