'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENTS, EVENT_NAMESPACE, NAMESPACES, canonicalEventName } = require('../src/contracts/events');

test('operator task creation is a registered dashboard event', () => {
  const type = canonicalEventName('operator.task.created');
  assert.equal(type, EVENTS.OPERATOR_TASK_CREATED);
  assert.equal(EVENT_NAMESPACE[type], NAMESPACES.DASHBOARD);
  assert.ok(Object.values(EVENTS).includes(type));
});


test('reliability escalation is a registered system event', () => {
  const type = canonicalEventName('reliability.escalation');
  assert.equal(type, EVENTS.RELIABILITY_ESCALATION);
  assert.equal(EVENT_NAMESPACE[type], NAMESPACES.SYSTEM);
  assert.ok(Object.values(EVENTS).includes(type));
});
