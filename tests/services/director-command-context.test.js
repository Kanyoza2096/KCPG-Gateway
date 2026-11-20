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


it('routes mission task approval and rejection through signed durable Director commands', async () => {
  const originals = {
    authorizeActuation: authorityGuard.authorizeActuation,
    find: commandTransactions.find,
    create: commandTransactions.create,
    transition: commandTransactions.transition,
    findByTransactionId: commandTransactions.findByTransactionId,
    callPython: pythonClient.callPython,
  };
  const tx = { transactionId: 'tx-director-task-decision', phase: 'executing', verification: {}, workspaceId: 'workspace-123' };
  const dispatched = [];
  try {
    authorityGuard.authorizeActuation = async () => ({ allowed: true, autonomyLevel: 'L1', lease: null });
    commandTransactions.find = async () => null;
    commandTransactions.create = async () => ({ created: true, transaction: { ...tx } });
    commandTransactions.transition = async (current, phase, patch = {}) => ({ ...current, ...patch, phase });
    commandTransactions.findByTransactionId = async () => null;
    pythonClient.callPython = async (args) => {
      dispatched.push(args);
      return { status: 200, data: { status: 'approved' }, headers: {} };
    };

    const user = {
      sub: 'human-operator-123', role: 'operator',
      scopes: ['control.write', 'director.write'],
      workspaceId: 'workspace-123', workspaceIds: ['workspace-123'],
      principalType: 'human',
    };
    for (const [commandId, body, expectedPath] of [
      ['director.task.approve', { task_id: 'task-123' }, '/director/tasks/task-123/approve'],
      ['director.task.reject', { task_id: 'task-456', reason: 'Evidence insufficient' }, '/director/tasks/task-456/reject'],
      ['director.mission.runtime.task.execute', {
        mission_id: 'mission-123', task_id: 'task-789', engine_id: 'content_intelligence',
        objective: 'Execute approved research', inputs: { topic: 'evidence' },
        idempotency_prefix: 'execution-123', correlation_id: 'correlation-123',
        estimated_tokens: 1800, timeout_seconds: 75, actor_id: 'spoofed-body-actor',
      }, '/director/missions/mission-123/orchestration/tasks/task-789/execute'],
      ['director.mission.runtime.task.recovery.review', {
        mission_id: 'mission-123', task_id: 'task-456', decision: 'hold',
        reason: 'Outcome remains unknown', idempotency_key: 'recovery-review-123',
        correlation_id: 'correlation-review-123', actor_id: 'spoofed-body-actor',
      }, '/director/missions/mission-123/orchestration/tasks/task-456/recovery-review'],
      ['director.mission.runtime.task.reconcile', {
        mission_id: 'mission-123', task_id: 'task-456',
        correlation_id: 'reconciliation-123', actor_id: 'spoofed-body-actor',
      }, '/director/missions/mission-123/orchestration/tasks/task-456/reconcile'],
    ]) {
      const result = await executeCommand({
        commandId, body, user, requestId: 'request-task-decision',
        idempotencyKey: 'idempotency-' + commandId,
      });
      assert.equal(result.ok, true);
      const call = dispatched.at(-1);
      assert.equal(call.method, 'POST');
      assert.equal(call.path, expectedPath);
      assert.equal(Object.prototype.hasOwnProperty.call(call.body || {}, 'actor_id'), false);
      assert.deepEqual(call.gatewayContext, {
        actorId: 'human-operator-123',
        actorRole: 'operator',
        workspaceId: 'workspace-123',
        requestId: 'request-task-decision',
      });
    }
  } finally {
    authorityGuard.authorizeActuation = originals.authorizeActuation;
    commandTransactions.find = originals.find;
    commandTransactions.create = originals.create;
    commandTransactions.transition = originals.transition;
    commandTransactions.findByTransactionId = originals.findByTransactionId;
    pythonClient.callPython = originals.callPython;
  }
});
