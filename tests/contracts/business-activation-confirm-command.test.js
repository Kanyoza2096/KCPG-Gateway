'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCommand } = require('../../src/contracts/commands');

test('Business Activation fact confirmation is a governed, workspace-scoped knowledge write', () => {
  const command = getCommand('business_activation.facts.confirm');
  assert.ok(command, 'fact confirmation command must be registered');
  assert.equal(command.pythonPath, '/api/v1/business-activation/confirm');
  assert.equal(command.method, 'POST');
  assert.deepEqual(command.bodyKeys, ['workspace_id', 'extraction_id', 'proposed_fact_ids']);
  assert.equal(command.minRole, 'operator');
  assert.deepEqual(command.scopes, ['control.write', 'knowledge.write']);
  assert.equal(command.workspaceRequired, true);
  assert.equal(command.verificationMode, 'http_success');
});

test('runtime activation remains distinct and unavailable', () => {
  assert.equal(getCommand('workspace.activate'), null);
});
