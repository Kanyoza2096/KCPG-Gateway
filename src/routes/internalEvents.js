'use strict';

const express = require('express');
const crypto = require('node:crypto');
const { z } = require('zod');
const config = require('../config');
const eventBus = require('../services/eventBus');
const resourceState = require('../services/resourceState');
const commandTransactions = require('../services/commandTransaction');
const { UnauthorizedError, BadRequestError } = require('../utils/errors');
const { EVENTS, canonicalEventName } = require('../contracts/events');

const router = express.Router();
const KNOWN_EVENTS = new Set(Object.values(EVENTS));
const MAX_SKEW_MS = config.events.maxSkewMs;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((o, k) => { o[k] = canonicalize(value[k]); return o; }, {});
  return value;
}
function payloadDigest(event) { return crypto.createHash('sha256').update(JSON.stringify(canonicalize(event))).digest('hex'); }

function requirePythonService(req, _res, next) {
  const auth = req.get('authorization') || '';
  const expected = config.python.serviceToken;
  if (!expected || !safeEqual(auth, `Bearer ${expected}`)) return next(new UnauthorizedError('Python service authentication required'));
  if (config.events.requireSignature) {
    const signature = req.get('x-kcpg-event-signature') || '';
    const event = req.body || {};
    const eventId = value(event, 'event_id', 'eventId') || '';
    const issuedAt = value(event, 'issued_at', 'issuedAt', 'ts') || '';
    const workspaceId = value(event, 'workspace_id', 'workspaceId') || '';
    const correlationId = value(event, 'correlation_id', 'correlationId', 'request_id', 'requestId') || '';
    const commandId = value(event, 'command_id', 'commandId') || '';
    const type = canonicalEventName(value(event, 'type', 'event', 'name', 'event_name') || '');
    const canonical = [eventId, issuedAt, workspaceId, correlationId, commandId, type, payloadDigest(event)].join('|');
    const expectedSig = crypto.createHmac('sha256', config.events.signingSecret).update(canonical).digest('hex');
    if (!signature || !safeEqual(signature, expectedSig)) return next(new UnauthorizedError('Invalid event signature'));
  }
  next();
}

const envelopeSchema = z.object({
  event_id: z.string().min(8).max(256).optional(), eventId: z.string().min(8).max(256).optional(),
  issued_at: z.string().datetime({ offset: true }).optional(), issuedAt: z.string().datetime({ offset: true }).optional(), ts: z.string().datetime({ offset: true }).optional(),
  workspace_id: z.string().min(1).max(256).optional(), workspaceId: z.string().min(1).max(256).optional(),
  correlation_id: z.string().min(1).max(256).optional(), correlationId: z.string().min(1).max(256).optional(), request_id: z.string().min(1).max(256).optional(), requestId: z.string().min(1).max(256).optional(),
  command_id: z.string().min(1).max(256).optional(), commandId: z.string().min(1).max(256).optional(),
  type: z.string().min(1).max(256).optional(), event: z.string().min(1).max(256).optional(), name: z.string().min(1).max(256).optional(), event_name: z.string().min(1).max(256).optional(),
  source: z.string().min(1).max(128).optional(), resource: z.record(z.any()).optional(), data: z.record(z.any()).optional(),
}).passthrough();

