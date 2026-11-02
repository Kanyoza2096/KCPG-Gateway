'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  EVENTS,
  NAMESPACES,
  EVENT_NAMESPACE,
  canonicalEventName,
} = require('../src/contracts/events');

describe('KDO Python event contract', () => {
  it('registers reliability.escalation as a system event', () => {
    const type = canonicalEventName('reliability.escalation');
    assert.equal(type, EVENTS.RELIABILITY_ESCALATION);
    assert.equal(EVENT_NAMESPACE[type], NAMESPACES.SYSTEM);
    assert.ok(Object.values(EVENTS).includes(type));
  });

  it('registers operator.task.created as a dashboard event', () => {
    const type = canonicalEventName('operator.task.created');
    assert.equal(type, EVENTS.OPERATOR_TASK_CREATED);
    assert.equal(EVENT_NAMESPACE[type], NAMESPACES.DASHBOARD);
    assert.ok(Object.values(EVENTS).includes(type));
  });
});
