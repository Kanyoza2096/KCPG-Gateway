'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../contracts/control-plane-command-registry.v1.json');
const { COMMANDS } = require('../../src/contracts/commands');

function ids(values) { return values.map((value) => value.id).sort(); }

test('KCPG command implementation is an exact projection of the canonical registry', () => {
  assert.equal(registry.schema, 'KCPGControlPlaneCommandRegistry/v1');
  assert.deepEqual(ids(Object.values(COMMANDS)), ids(registry.commands));
  assert.equal(Object.keys(COMMANDS).length, registry.commands.length);
});

test('canonical registry contains the mounted Meta incident resolution command', () => {
  const command = COMMANDS['meta.incident.resolve'];
  assert.ok(command);
  assert.equal(command.pythonPath, '/api/v1/meta/resolve/{incident_id}');
  assert.equal(command.method, 'POST');
  assert.equal(command.workspaceRequired, true);
});

test('Director task outcome verification is a workspace-scoped governed command', () => {
  const command = COMMANDS['director.task.verify_outcome'];
  assert.ok(command);
  assert.equal(command.pythonPath, '/director/tasks/{task_id}/verify-outcome');
  assert.equal(command.method, 'POST');
  assert.deepEqual(command.bodyKeys, ['max_age_seconds']);
  assert.equal(command.workspaceRequired, true);
  assert.ok(command.scopes.includes('director.write'));
});
