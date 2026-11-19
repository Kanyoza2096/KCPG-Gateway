'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getCommand, roleAtLeast, COMMANDS } = require('../../src/contracts/commands');

describe('command contracts', () => {
  it('does not expose the unsafe global autonomy.pause command', () => {
    assert.equal(getCommand('autonomy.pause'), null);
  });

  it('registers workspace-scoped pending workflow job cancellation', () => {
    const c = getCommand('workflow.job.cancel');
    assert.ok(c);
    assert.equal(c.pythonPath, '/api/v1/workflow/jobs/{job_id}/cancel');
    assert.equal(c.method, 'POST');
    assert.deepEqual(c.bodyKeys, ['job_id']);
    assert.equal(c.workspaceRequired, true);
    assert.equal(c.minRole, 'operator');
    assert.deepEqual(c.scopes, ['control.write', 'posts.write']);
  });

  it('maps publish.dry_run to e2e/publish with dry_run default', () => {
    const c = getCommand('publish.dry_run');
    assert.ok(c);
    assert.equal(c.pythonPath, '/api/v1/e2e/publish');
    assert.equal(c.bodyDefaults.dry_run, true);
  });

  it('registers all governed Director mutation commands', () => {
    const expected = {
      'director.observe': '/director/observe',
      'director.plan': '/director/plan',
      'director.strategic_plan.create': '/director/strategic-plans',
      'director.start': '/director/start',
      'director.stop': '/director/stop',
      'director.capability.toggle': '/director/capabilities/{capability}/toggle',
      'director.learning.reset': '/director/learning/reset/{capability}',
    };
    for (const [id, path] of Object.entries(expected)) {
      const c = getCommand(id);
      assert.ok(c, id);
      assert.equal(c.pythonPath, path);
      assert.equal(c.method, 'POST');
      assert.equal(c.workspaceRequired, true);
      assert.ok(['medium', 'high'].includes(c.risk));
      assert.deepEqual(c.scopes, ['control.write', 'director.write']);
    }
    assert.deepEqual(getCommand('director.capability.toggle').bodyKeys, ['capability']);
    assert.deepEqual(getCommand('director.learning.reset').bodyKeys, ['capability']);
    assert.deepEqual(getCommand('director.strategic_plan.create').bodyKeys, ['objective_id', 'title', 'description', 'success_criteria', 'constraints']);
  });

  it('registers read-only Director engineering awareness', () => {
    const c = getCommand('director.engineering_awareness.read');
    assert.ok(c);
    assert.equal(c.pythonPath, '/director/engineering-awareness');
    assert.equal(c.method, 'GET');
    assert.equal(c.workspaceRequired, false);
    assert.equal(c.minRole, 'owner');
    assert.equal(c.risk, 'low');
    assert.deepEqual(c.scopes, ['control.read', 'director.read']);
  });

  it('has director.hands diagnostic', () => {
    const c = getCommand('director.hands');
    assert.equal(c.method, 'GET');
    assert.equal(c.pythonPath, '/api/v1/e2e/director-hands');
  });

  it('role ranking works', () => {
    assert.equal(roleAtLeast('owner', 'operator'), true);
    assert.equal(roleAtLeast('viewer', 'operator'), false);
    assert.equal(roleAtLeast('operator', 'operator'), true);
    assert.equal(roleAtLeast('owner', 'admin'), true);
    assert.equal(roleAtLeast('admin', 'owner'), false);
  });

  it('legacy service.restart alias is intentionally not exposed', () => {
    assert.equal(COMMANDS['service.restart'], undefined);
  });

  it('registers workspace-scoped Director strategic mission staging', () => {
    const c = getCommand('director.mission.stage');
    assert.ok(c);
    assert.equal(c.pythonPath, '/director/strategic-plans/{plan_id}/stage');
    assert.equal(c.method, 'POST');
    assert.deepEqual(c.bodyKeys, ['plan_id', 'idempotency_key', 'step_parameters']);
    assert.equal(c.workspaceRequired, true);
    assert.equal(c.minRole, 'operator');
    assert.equal(c.risk, 'medium');
    assert.deepEqual(c.scopes, ['control.write', 'director.write']);
  });

  it('registers native Director mission approval and rejection behind KCPG governance', () => {
    const approve = getCommand('director.mission.runtime.task.approve');
    assert.ok(approve);
    assert.equal(approve.pythonPath, '/director/tasks/{task_id}/approve');
    assert.equal(approve.method, 'POST');
    assert.equal(approve.minRole, 'operator');
    assert.equal(approve.risk, 'medium');
    assert.equal(approve.workspaceRequired, true);
    assert.deepEqual(approve.scopes, ['control.write', 'director.write']);
    assert.deepEqual(approve.bodyKeys, ['task_id']);

    const reject = getCommand('director.mission.runtime.task.reject');
    assert.ok(reject);
    assert.equal(reject.pythonPath, '/director/tasks/{task_id}/reject');
    assert.equal(reject.method, 'POST');
    assert.equal(reject.minRole, 'operator');
    assert.equal(reject.risk, 'medium');
    assert.equal(reject.workspaceRequired, true);
    assert.deepEqual(reject.scopes, ['control.write', 'director.write']);
    assert.deepEqual(reject.bodyKeys, ['task_id', 'reason']);
  });

  it('registers native Director mission assignment and execution behind KCPG governance', () => {
    const assign = getCommand('director.mission.runtime.task.assign');
    assert.ok(assign);
    assert.equal(assign.pythonPath, '/director/missions/{mission_id}/orchestration/tasks/{task_id}/assign');
    assert.equal(assign.method, 'POST');
    assert.equal(assign.minRole, 'operator');
    assert.equal(assign.risk, 'medium');
    assert.equal(assign.workspaceRequired, true);
    assert.deepEqual(assign.scopes, ['control.write', 'director.write']);
    assert.deepEqual(assign.bodyKeys, [
      'mission_id', 'task_id', 'engine_id', 'capability', 'idempotency_key', 'correlation_id',
    ]);

    const execute = getCommand('director.mission.runtime.task.execute');
    assert.ok(execute);
    assert.equal(execute.pythonPath, '/director/missions/{mission_id}/orchestration/tasks/{task_id}/execute');
    assert.equal(execute.method, 'POST');
    assert.equal(execute.minRole, 'operator');
    assert.equal(execute.risk, 'high');
    assert.equal(execute.workspaceRequired, true);
    assert.deepEqual(execute.scopes, ['control.write', 'director.write']);
    assert.deepEqual(execute.bodyKeys, [
      'mission_id', 'task_id', 'engine_id', 'objective', 'inputs',
      'idempotency_prefix', 'correlation_id', 'estimated_tokens', 'timeout_seconds',
    ]);
  });

  it('registers bounded Director engine message and response commands', () => {
    const message = getCommand('director.mission.runtime.engine.message');
    assert.ok(message);
    assert.equal(message.pythonPath, '/director/missions/{mission_id}/orchestration/messages');
    assert.equal(message.method, 'POST');
    assert.equal(message.minRole, 'operator');
    assert.equal(message.risk, 'medium');
    assert.equal(message.workspaceRequired, true);
    assert.deepEqual(message.scopes, ['control.write', 'director.write']);
    assert.ok(message.bodyKeys.includes('recipient_capability'));
    assert.ok(message.bodyKeys.includes('round_number'));

    const answer = getCommand('director.mission.runtime.engine.message.answer');
    assert.ok(answer);
    assert.equal(answer.pythonPath, '/director/missions/{mission_id}/orchestration/messages/{message_id}/answer');
    assert.equal(answer.method, 'POST');
    assert.equal(answer.minRole, 'operator');
    assert.equal(answer.risk, 'medium');
    assert.equal(answer.workspaceRequired, true);
    assert.deepEqual(answer.scopes, ['control.write', 'director.write']);
  });

});
