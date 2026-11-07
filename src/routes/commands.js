'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { commandRateLimit } = require('../middleware/rateLimit');
const { executeCommand } = require('../services/commandPolicy');
const { COMMANDS } = require('../contracts/commands');
const { BadRequestError } = require('../utils/errors');
const commandTransactions = require('../services/commandTransaction');

const router = express.Router();

/** Recent governed command transactions for the operator dashboard. */
router.get('/transactions/recent', requireAuth, async (req, res, next) => {
  try {
    const workspaceId = String(req.query.workspace_id || req.headers['x-workspace-id'] || req.user?.workspaceId || '');
    if (!workspaceId) throw new BadRequestError('Workspace context required');
    const allowed = new Set((req.user?.workspaceIds || []).map(String));
    if (req.user?.workspaceId) allowed.add(String(req.user.workspaceId));
    if (!allowed.has(workspaceId) && !(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin')) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Workspace access denied' } });
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const rows = await commandTransactions.listRecent({ workspaceId, limit });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, workspaceId, transactions: rows });
  } catch (err) { next(err); }
});


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
    if (!allowed.has(workspaceId) && !(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin')) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Workspace access denied' } });
    const tx = await commandTransactions.findByTransactionId({ workspaceId, transactionId: req.params.transactionId });
    if (!tx || tx.commandId !== commandId || (tx.actorId !== req.user?.sub && !req.user?.scopes?.includes('control.audit') && !(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin'))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, transaction: tx });
  } catch (err) { next(err); }
});

/**
 * Read authoritative Action Kernel evidence bound to a KCPG transaction.
 * This endpoint is observational only and never mutates execution state.
 */
router.get('/:id/transactions/:transactionId/evidence', requireAuth, async (req, res, next) => {
  try {
    const commandId = req.params.id;
    const workspaceId = String(req.query.workspace_id || req.headers['x-workspace-id'] || req.user?.workspaceId || '');
    if (!workspaceId) throw new BadRequestError('Workspace context required');
    const allowed = new Set((req.user?.workspaceIds || []).map(String));
    if (req.user?.workspaceId) allowed.add(String(req.user.workspaceId));
    if (!allowed.has(workspaceId) && !(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin')) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Workspace access denied' } });
    }
    const tx = await commandTransactions.findByTransactionId({ workspaceId, transactionId: req.params.transactionId });
    if (!tx || tx.commandId !== commandId || (tx.actorId !== req.user?.sub && !req.user?.scopes?.includes('control.audit') && !(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin'))) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } });
    }
    const intentId = tx.verification?.actionIntentId;
    if (!intentId) {
      return res.json({ ok: true, transaction: tx, evidence: null, evidenceState: 'not_action_kernel' });
    }
    const result = await require('../../src/services/pythonClient').callPython({
      method: 'GET', path: `/api/v1/control-plane/action-intents/${encodeURIComponent(intentId)}/evidence`,
      query: { limit: Math.min(Math.max(Number(req.query.limit || 20), 1), 100), workspace_id: workspaceId },
      requestId: req.requestId, traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: workspaceId }, commandId: tx.transactionId,
    });
    if (result.status < 200 || result.status >= 300) return res.status(result.status || 502).json(result.data || { ok: false });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, transaction: tx, evidence: result.data, evidenceState: 'authoritative' });
  } catch (err) { next(err); }
});

/** Approve a governed Action Kernel intent represented by a KCPG transaction. */
router.post('/:id/transactions/:transactionId/approve', requireAuth, commandRateLimit, async (req, res, next) => {
  try {
    const commandId = req.params.id;
    const workspaceId = String(req.body?.workspace_id || req.query.workspace_id || req.headers['x-workspace-id'] || req.user?.workspaceId || '');
    if (!workspaceId) throw new BadRequestError('Workspace context required');
    const allowed = new Set((req.user?.workspaceIds || []).map(String));
    if (req.user?.workspaceId) allowed.add(String(req.user.workspaceId));
    if (!allowed.has(workspaceId) && !(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin')) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Workspace access denied' } });
    if (!(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin') && !req.user?.scopes?.includes('control.write')) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Approval requires control.write scope' } });
    if (!(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin') && !['owner', 'admin'].includes(req.user?.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner authorization required for governed approval' } });
    const tx = await commandTransactions.findByTransactionId({ workspaceId, transactionId: req.params.transactionId });
    if (!tx || tx.commandId !== commandId || (tx.actorId !== req.user?.sub && !(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin'))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } });
    const intentId = tx.verification?.actionIntentId;
    if (!intentId) return res.status(409).json({ error: { code: 'ACTION_INTENT_NOT_BOUND', message: 'Transaction has no Action Kernel intent' } });
    const result = await require('../../src/services/pythonClient').callPython({
      method: 'POST', path: `/api/v1/control-plane/action-intents/${encodeURIComponent(intentId)}/approve`,
      query: { workspace_id: workspaceId }, body: { workspace_id: workspaceId }, requestId: req.requestId,
      traceparent: req.trace?.traceparent, user: { ...req.user, __requestWorkspaceId: workspaceId }, commandId: tx.transactionId,
    });
    if (result.status < 200 || result.status >= 300) return res.status(result.status || 502).json(result.data || { ok: false });
    const updated = await commandTransactions.transition(tx, 'verifying', { verification: { ...(tx.verification || {}), actionStatus: 'pending', outcome: 'approved', approvedAt: new Date().toISOString() } });
    return res.status(202).json({ ok: true, command: commandId, transaction: updated, action: result.data });
  } catch (err) { next(err); }
});

/**
 * Request cancellation. Cancellation is authoritative only before external dispatch;
 * once executing, the transaction is marked cancelRequested and remains subject to reconciliation.
 */
router.post('/:id/transactions/:transactionId/cancel', requireAuth, async (req, res, next) => {
  try {
    const workspaceId = String(req.body?.workspace_id || req.query.workspace_id || req.headers['x-workspace-id'] || req.user?.workspaceId || '');
    if (!workspaceId) throw new BadRequestError('Workspace context required');
    const allowed = new Set((req.user?.workspaceIds || []).map(String));
    if (req.user?.workspaceId) allowed.add(String(req.user.workspaceId));
    if (!allowed.has(workspaceId) && !(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin')) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Workspace access denied' } });
    const tx = await commandTransactions.findByTransactionId({ workspaceId, transactionId: req.params.transactionId });
    if (!tx || tx.commandId !== req.params.id || (tx.actorId !== req.user?.sub && !(req.user?.principalType === 'human' && req.user?.platformRole === 'super_admin'))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } });
    const updated = await commandTransactions.requestCancellation(tx, req.user.sub);
    res.setHeader('Cache-Control', 'no-store');
    const active = ['executing', 'verifying', 'uncertain'].includes(updated?.phase);
    res.status(active ? 202 : 200).json({ ok: true, cancellationRequested: true, activeExecution: active, transaction: updated });
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
