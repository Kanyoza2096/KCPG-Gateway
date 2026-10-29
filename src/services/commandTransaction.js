'use strict';

const { v4: uuidv4 } = require('uuid');
const crypto = require('node:crypto');
const Redis = require('ioredis');
const config = require('../config');

const TTL_MS = 15 * 60 * 1000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 20_000;
const transactions = new Map();
let redis = null;
let redisReady = false;

function now() { return new Date().toISOString(); }
function digest(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function txKey({ actorId, workspaceId, commandId, idempotencyKey }) {
  return `kcp:tx:v3:${digest(`${actorId || ''}:${workspaceId || ''}:${commandId}:${idempotencyKey}`)}`;
}
function commandIndexKey({ workspaceId, transactionId }) {
  return `kcp:tx-index:v3:${digest(`${workspaceId || ''}:${transactionId}`)}`;
}
function recentWorkspaceKey(workspaceId) {
  return `kcp:tx-recent:v3:${digest(String(workspaceId || ''))}`;
}
function isExpired(tx) { return !tx?.updatedAt || Date.now() - Date.parse(tx.updatedAt) > TTL_MS; }

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
    if (config.isProd || config.redis.required) throw new Error('Durable transaction store unavailable');
    return false;
  }
}

function expireLocal(tx) {
  if (tx?.phase === 'verifying' && tx.verificationDeadline && Date.now() > Date.parse(tx.verificationDeadline)) {
    return {
      ...tx,
      phase: 'uncertain',
      updatedAt: now(),
      version: Number(tx.version || 0) + 1,
      verification: { ...(tx.verification || {}), outcome: 'timeout', verifiedAt: now(), evidence: [...(tx.verification?.evidence || []), 'verification deadline exceeded'] },
    };
  }
  return tx;
}

async function find({ actorId, workspaceId, commandId, idempotencyKey }) {
  if (!idempotencyKey || !actorId || !workspaceId || !commandId) return null;
  const k = txKey({ actorId, workspaceId, commandId, idempotencyKey });
  if (await ensureRedis()) {
    const raw = await redis.get(k);
    if (!raw) return null;
    const tx = JSON.parse(raw);
    if (isExpired(tx)) { await redis.del(k); return null; }
    return tx;
  }
  const tx = transactions.get(k);
  if (!tx || isExpired(tx)) { transactions.delete(k); return null; }
  return expireLocal(tx);
}

async function create({ commandId, actorId, workspaceId, intent, risk, requestId, idempotencyKey, autonomyLevel = 'L1', commandLeaseId = null, expectedEventTypes = [], expectedResource = null, expectedResultState = null, verificationMode = 'event' }) {
  const tx = {
    commandId,
    transactionId: `ctx_${uuidv4()}`,
    requestId,
    correlationId: requestId,
    idempotencyKey,
    actorId,
    workspaceId,
    intent,
    risk,
    autonomyLevel,
    commandLeaseId,
    expectedEventTypes: [...expectedEventTypes],
    expectedResource,
    expectedResultState,
    verificationMode,
    verificationDeadline: verificationMode === 'event' ? new Date(Date.now() + DEFAULT_VERIFICATION_TIMEOUT_MS).toISOString() : null,
    phase: 'queued',
    verification: { outcome: 'not_started', evidence: [] },
    createdAt: now(),
    updatedAt: now(),
    version: 1,
  };
  const k = txKey({ actorId, workspaceId, commandId, idempotencyKey });
  if (await ensureRedis()) {
    const won = await redis.set(k, JSON.stringify(tx), 'PX', TTL_MS, 'NX');
    if (won !== 'OK') return { created: false, transaction: await find({ actorId, workspaceId, commandId, idempotencyKey }) };
    await redis.set(commandIndexKey({ workspaceId, transactionId: tx.transactionId }), k, 'PX', TTL_MS);
    return { created: true, transaction: tx };
  }
  if (transactions.has(k)) return { created: false, transaction: await find({ actorId, workspaceId, commandId, idempotencyKey }) };
  transactions.set(k, tx);
  await indexRecentTransaction(tx);
  return { created: true, transaction: tx };
}

async function casUpdate(tx, mutator) {
  const k = txKey({ actorId: tx.actorId, workspaceId: tx.workspaceId, commandId: tx.commandId, idempotencyKey: tx.idempotencyKey });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const next = mutator({ ...tx });
    if (await ensureRedis()) {
      await redis.watch(k);
      const raw = await redis.get(k);
      if (!raw) { await redis.unwatch(); return null; }
      const current = JSON.parse(raw);
      if (Number(current.version || 0) !== Number(tx.version || 0)) {
        await redis.unwatch(); Object.assign(tx, current); return current;
      }
      const result = await redis.multi().set(k, JSON.stringify(next), 'PX', TTL_MS).exec();
      if (result) { Object.assign(tx, next); await indexRecentTransaction(next); return next; }
      continue;
    }
    const current = transactions.get(k);
    if (!current) return null;
    if (Number(current.version || 0) !== Number(tx.version || 0)) { Object.assign(tx, current); return current; }
    transactions.set(k, next); Object.assign(tx, next); await indexRecentTransaction(next); return next;
  }
  throw new Error('Transaction state conflict');
}

