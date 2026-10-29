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

  it('registers all governed Director mutation commands', () => {
    const expected = {
      'director.observe': '/director/observe',
      'director.plan': '/director/plan',
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
});
