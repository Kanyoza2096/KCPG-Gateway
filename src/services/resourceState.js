'use strict';

const Redis = require('ioredis');
const { randomUUID } = require('node:crypto');
const config = require('../config');

const memory = new Map();
let redis = null;
let redisReady = false;

function key(workspaceId, kind, id) { return `kcp:resource:v2:${String(workspaceId)}:${String(kind)}:${String(id)}`; }
function computeFreshness(resource) {
  const observedAt = Date.parse(resource?.provenance?.observedAt || '');
  return Number.isFinite(observedAt) ? Math.max(0, Date.now() - observedAt) : Number.POSITIVE_INFINITY;
}

function fresh(kind, id, workspaceId) {
  const now = new Date().toISOString();
  return {
    apiVersion: 'kcp.kanyoza.io/v1', kind, id, workspaceId,
    spec: { desiredState: 'unknown', generation: 0 },
    status: { observedState: 'unknown', observedGeneration: 0, health: 'unknown', conditions: [] },
    reconciliation: { phase: 'idle', generation: 0, observedGeneration: 0 },
    provenance: { source: 'unobserved', observedAt: now, freshnessMs: Number.POSITIVE_INFINITY, confidence: 0, evidence: [] },
    metadata: { createdAt: now, updatedAt: now },
  };
}

async function ensureRedis() {
  if (redisReady) return true;
  if (!config.redis.required && !config.isProd) return false;
  if (!redis) redis = new Redis(config.redis.url, { maxRetriesPerRequest: 1, enableReadyCheck: true, lazyConnect: true });
  try {
    if (redis.status !== 'ready') await redis.connect();
    redisReady = redis.status === 'ready';
    return redisReady;
  } catch {
    redisReady = false;
    try { redis.disconnect(); } catch {}
    if (config.isProd || config.redis.required) throw new Error('Durable resource-state store unavailable');
    return false;
  }
}

async function get(workspaceId, kind, id) {
  const k = key(workspaceId, kind, id);
  if (await ensureRedis()) {
    const raw = await redis.get(k);
    if (raw) { const resource = JSON.parse(raw); resource.provenance.freshnessMs = computeFreshness(resource); return resource; }
    return fresh(kind, id, workspaceId);
  }
  const resource = memory.get(k) || fresh(kind, id, workspaceId);
  resource.provenance.freshnessMs = computeFreshness(resource);
  return resource;
}

async function save(resource) {
  const k = key(resource.workspaceId, resource.kind, resource.id);
  resource.metadata.updatedAt = new Date().toISOString();
  if (await ensureRedis()) {
    await redis.set(k, JSON.stringify(resource));
    return resource;
  }
  memory.set(k, resource);
  return resource;
}

async function setDesired({ workspaceId, kind, id, desiredState, mode, config: desiredConfig }) {
  if (!workspaceId || !kind || !id || typeof desiredState !== 'string' || !desiredState.trim()) throw new Error('Invalid desired-state request');
  const k = key(workspaceId, kind, id);
  const hasMode = mode !== undefined;
  const hasConfig = desiredConfig !== undefined;
  const changed = (resource) => resource.spec.desiredState !== desiredState || (hasMode && resource.spec.mode !== mode) || (hasConfig && JSON.stringify(resource.spec.config) !== JSON.stringify(desiredConfig));
  const apply = (resource) => {
    const next = { ...resource, spec: { ...resource.spec } };
    if (changed(resource)) {
      next.spec = { ...next.spec, desiredState, ...(hasMode ? { mode } : {}), ...(hasConfig ? { config: desiredConfig } : {}), generation: Number(next.spec.generation || 0) + 1 };
    }
    next.metadata.updatedAt = new Date().toISOString();
    return next;
  };
  if (await ensureRedis()) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await redis.watch(k);
      const raw = await redis.get(k);
      const resource = raw ? JSON.parse(raw) : fresh(kind, id, workspaceId);
      const next = apply(resource);
      const result = await redis.multi().set(k, JSON.stringify(next)).exec();
      if (result) return next;
    }
    throw new Error('Desired-state update conflict');
  }
  return save(apply(memory.get(k) || fresh(kind, id, workspaceId)));
}

