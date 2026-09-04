'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getCommand, roleAtLeast, COMMANDS } = require('../../src/contracts/commands');

describe('command contracts', () => {
  it('maps autonomy.pause to workflow/pause', () => {
    const c = getCommand('autonomy.pause');
    assert.ok(c);
    assert.equal(c.pythonPath, '/api/v1/workflow/pause');
  });

  it('maps publish.dry_run to e2e/publish with dry_run default', () => {
    const c = getCommand('publish.dry_run');
    assert.ok(c);
    assert.equal(c.pythonPath, '/api/v1/e2e/publish');
    assert.equal(c.bodyDefaults.dry_run, true);
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
  });

  it('legacy service.restart alias is intentionally not exposed', () => {
    assert.equal(COMMANDS['service.restart'], undefined);
  });
});
