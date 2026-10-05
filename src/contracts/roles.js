'use strict';

/** Canonical human RBAC hierarchy for the control plane.
 * Higher roles inherit all lower-role authority; role checks are minimum-tier checks.
 * `species` is a platform/system principal and is intentionally outside the human
 * workspace hierarchy. Owner is the highest workspace human role.
 */
const ROLE_RANK = Object.freeze({
  viewer: 10,
  operator: 20,
  admin: 30,
  owner: 40,
  species: 100,
});

function normalizeRole(role) {
  const value = String(role || 'viewer').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, value) ? value : 'viewer';
}

function roleAtLeast(userRole, minRole) {
  const user = normalizeRole(userRole);
  const minimum = normalizeRole(minRole);
  return ROLE_RANK[user] >= ROLE_RANK[minimum];
}

module.exports = { ROLE_RANK, normalizeRole, roleAtLeast };