function reconcile(resource) {
  const freshnessMs = computeFreshness(resource);
  const stale = !Number.isFinite(freshnessMs) || freshnessMs > 30_000;
  const desiredGeneration = Number(resource.spec.generation || 0);
  const observedGeneration = Number(resource.status.observedGeneration || 0);
  if (resource.spec.desiredState === 'unknown') return { decision: 'UNKNOWN', reason: 'desired state is not established' };
  if (resource.status.health === 'unhealthy') return { decision: 'DEGRADED', reason: 'observed resource is unhealthy' };
  if (resource.provenance.confidence < 0.8 || stale) return { decision: 'UNKNOWN', reason: 'observed state is stale or low-confidence', freshnessMs };
  if (observedGeneration !== desiredGeneration) return { decision: 'RECONCILE', reason: 'observed generation does not match desired generation', generation: desiredGeneration, observedGeneration, commandId: `reconcile_${randomUUID()}` };
  if (resource.spec.desiredState === resource.status.observedState) return { decision: 'NOOP', reason: 'desired state matches observed state', generation: desiredGeneration };
  return { decision: 'RECONCILE', reason: 'desired state differs from observed state', generation: desiredGeneration, observedGeneration, commandId: `reconcile_${randomUUID()}` };
}

async function updateObserved({ workspaceId, kind, id, observedState, observedGeneration, health, conditions = [], source = 'controller', confidence = 1, evidence = [] }) {
  if (!Number.isInteger(Number(observedGeneration)) || Number(observedGeneration) < 0) throw new Error('observedGeneration is required');
  const k = key(workspaceId, kind, id);
  const apply = (resource) => {
    const incoming = Number(observedGeneration);
    const current = Number(resource.status.observedGeneration || 0);
    const desiredGeneration = Number(resource.spec.generation || 0);
    if (incoming < current) return resource; // stale observation: never roll state backwards
    if (incoming > desiredGeneration) throw new Error('Observed generation is ahead of desired generation');
    const now = new Date().toISOString();
    resource.status = { ...resource.status, observedState, observedGeneration: incoming, health, conditions, lastTransitionAt: now };
    resource.reconciliation = { ...resource.reconciliation, phase: 'idle', generation: desiredGeneration, observedGeneration: incoming, lastReconcileAt: now, lastSuccessAt: health === 'healthy' ? now : resource.reconciliation.lastSuccessAt };
    resource.provenance = { source, observedAt: now, freshnessMs: 0, confidence, evidence };
    resource.metadata.updatedAt = now;
    return resource;
  };

  if (await ensureRedis()) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await redis.watch(k);
      const raw = await redis.get(k);
      const resource = raw ? JSON.parse(raw) : fresh(kind, id, workspaceId);
      const next = apply(resource);
      const result = await redis.multi().set(k, JSON.stringify(next)).exec();
      if (result) return next;
    }
    throw new Error('Observed-state update conflict');
  }
  return save(apply(memory.get(k) || fresh(kind, id, workspaceId)));
}

async function applyEvent({ workspaceId, kind, id, eventType, observedState, observedGeneration, health, source = 'event-bus', confidence = 1, evidence = [] }) {
  if (!workspaceId || !kind || !id) return null;
  return updateObserved({ workspaceId, kind, id, observedState: observedState || 'unknown', observedGeneration, health: health || 'unknown', source, confidence, evidence: [...evidence, `event:${eventType || 'unknown'}`] });
}

async function close() { if (redis) { try { await redis.quit(); } catch {} } redis = null; redisReady = false; memory.clear(); }
module.exports = { get, save, setDesired, updateObserved, applyEvent, reconcile, close };
