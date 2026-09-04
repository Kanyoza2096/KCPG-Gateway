'use strict';

const { EVENTS } = require('./events');

const COMMANDS = Object.freeze({
  'autonomy.pause': {
    id: 'autonomy.pause', description: 'Pause the workflow/autonomous scheduling path', risk: 'high',
    minRole: 'operator', scopes: ['control.write', 'autonomy.write'],
    pythonPath: '/api/v1/workflow/pause', method: 'POST', workspaceRequired: true,
    expectedEventTypes: [EVENTS.AUTONOMY_STATE_CHANGED], expectedResultState: 'paused', verificationMode: 'event',
  },
  'publish.dry_run': {
    id: 'publish.dry_run', description: 'Run an end-to-end publish probe without a live social post', risk: 'medium',
    minRole: 'operator', scopes: ['control.write', 'diagnostics.execute'],
    pythonPath: '/api/v1/e2e/publish', method: 'POST', bodyKeys: ['workspace_id', 'topic'], bodyDefaults: { dry_run: true },
    workspaceRequired: true, expectedEventTypes: [EVENTS.PUBLISH_COMPLETED, EVENTS.WORKFLOW_COMPLETED], verificationMode: 'event',
  },
  'director.hands': {
    id: 'director.hands', description: 'Inspect Director capability bindings', risk: 'low',
    minRole: 'owner', scopes: ['control.read', 'diagnostics.read'],
    pythonPath: '/api/v1/e2e/director-hands', method: 'GET', workspaceRequired: true,
    verificationMode: 'http_success',
  },
});

const ROLE_RANK = Object.freeze({ viewer: 1, operator: 2, owner: 3, admin: 4 });
function getCommand(id) { return COMMANDS[id] || null; }
function roleAtLeast(userRole, minRole) { return (ROLE_RANK[userRole] || 0) >= (ROLE_RANK[minRole] || 99); }
function hasScopes(user, required = []) { const scopes = new Set(user?.scopes || []); return !required.length || scopes.has('*') || required.every((s) => scopes.has(s)); }
module.exports = { COMMANDS, ROLE_RANK, getCommand, roleAtLeast, hasScopes };