function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function value(body, ...keys) { for (const key of keys) if (body[key] != null) return body[key]; return null; }
function eventIdFor(body) {
  const explicit = value(body, 'event_id', 'eventId');
  if (explicit) return String(explicit);
  if (config.isProd) throw new BadRequestError('event_id is required in production');
  const stable = { ...body }; delete stable.ts; delete stable.issued_at; delete stable.issuedAt;
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
function extractResultState(body) {
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const resource = body.resource || data.resource || {};
  return resource.observed_state || resource.observedState || data.state || data.status || body.state || body.status || null;
}
function matchesExpectedResource(body, expected) {
  if (!expected) return true;
  const resource = body.resource || body.data?.resource || {};
  return String(resource.kind || '') === String(expected.kind || '') && String(resource.id || '') === String(expected.id || '');
}

router.post('/', requirePythonService, async (req, res, next) => {
  try {
    const parsed = envelopeSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('Invalid event envelope', parsed.error.flatten());
    const body = parsed.data;
    const workspaceId = value(body, 'workspace_id', 'workspaceId');
    const correlationId = value(body, 'correlation_id', 'correlationId', 'request_id', 'requestId');
    const commandId = value(body, 'command_id', 'commandId');
    const type = canonicalEventName(value(body, 'type', 'event', 'name', 'event_name'));
    const issuedAt = value(body, 'issued_at', 'issuedAt', 'ts');
    if (!workspaceId || !correlationId || !type || !issuedAt) throw new BadRequestError('workspace_id, correlation_id, event type and issued_at/ts are required');
    if (!KNOWN_EVENTS.has(type)) throw new BadRequestError(`Unknown event type: ${type}`);
    if (config.isProd && body.source && body.source !== 'python-core') throw new BadRequestError('Invalid event source');

    const issuedMs = Date.parse(issuedAt);
    if (!Number.isFinite(issuedMs) || Math.abs(Date.now() - issuedMs) > MAX_SKEW_MS) throw new BadRequestError('Event timestamp outside accepted replay window');
    const eventId = eventIdFor(body);
    const tx = commandId ? await commandTransactions.findByTransactionId({ workspaceId: String(workspaceId), transactionId: String(commandId) }) : null;

    let satisfied = false;
    let observedGeneration = null;
    if (tx) {
      if (String(tx.correlationId) !== String(correlationId)) throw new BadRequestError('Command correlation mismatch');
      if (tx.phase !== 'completed' && tx.phase !== 'failed' && tx.phase !== 'expired') {
        const expected = tx.expectedEventTypes || [];
        if (expected.length && !expected.includes(type)) throw new BadRequestError('Unexpected event type for command transaction');
        if (!matchesExpectedResource(body, tx.expectedResource)) throw new BadRequestError('Event resource does not satisfy command contract');
        const resultState = extractResultState(body);
        if (tx.expectedResultState && String(resultState || '').toLowerCase() !== String(tx.expectedResultState).toLowerCase()) throw new BadRequestError('Event result state does not satisfy command contract');
        const resource = body.resource || body.data?.resource;
        if (resource) {
          const rawGen = resource.observed_generation ?? resource.observedGeneration;
          if (rawGen != null) observedGeneration = Number(rawGen);
        }
        satisfied = (!tx.expectedResultState || String(extractResultState(body) || '').toLowerCase() === String(tx.expectedResultState).toLowerCase()) && matchesExpectedResource(body, tx.expectedResource) && (!expected.length || expected.includes(type));
      }
      const updated = await commandTransactions.recordEvidence(tx, { eventId, type, issuedAt, correlationId, commandId, observedGeneration, satisfied });
      if (updated?.phase === 'completed') satisfied = true;
    } else if (commandId) {
      throw new BadRequestError('Unknown command transaction for workspace');
    }

    await eventBus.publish(type, {
      ...(body.data && typeof body.data === 'object' ? body.data : body),
      event_id: eventId, issued_at: issuedAt, correlation_id: correlationId, command_id: commandId || undefined, source: body.source || 'python-core',
    }, String(workspaceId));

    const resource = body.resource || body.data?.resource;
    if (resource?.kind && resource?.id) {
      const rawGen = resource.observed_generation ?? resource.observedGeneration;
      if (!Number.isInteger(Number(rawGen)) || Number(rawGen) < 0) throw new BadRequestError('resource.observed_generation is required for authoritative state updates');
      await resourceState.applyEvent({ workspaceId: String(workspaceId), kind: String(resource.kind), id: String(resource.id), eventType: type,
        observedState: resource.observed_state || resource.observedState, observedGeneration: Number(rawGen), health: resource.health,
        confidence: Number.isFinite(Number(resource.confidence)) ? Number(resource.confidence) : 1, evidence: Array.isArray(resource.evidence) ? resource.evidence : [],
      });
    }

    res.status(202).json({ ok: true, accepted: true, event_id: eventId, type, workspace_id: String(workspaceId), correlation_id: String(correlationId), transaction_id: tx?.transactionId || null, verification_satisfied: satisfied });
  } catch (err) { next(err); }
});

module.exports = router;
