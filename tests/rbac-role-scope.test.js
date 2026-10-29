'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_RANK, ROLE_SCOPES, scopesForRole, normalizeRole, roleAtLeast } = require('../src/contracts/roles');

test('owner is the highest human role and receives super-user scope', () => {
  assert.equal(ROLE_RANK.owner, 40);
  assert.equal(roleAtLeast('owner', 'admin'), true);
  assert.deepEqual(scopesForRole('owner'), ['*']);
});

test('role scopes are deterministic policy projections', () => {
  assert.equal(scopesForRole('operator').includes('control.write'), true);
  assert.equal(scopesForRole('viewer').includes('control.write'), false);
  assert.equal(scopesForRole('admin').includes('workspace.write'), true);
  assert.equal(scopesForRole('admin').includes('*'), false);
});

test('unknown roles fail closed to viewer policy', () => {
  assert.equal(normalizeRole('root'), 'viewer');
  assert.equal(scopesForRole('root').includes('*'), false);
});

test('species remains a machine/platform principal, not a human role', () => {
  assert.equal(ROLE_RANK.species > ROLE_RANK.owner, true);
  assert.deepEqual(ROLE_SCOPES.species, ['*']);
});
