const test = require('node:test');
const assert = require('node:assert/strict');

const { COMMANDS, getCommand } = require('../../src/contracts/commands');

test('affiliate side-effect commands are explicitly bound to Action Kernel contracts', () => {
  for (const [id, actionType] of Object.entries({
    'affiliate.publish_promotion': 'affiliate_publish_promotion',
    'affiliate.pause_product': 'affiliate_pause_product',
    'affiliate.optimize_campaign': 'affiliate_optimize_campaign',
  })) {
    const cmd = getCommand(id);
    assert.ok(cmd);
    assert.equal(cmd.actionType, actionType);
    assert.equal(cmd.verificationMode, 'action');
    assert.equal(cmd.pythonPath, undefined);
  }
});

test('legacy publish dry-run remains a non-side-effect diagnostic command', () => {
  const cmd = getCommand('publish.dry_run');
  assert.equal(cmd.actionType, undefined);
  assert.equal(cmd.bodyDefaults.dry_run, true);
});

test('command registry exposes no duplicate command ids', () => {
  const ids = Object.keys(COMMANDS);
  assert.equal(ids.length, new Set(ids).size);
});
