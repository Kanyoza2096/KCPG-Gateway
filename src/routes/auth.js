'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

/**
 * GET /api/v1/auth/me
 * Return the authenticated principal as seen by the gateway.
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    sub: req.user.sub,
    email: req.user.email,
    role: req.user.role,
    workspaceId: req.user.workspaceId,
    authDisabled: config.auth.disabled,
  });
});

module.exports = router;
