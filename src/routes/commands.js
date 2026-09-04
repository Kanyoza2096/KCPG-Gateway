'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { commandRateLimit } = require('../middleware/rateLimit');
const { executeCommand } = require('../services/commandPolicy');
const { COMMANDS } = require('../contracts/commands');
const { BadRequestError } = require('../utils/errors');
const commandTransactions = require('../services/commandTransaction');

const router = express.Router();

/** List allowlisted commands (for Control Plane UI) */
router.get('/', requireAuth, (_req, res) => {
  const list = Object.values(COMMANDS).map((c) => ({
    id: c.id,
    description: c.description,
    minRole: c.minRole,
  }));
  res.json({ commands: list });
});


/**
 * Read a durable transaction by workspace + transaction identity. This is the
 * recovery path for clients that received 202/uncertain and later reconnect.
 */
router.get('/:id/transactions/:transactionId', requireAuth, async (req, res, next) => {
  try {
    const commandId = req.params.id;
    const workspaceId = String(req.query.workspace_id || req.headers['x-workspace-id'] || req.user?.workspaceId || '');
    if (!workspaceId) throw new BadRequestError('Workspace context required');
    const allowed = new Set((req.user?.workspaceIds || []).map(String));
    if (req.user?.workspaceId) allowed.add(String(req.user.workspaceId));
    if (!allowed.has(workspaceId) && !req.user?.scopes?.includes('*') && !req.user?.scopes?.includes('workspace:*')) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Workspace access denied' } });
    const tx = await commandTransactions.findByTransactionId({ workspaceId, transactionId: req.params.transactionId });
    if (!tx || tx.commandId !== commandId || (tx.actorId !== req.user?.sub && !req.user?.scopes?.includes('control.audit'))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, transaction: tx });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/commands/:id
 */
router.post('/:id', requireAuth, commandRateLimit, async (req, res, next) => {
  try {
    const commandId = req.params.id;
    if (!commandId || typeof commandId !== 'string') {
      throw new BadRequestError('Command id required');
    }

    const idempotencyKey = req.get('Idempotency-Key') || `${commandId}:${req.requestId}`;

    const result = await executeCommand({
      commandId,
      body: req.body || {},
      user: req.user,
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      idempotencyKey,
    });

    res.setHeader('X-Command-Id', commandId);
    res.setHeader('X-Request-Id', req.requestId);
    if (req.trace?.traceparent) res.setHeader('traceparent', req.trace.traceparent);
    res.status(result.ok ? 200 : result.status || 502).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
