'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCommand } = require('../../src/contracts/commands');

test('unimplemented workspace activation is not advertised as a governed command', () => {
  assert.equal(getCommand('workspace.activate'), null);
});

test('business provisioning remains distinct from runtime activation', () => {
  const command = getCommand('onboarding.provision');
  assert.ok(command, 'onboarding.provision remains registered');
  assert.equal(command.pythonPath, '/api/v1/onboarding/provision');
  assert.deepEqual(command.bodyKeys, ['plan']);
  assert.notEqual(command.id, 'workspace.activate');
});
