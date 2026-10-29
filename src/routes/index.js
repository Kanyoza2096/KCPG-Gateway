'use strict';

const express = require('express');
const health = require('./health');
const auth = require('./auth');
const session = require('./session');
const controlPlane = require('./controlPlane');
const commands = require('./commands');
const proxy = require('./proxy');
const bff = require('./bff');
const internalEvents = require('./internalEvents');
const directorProxy = require('./directorProxy');
const authority = require('./authority');
const commandCenter = require('./commandCenter');
const runtimeDiagnostics = require('./runtimeDiagnostics');
const engineeringConsole = require('./engineeringConsole');

const router = express.Router();

router.use('/health', health);
router.use('/api/v1/auth', auth);
// FIXED: session routes now mount at /api/v1/auth (not /api/v1/auth/session)
router.use('/api/v1/auth', session);
router.use('/api/v1/control-plane', controlPlane);
router.use('/api/v1/control-plane/authority', authority);
router.use('/api/v1/command-center', commandCenter);
router.use('/api/v1/command-center', runtimeDiagnostics);
// Explicit, authenticated engineering-console BFF routes (no generic proxy).
router.use('/api/v1/engineering/console', engineeringConsole);
router.use('/api/v1/commands', commands);
router.use('/api/v1/internal/events', internalEvents);
router.use('/api/v1/proxy', proxy);
// Director Proxy — forwards /director/* to Python backend
router.use('/director', directorProxy);
// Canonical browser BFF: allowlisted CP endpoints, never an arbitrary proxy.
router.use('/api/v1', bff);

module.exports = router;