async function indexRecentTransaction(tx) {
  if (!tx?.workspaceId || !tx?.transactionId) return;
  const score = Date.parse(tx.updatedAt || tx.createdAt || now()) || Date.now();
  if (await ensureRedis()) {
    await redis.zadd(recentWorkspaceKey(tx.workspaceId), score, tx.transactionId);
    await redis.zremrangebyrank(recentWorkspaceKey(tx.workspaceId), 0, -101);
  }
}

async function listRecent({ workspaceId, limit = 20 }) {
  if (!workspaceId) return [];
  const bounded = Math.max(1, Math.min(Number(limit) || 20, 100));
  if (await ensureRedis()) {
    const ids = await redis.zrevrange(recentWorkspaceKey(workspaceId), 0, bounded - 1);
    const rows = [];
    for (const transactionId of ids) {
      const row = await findByTransactionId({ workspaceId, transactionId });
      if (row && !isExpired(row)) rows.push(row);
    }
    return rows;
  }
  return Array.from(transactions.values())
    .filter((tx) => String(tx.workspaceId) === String(workspaceId) && !isExpired(tx))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
    .slice(0, bounded);
}

async function transition(tx, phase, patch = {}) {
  if (!tx) return null;
  if (['completed', 'failed', 'expired'].includes(tx.phase) && tx.phase !== phase) return tx;
  return casUpdate(tx, (current) => ({
    ...current,
    ...patch,
    phase,
    updatedAt: now(),
    version: Number(current.version || 0) + 1,
  }));
}

async function recordEvidence(tx, evidence, satisfied) {
  if (!tx) return null;
  const item = {
    eventId: evidence.eventId,
    type: evidence.type,
    issuedAt: evidence.issuedAt,
    correlationId: evidence.correlationId,
    commandId: evidence.commandId,
    observedGeneration: evidence.observedGeneration ?? null,
    satisfied: evidence.satisfied === true,
  };
  return casUpdate(tx, (current) => {
    const prior = Array.isArray(current.verification?.evidence) ? current.verification.evidence : [];
    const duplicate = prior.some((x) => x && x.eventId === item.eventId);
    const merged = duplicate ? prior : [...prior, item];
    const nextPhase = satisfied && ['executing', 'verifying', 'uncertain'].includes(current.phase) ? 'completed' : current.phase;
    return {
      ...current,
      phase: nextPhase,
      updatedAt: now(),
      version: Number(current.version || 0) + 1,
      verification: {
        ...(current.verification || {}),
        outcome: satisfied ? 'confirmed' : 'pending',
        verifiedAt: satisfied ? now() : current.verification?.verifiedAt || null,
        evidence: merged,
      },
    };
  });
}

async function findByTransactionId({ workspaceId, transactionId }) {
  if (!workspaceId || !transactionId) return null;
  if (await ensureRedis()) {
    const index = await redis.get(commandIndexKey({ workspaceId, transactionId }));
    if (!index) return null;
    const raw = await redis.get(index);
    return raw ? JSON.parse(raw) : null;
  }
  for (const tx of transactions.values()) if (String(tx.workspaceId) === String(workspaceId) && tx.transactionId === transactionId && !isExpired(tx)) return tx;
  return null;
}

async function findByCommandId({ workspaceId, commandId, correlationId }) {
  if (!workspaceId || !commandId) return null;
  if (await ensureRedis()) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'kcp:tx:v3:*', 'COUNT', 100);
      cursor = next;
      if (keys.length) {
        const values = await redis.mget(keys);
        for (const raw of values) {
          if (!raw) continue;
          const tx = JSON.parse(raw);
          if (tx.commandId === commandId && String(tx.workspaceId) === String(workspaceId) && (!correlationId || tx.correlationId === correlationId) && !isExpired(tx)) return tx;
        }
      }
    } while (cursor !== '0');
    return null;
  }
  for (const tx of transactions.values()) if (tx.commandId === commandId && String(tx.workspaceId) === String(workspaceId) && (!correlationId || tx.correlationId === correlationId) && !isExpired(tx)) return tx;
  return null;
}

async function requestCancellation(tx, actorId) {
  if (!tx) return null;
  if (tx.actorId !== actorId) return null;
  if (['completed', 'failed', 'cancelled', 'expired'].includes(tx.phase)) return tx;
  return casUpdate(tx, (current) => ({
    ...current,
    cancelRequested: true,
    cancelRequestedAt: now(),
    updatedAt: now(),
    version: Number(current.version || 0) + 1,
  }));
}

async function cancelBeforeDispatch(tx, actorId) {
  if (!tx || tx.actorId !== actorId) return null;
  if (tx.phase !== 'queued') return tx;
  return casUpdate(tx, (current) => ({ ...current, phase: 'cancelled', cancelRequested: true, cancelRequestedAt: now(), updatedAt: now(), version: Number(current.version || 0) + 1 }));
}

async function cleanup() { for (const [key, tx] of transactions) if (isExpired(tx)) transactions.delete(key); }
async function close() { if (redis) { try { await redis.quit(); } catch {} } redis = null; redisReady = false; transactions.clear(); }

module.exports = { create, find, transition, recordEvidence, findByTransactionId, findByCommandId, listRecent, requestCancellation, cancelBeforeDispatch, cleanup, close, TTL_MS, DEFAULT_VERIFICATION_TIMEOUT_MS };
