'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_RANK, normalizeRole, roleAtLeast } = require('../../src/contracts/roles');

describe('canonical RBAC hierarchy', () => {
  it('defines owner as the highest workspace human role', () => {
    assert.ok(ROLE_RANK.owner > ROLE_RANK.admin);
    assert.ok(ROLE_RANK.admin > ROLE_RANK.operator);
    assert.ok(ROLE_RANK.operator > ROLE_RANK.viewer);
  });

  it('owner inherits operator and admin authority', () => {
    assert.equal(roleAtLeast('owner', 'operator'), true);
    assert.equal(roleAtLeast('owner', 'admin'), true);
    assert.equal(roleAtLeast('owner', 'owner'), true);
  });

  it('lower roles cannot inherit owner authority', () => {
    assert.equal(roleAtLeast('operator', 'owner'), false);
    assert.equal(roleAtLeast('admin', 'owner'), false);
    assert.equal(roleAtLeast('viewer', 'operator'), false);
  });

  it('normalizes unknown roles safely without granting authority', () => {
    assert.equal(normalizeRole('OWNER'), 'owner');
    assert.equal(normalizeRole('unknown'), 'viewer');
    assert.equal(roleAtLeast('unknown', 'operator'), false);
  });
});
