'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isConfirmedNoSideEffects } = require('../../src/services/commandPolicy');

describe('retry-safe upstream failure reconciliation', () => {
  it('recognizes an explicit retryable 503 with no side effects', () => {
    const err = {
      status: 502,
      details: {
        status: 503,
        data: {
          detail: {
            code: 'STRATEGIC_PLANNER_UNAVAILABLE',
            message: 'provider quota exhausted',
            retryable: true,
            side_effects: false,
          },
        },
      },
    };
    assert.equal(isConfirmedNoSideEffects(err), true);
  });

  it('does not classify a generic upstream 503 as safe to retry', () => {
    assert.equal(isConfirmedNoSideEffects({
      status: 502,
      details: { status: 503, data: { detail: 'service unavailable' } },
    }), false);
  });

  it('does not classify a response with possible side effects as safe to retry', () => {
    assert.equal(isConfirmedNoSideEffects({
      status: 502,
      details: {
        status: 503,
        data: { detail: { retryable: true, side_effects: true } },
      },
    }), false);
  });
});
