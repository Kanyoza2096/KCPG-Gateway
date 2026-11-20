'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const transactions = require('../../src/services/commandTransaction');

async function failedTransaction({ retryable, outcome }) {
  const suffix = randomUUID();
  const created = await transactions.create({
    commandId: 'test.retry.boundary',
    actorId: 'test-operator',
    workspaceId: 'test-workspace',
    intent: 'Exercise safe retry boundary',
    risk: 'low',
    requestId: suffix,
    idempotencyKey: suffix,
  });
  return transactions.transition(created.transaction, 'failed', {
    retryable,
    failure: { code: 'TEST_UPSTREAM_FAILURE' },
    verification: { outcome, verifiedAt: new Date().toISOString(), evidence: ['test evidence'] },
  });
}

describe('command transaction retry claims', () => {
  it('allows exactly one claimant to retry an explicitly confirmed no-effect failure', async () => {
    const failed = await failedTransaction({ retryable: true, outcome: 'confirmed_no_side_effects' });
    const [first, second] = await Promise.all([
      transactions.claimRetry(failed, 'retry-claim-a'),
      transactions.claimRetry(failed, 'retry-claim-b'),
    ]);
    assert.equal(Number(first.claimed) + Number(second.claimed), 1);
    const winner = first.claimed ? first.transaction : second.transaction;
    assert.equal(winner.phase, 'queued');
    assert.equal(winner.attempt, 2);
    assert.ok(winner.retryClaimId === 'retry-claim-a' || winner.retryClaimId === 'retry-claim-b');
    assert.equal(winner.attemptHistory.length, 2);
  });

  it('refuses retry when upstream did not explicitly confirm no side effects', async () => {
    const failed = await failedTransaction({ retryable: true, outcome: 'unknown' });
    const result = await transactions.claimRetry(failed, 'must-not-claim');
    assert.equal(result.claimed, false);
    assert.equal(result.transaction.phase, 'failed');
  });

  it('refuses retry when no-effect evidence exists but upstream marked it non-retryable', async () => {
    const failed = await failedTransaction({ retryable: false, outcome: 'confirmed_no_side_effects' });
    const result = await transactions.claimRetry(failed, 'must-not-claim');
    assert.equal(result.claimed, false);
    assert.equal(result.transaction.phase, 'failed');
  });
});
