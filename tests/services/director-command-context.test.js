'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const pythonClient = require('../../src/services/pythonClient');
const commandTransactions = require('../../src/services/commandTransaction');
const authorityGuard = require('../../src/services/authorityGuard');
const { executeCommand } = require('../../src/services/commandPolicy');

it('signs the authenticated human workspace actor for Director command dispatch', async () => {
  const originals = {
    authorizeActuation: authorityGuard.authorizeActuation,
    find: commandTransactions.find,
    create: commandTransactions.create,
    transition: commandTransactions.transition,
    findByTransactionId: commandTransactions.findByTransactionId,
    callPython: pythonClient.callPython,
  };
  const tx = {
    transactionId: 'tx-director-context',
    phase: 'executing',
    verification: {},
    workspaceId: 'workspace-123',
  };
  let dispatched;
  try {
    authorityGuard.authorizeActuation = async () => ({
      allowed: true, autonomyLevel: 'L1', lease: null,
    });
    commandTransactions.find = async () => null;
    commandTransactions.create = async () => ({ created: true, transaction: tx });
    commandTransactions.transition = async (_current, phase, patch = {}) => {
      Object.assign(tx, patch, { phase });
      return tx;
    };
    commandTransactions.findByTransactionId = async () => tx;
    pythonClient.callPython = async (args) => {
      dispatched = args;
      return { status: 200, data: { accepted: true }, headers: {} };
    };

    const result = await executeCommand({
      commandId: 'director.mission.runtime.task.assign',
      body: {
        mission_id: 'mission-123',
        task_id: 'task-123',
        engine_id: 'content_intelligence',
        capability: 'research.analyze',
        idempotency_key: 'mission-assign-123',
        correlation_id: 'correlation-123',
      },
      user: {
        sub: 'human-operator-123',
        role: 'operator',
        scopes: ['control.write', 'director.write'],
        workspaceId: 'workspace-123',
        workspaceIds: ['workspace-123'],
        principalType: 'human',
      },
      requestId: 'request-123',
      idempotencyKey: 'command-idempotency-123',
    });

    assert.equal(result.ok, true);
    assert.equal(dispatched.method, 'POST');
    assert.equal(dispatched.path, '/director/missions/mission-123/orchestration/tasks/task-123/assign');
    assert.deepEqual(dispatched.gatewayContext, {
      actorId: 'human-operator-123',
      actorRole: 'operator',
      workspaceId: 'workspace-123',
      requestId: 'request-123',
    });
  } finally {
    authorityGuard.authorizeActuation = originals.authorizeActuation;
    commandTransactions.find = originals.find;
    commandTransactions.create = originals.create;
    commandTransactions.transition = originals.transition;
    commandTransactions.findByTransactionId = originals.findByTransactionId;
    pythonClient.callPython = originals.callPython;
  }
});
