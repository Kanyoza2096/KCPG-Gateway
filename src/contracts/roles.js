'use strict';

/**
 * Canonical human RBAC. The user's role is resolved from the authoritative
 * workspace membership returned by KDO identity exchange; it is never chosen
 * by environment variables. Scopes are a deterministic projection of role.
 * OWNER is the highest human workspace role. Platform authority is a separate signed grant.
 */
const ROLE_RANK = Object.freeze({ viewer: 10, operator: 20, admin: 30, owner: 40, species: 100 });

const ROLE_SCOPES = Object.freeze({
  viewer: Object.freeze(['control.read', 'diagnostics.read', 'engine.read', 'workflow.read', 'security.read', 'council.read']),
  operator: Object.freeze(['control.read', 'control.write', 'director.write', 'ai.write', 'autonomy.write', 'brand.write', 'content.write', 'council.read', 'council.vote', 'diagnostics.read', 'diagnostics.execute', 'engine.read', 'engine.control', 'guardian.write', 'knowledge.write', 'posts.write', 'security.read', 'security.respond', 'social.write', 'workflow.read', 'workflow.execute']),
  admin: Object.freeze(['control.read', 'control.write', 'director.write', 'ai.write', 'autonomy.write', 'brand.write', 'content.write', 'council.read', 'council.vote', 'diagnostics.read', 'diagnostics.execute', 'engine.read', 'engine.control', 'guardian.write', 'knowledge.write', 'posts.write', 'security.read', 'security.respond', 'security.write', 'social.write', 'workspace.write', 'workflow.read', 'workflow.execute']),
  owner: Object.freeze(['*']),
  species: Object.freeze(['*']),
});

function normalizeRole(role) {
  const value = String(role || 'viewer').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, value) ? value : 'viewer';
}
function roleAtLeast(userRole, minRole) {
  const user = normalizeRole(userRole);
  const minimum = normalizeRole(minRole);
  // Machine/species identities are not human workspace owners or admins.
  if (user === 'species' || minimum === 'species') return user === minimum;
  return ROLE_RANK[user] >= ROLE_RANK[minimum];
}
function scopesForRole(role) {
  return [...(ROLE_SCOPES[normalizeRole(role)] || ROLE_SCOPES.viewer)];
}
function hasScope(user, scope) {
  const scopes = new Set(user?.scopes || []);
  return scopes.has('*') || scopes.has(scope);
}

module.exports = { ROLE_RANK, ROLE_SCOPES, normalizeRole, roleAtLeast, scopesForRole, hasScope };
