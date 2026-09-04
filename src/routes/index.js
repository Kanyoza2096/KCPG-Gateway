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

const router = express.Router();

router.use('/health', health);
router.use('/api/v1/auth', auth);
router.use('/api/v1/auth/session', session);
router.use('/api/v1/control-plane', controlPlane);
router.use('/api/v1/commands', commands);
router.use('/api/v1/internal/events', internalEvents);
router.use('/api/v1/proxy', proxy);
// Canonical browser BFF: allowlisted CP endpoints, never an arbitrary proxy.
router.use('/api/v1', bff);

module.exports = router;
