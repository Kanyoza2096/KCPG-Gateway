'use strict';

const { EVENTS } = require('./events');
const { ROLE_RANK, roleAtLeast } = require('./roles');

const commandRegistry = require('../../contracts/control-plane-command-registry.v1.json');
const COMMANDS = Object.freeze(Object.fromEntries(commandRegistry.commands.map((command) => [command.id, Object.freeze(command)])));

function getCommand(id) { return COMMANDS[id] || null; }
function hasScopes(user, required = []) { const scopes = new Set(user?.scopes || []); return !required.length || scopes.has('*') || required.every((s) => scopes.has(s)); }
module.exports = { COMMANDS, ROLE_RANK, getCommand, roleAtLeast, hasScopes };
