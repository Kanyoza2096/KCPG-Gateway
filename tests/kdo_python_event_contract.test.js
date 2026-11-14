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

  it('registers platform.state.updated as a system event', () => {
    const type = canonicalEventName('platform.state.updated');
    assert.equal(type, EVENTS.PLATFORM_STATE_UPDATED);
    assert.equal(EVENT_NAMESPACE[type], NAMESPACES.SYSTEM);
    assert.ok(Object.values(EVENTS).includes(type));
  });

  it('registers GrowthBridge website integration events as dashboard events', () => {
    const websiteEventTypes = [
      'article.created',
      'article.updated',
      'article.published',
      'article.deleted',
      'contact.submitted',
      'comment.created',
      'project.created',
      'project.updated',
      'project.deleted',
      'service.created',
      'service.updated',
      'blog.created',
      'blog.published',
      'application.created',
      'application.updated',
      'partnership.requested',
      'talent.profile.created',
      'testimonial.created',
      'settings.updated',
    ];

    for (const eventType of websiteEventTypes) {
      const type = canonicalEventName(`website.integration.${eventType}`);
      assert.ok(Object.values(EVENTS).includes(type), `missing event: ${type}`);
      assert.equal(EVENT_NAMESPACE[type], NAMESPACES.DASHBOARD, `missing dashboard route: ${type}`);
    }
  });

  it('accepts the exact GrowthBridge blog.created ingress event', () => {
    const type = canonicalEventName('website.integration.blog.created');
    assert.equal(type, EVENTS.WEBSITE_INTEGRATION_BLOG_CREATED);
    assert.equal(EVENT_NAMESPACE[type], NAMESPACES.DASHBOARD);
  });
});
