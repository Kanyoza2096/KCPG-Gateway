'use strict';

const { getCommand, roleAtLeast, hasScopes } = require('../contracts/commands');
const { ForbiddenError, NotFoundError, BadRequestError } = require('../utils/errors');
const pythonClient = require('./pythonClient');
const logger = require('../utils/logger');
const commandTransactions = require('./commandTransaction');

async function executeCommand({ commandId, body = {}, user, requestId, traceparent, idempotencyKey }) {
  const cmd = getCommand(commandId);
  if (!cmd) throw new NotFoundError(`Unknown command: ${commandId}`);
  if (!user) throw new ForbiddenError('Authentication required');
  if (!user.sub) throw new ForbiddenError('Authenticated principal is missing subject');
  if (!roleAtLeast(user.role, cmd.minRole)) throw new ForbiddenError(`Command requires role: ${cmd.minRole}`);
  if (!hasScopes(user, cmd.scopes)) throw new ForbiddenError('Command scope denied');

  const supplied = pickBody(body, cmd.bodyKeys);
  const requestedWorkspace = supplied.workspace_id != null ? String(supplied.workspace_id) : '';
  const allowedWorkspaces = new Set((user.workspaceIds || []).map(String));
  if (user.workspaceId) allowedWorkspaces.add(String(user.workspaceId));
  if (cmd.workspaceRequired && !requestedWorkspace && !user.workspaceId) throw new ForbiddenError('Workspace context required');
  if (requestedWorkspace && !allowedWorkspaces.has(requestedWorkspace) && !user.scopes?.includes('*') && !user.scopes?.includes('workspace:*')) {
    throw new ForbiddenError('Command workspace access denied');
  }
  const workspaceId = requestedWorkspace || (user.workspaceId ? String(user.workspaceId) : '');
  if (cmd.workspaceRequired && !workspaceId) throw new ForbiddenError('Workspace context required');

  const key = normalizeIdempotencyKey(idempotencyKey || `${commandId}:${requestId}`);
  const existing = await commandTransactions.find({ actorId: user.sub, workspaceId, commandId, idempotencyKey: key });
  if (existing && !['failed', 'expired'].includes(existing.phase)) {
    return { ok: existing.phase === 'completed', status: existing.phase === 'completed' ? 200 : 202, command: commandId, transaction: existing, replay: true, uncertain: existing.phase === 'uncertain' };
  }

  const created = await commandTransactions.create({
    commandId, actorId: user.sub, workspaceId, intent: cmd.description || commandId,
    risk: cmd.risk || 'medium', requestId, idempotencyKey: key,
    expectedEventTypes: cmd.expectedEventTypes || [], expectedResource: cmd.expectedResource || null,
    expectedResultState: cmd.expectedResultState || null, verificationMode: cmd.verificationMode || 'event',
  });
  const tx = created.transaction;
  if (!tx) throw new Error('Unable to create command transaction');
  if (!created.created) {
    return { ok: tx.phase === 'completed', status: tx.phase === 'completed' ? 200 : 202, command: commandId, transaction: tx, replay: true, uncertain: tx.phase === 'uncertain' };
  }

  const payload = { ...(cmd.bodyDefaults || {}), ...supplied };
  if (cmd.workspaceRequired) payload.workspace_id = workspaceId;
  if (Object.prototype.hasOwnProperty.call(payload, 'workspace_id') && String(payload.workspace_id) !== workspaceId) {
    await commandTransactions.transition(tx, 'failed', { failure: { code: 'WORKSPACE_MISMATCH' } });
    throw new ForbiddenError('Command workspace does not match authorized workspace');
  }

  logger.info('command_dispatch', { commandId, transactionId: tx.transactionId, user: user.sub, role: user.role, path: cmd.pythonPath, requestId, workspaceId });
  const method = (cmd.method || 'POST').toUpperCase();
  const commandUser = { ...user, __requestWorkspaceId: workspaceId };

  let current = await commandTransactions.transition(tx, 'executing');
  let result;
  try {
    result = await pythonClient.callPython({
      method, path: cmd.pythonPath, body: ['GET', 'HEAD'].includes(method) ? undefined : payload,
      requestId, traceparent, user: commandUser,
      commandId: tx.transactionId,
    });
  } catch (err) {
    current = await commandTransactions.findByTransactionId({ workspaceId, transactionId: tx.transactionId }) || current;
    if (hasSatisfiedEvidence(current, cmd)) {
      const completed = await commandTransactions.transition(current, 'completed', { verification: { ...(current.verification || {}), outcome: 'confirmed', verifiedAt: new Date().toISOString(), evidence: current.verification?.evidence || [] } });
      return { ok: true, status: 200, command: commandId, transaction: completed, verification: { required: true, status: 'confirmed_by_event' } };
    }
    const uncertain = await commandTransactions.transition(current, 'uncertain', {
      failure: { code: err.code || 'UPSTREAM_UNAVAILABLE', message: err.message },
      verification: { ...(current.verification || {}), outcome: 'unknown', verifiedAt: new Date().toISOString(), evidence: [...(current.verification?.evidence || []), 'dispatch transport failed'] },
    });
    return { ok: false, status: 202, command: commandId, transaction: uncertain, uncertain: true };
  }

  const acknowledged = result.status >= 200 && result.status < 300;
  current = await commandTransactions.findByTransactionId({ workspaceId, transactionId: tx.transactionId }) || current;
  if (hasSatisfiedEvidence(current, cmd)) {
    const completed = await commandTransactions.transition(current, 'completed', { verification: { ...(current.verification || {}), outcome: 'confirmed', verifiedAt: new Date().toISOString(), evidence: current.verification?.evidence || [] } });
    return { ok: true, status: 200, command: commandId, data: result.data, transaction: completed, verification: { required: true, status: 'confirmed_by_event' } };
  }

  if (!acknowledged) {
    const failed = await commandTransactions.transition(current, 'failed', {
      failure: { code: 'UPSTREAM_REJECTED', status: result.status },
    });
    return { command: commandId, ok: false, status: result.status || 502, data: result.data, transaction: failed };
  }

  if (cmd.verificationMode === 'http_success') {
    const completed = await commandTransactions.transition(current, 'completed', {
      verification: { outcome: 'confirmed', verifiedAt: new Date().toISOString(), evidence: [`HTTP ${result.status}`] },
    });
    return { command: commandId, ok: true, status: result.status, data: result.data, transaction: completed, verification: { required: false, status: 'confirmed' } };
  }

  const verifying = await commandTransactions.transition(current, 'verifying', {
    verification: { ...(current.verification || {}), outcome: 'not_confirmed', evidence: [...(current.verification?.evidence || []), `HTTP ${result.status}`] },
  });

  return {
    command: commandId, ok: true, status: result.status, data: result.data,
    transaction: verifying,
    verification: { required: true, status: 'awaiting_correlated_event', expectedEventTypes: cmd.expectedEventTypes || [] },
  };
}

function hasSatisfiedEvidence(tx, cmd) {
  if (!tx || !Array.isArray(tx.verification?.evidence)) return false;
  return tx.verification.evidence.some((e) => e && e.satisfied === true) || tx.phase === 'completed';
}

function normalizeIdempotencyKey(key) {
  const value = String(key || '').trim();
  if (!value || value.length > 256) throw new BadRequestError('Idempotency-Key must be 1-256 characters');
  return value;
}
function pickBody(body, keys) {
  if (!keys || !keys.length) return body && typeof body === 'object' ? { ...body } : {};
  if (!body || typeof body !== 'object') return {};
  const out = {}; for (const key of keys) if (body[key] !== undefined) out[key] = body[key]; return out;
}
module.exports = { executeCommand };
