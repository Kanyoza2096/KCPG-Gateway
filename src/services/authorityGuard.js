'use strict';

const crypto = require('node:crypto');
const Redis = require('ioredis');
const config = require('../config');

const LOCK_KEY = 'kcp:guardian:global:v2';
const LEASE_PREFIX = 'kcp:command-lease:v2:';
const DEFAULT_LEASE_MS = 60_000;
const MAX_LEASE_MS = 120_000;
const memory = { locked: false, reason: null, changedAt: new Date(0).toISOString(), generation: 0, changedBy: null };
const leases = new Map();
let redis = null;
let redisReady = false;

function now() { return new Date().toISOString(); }
function token() { return crypto.randomBytes(24).toString('base64url'); }
async function store() {
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
    if (config.isProd || config.redis.required) throw new Error('Durable authority store unavailable');
    return false;
  }
}

async function getGuardian() {
  if (await store()) {
    const raw = await redis.get(LOCK_KEY);
    return raw ? JSON.parse(raw) : { ...memory };
  }
  return { ...memory };
}

async function lock(reason, actorId) {
  const current = await getGuardian();
  const value = { locked: true, reason: String(reason || 'Emergency guardian lock').trim().slice(0, 240), changedAt: now(), changedBy: actorId || null, generation: Number(current.generation || 0) + 1 };
  Object.assign(memory, value);
  if (await store()) await redis.set(LOCK_KEY, JSON.stringify(value));
  return value;
}

async function unlock(actorId) {
  const current = await getGuardian();
  const value = { locked: false, reason: null, changedAt: now(), changedBy: actorId || null, generation: Number(current.generation || 0) + 1 };
  Object.assign(memory, value);
  if (await store()) await redis.set(LOCK_KEY, JSON.stringify(value));
  return value;
}

function leaseKey(id) { return `${LEASE_PREFIX}${id}`; }
async function issueLease({ actorId, workspaceId, autonomyLevel = 'L3', ttlMs = DEFAULT_LEASE_MS }) {
  const guardian = await getGuardian();
  if (guardian.locked) throw Object.assign(new Error('Guardian is locked'), { code: 'GUARDIAN_LOCKED' });
  const ms = Math.min(Math.max(Number(ttlMs) || DEFAULT_LEASE_MS, 5_000), MAX_LEASE_MS);
  const id = token();
  const lease = { leaseId: id, actorId: String(actorId), workspaceId: String(workspaceId), autonomyLevel, guardianGeneration: Number(guardian.generation || 0), issuedAt: now(), expiresAt: new Date(Date.now() + ms).toISOString(), state: 'issued' };
  if (await store()) await redis.set(leaseKey(id), JSON.stringify(lease), 'PX', ms);
  else leases.set(id, lease);
  return lease;
}

async function getLease(id) {
  if (!id) return null;
  if (await store()) { const raw = await redis.get(leaseKey(id)); return raw ? JSON.parse(raw) : null; }
  const lease = leases.get(id); if (!lease) return null;
  if (Date.now() >= Date.parse(lease.expiresAt)) { leases.delete(id); return null; }
  return lease;
}

async function fenceLease({ leaseId, actorId, workspaceId, autonomyLevel, transactionId }) {
  const guardian = await getGuardian();
  const lease = await getLease(leaseId);
  if (!lease) return { allowed: false, code: 'COMMAND_LEASE_EXPIRED' };
  if (lease.state !== 'issued') return { allowed: false, code: 'COMMAND_LEASE_NOT_ACTIVE', lease };
  if (lease.actorId !== String(actorId) || lease.workspaceId !== String(workspaceId) || lease.autonomyLevel !== autonomyLevel) return { allowed: false, code: 'COMMAND_LEASE_BINDING_MISMATCH', lease };
  if (lease.guardianGeneration !== Number(guardian.generation || 0) || guardian.locked) return { allowed: false, code: 'GUARDIAN_FENCE_TRIPPED', guardian, lease };
  const next = { ...lease, state: 'bound', transactionId, boundAt: now() };
  if (await store()) {
    const raw = await redis.get(leaseKey(leaseId));
    if (!raw) return { allowed: false, code: 'COMMAND_LEASE_EXPIRED' };
    const current = JSON.parse(raw);
    if (current.state !== 'issued' || current.guardianGeneration !== Number(guardian.generation || 0)) return { allowed: false, code: 'COMMAND_LEASE_FENCE_CONFLICT', guardian, lease: current };
    const ttl = Math.max(1, Date.parse(current.expiresAt) - Date.now());
    await redis.set(leaseKey(leaseId), JSON.stringify(next), 'PX', ttl);
  } else {
    const current = leases.get(leaseId);
    if (!current || current.state !== 'issued' || current.guardianGeneration !== Number(guardian.generation || 0)) return { allowed: false, code: 'COMMAND_LEASE_FENCE_CONFLICT', guardian, lease: current };
    leases.set(leaseId, next);
  }
  return { allowed: true, lease: next, guardian };
}

async function verifyBoundLease({ leaseId, actorId, workspaceId, autonomyLevel, transactionId }) {
  const guardian = await getGuardian();
  const lease = await getLease(leaseId);
  if (!lease) return { allowed: false, code: 'COMMAND_LEASE_EXPIRED' };
  if (lease.state !== 'bound' || lease.transactionId !== transactionId) return { allowed: false, code: 'COMMAND_LEASE_NOT_BOUND', lease };
  if (lease.actorId !== String(actorId) || lease.workspaceId !== String(workspaceId) || lease.autonomyLevel !== autonomyLevel) return { allowed: false, code: 'COMMAND_LEASE_BINDING_MISMATCH', lease };
  if (guardian.locked || lease.guardianGeneration !== Number(guardian.generation || 0)) return { allowed: false, code: 'GUARDIAN_FENCE_TRIPPED', guardian, lease };
  return { allowed: true, guardian, lease };
}

async function releaseLease(leaseId, actorId) {
  const lease = await getLease(leaseId);
  if (!lease) return { released: false, code: 'COMMAND_LEASE_NOT_FOUND' };
  if (actorId && lease.actorId !== String(actorId)) return { released: false, code: 'COMMAND_LEASE_OWNER_MISMATCH' };
  if (await store()) await redis.del(leaseKey(leaseId)); else leases.delete(leaseId);
  return { released: true, lease: { ...lease, state: 'released', releasedAt: now() } };
}

async function authorizeActuation({ user, workspaceId, risk, autonomyLevel = 'L1', body = {} }) {
  const guardian = await getGuardian();
  const level = String(autonomyLevel || 'L1').toUpperCase();
  if (guardian.locked && risk !== 'low') return { allowed: false, code: 'GUARDIAN_LOCKED', guardian };
  if (!['L0','L1','L2','L3','L4'].includes(level)) return { allowed: false, code: 'INVALID_AUTONOMY_LEVEL', guardian };
  if (['L0','L1','L2'].includes(level)) return { allowed: true, guardian, autonomyLevel: level };
  if (!has(user, 'autonomy.execute')) return { allowed: false, code: 'AUTONOMY_SCOPE_REQUIRED', guardian };
  if (body.action_bounded !== true) return { allowed: false, code: 'ACTION_NOT_BOUNDED', guardian };
  if (body.dry_run !== true) return { allowed: false, code: 'DRY_RUN_PROOF_REQUIRED', guardian };
  if (body.verification_supported !== true) return { allowed: false, code: 'VERIFICATION_REQUIRED', guardian };
  const lease = await getLease(body.command_lease_id || body.lease_id);
  if (!lease || lease.actorId !== String(user.sub) || lease.workspaceId !== String(workspaceId) || lease.autonomyLevel !== level) return { allowed: false, code: 'COMMAND_LEASE_INVALID', guardian };
  if (lease.guardianGeneration !== Number(guardian.generation || 0) || lease.state !== 'issued') return { allowed: false, code: 'COMMAND_LEASE_FENCE_TRIPPED', guardian, lease };
  return { allowed: true, guardian, autonomyLevel: level, lease };
}

function has(user, scope) { const scopes = new Set(user?.scopes || []); return scopes.has('*') || scopes.has(scope); }
async function close() { if (redis) { try { await redis.quit(); } catch {} } redis = null; redisReady = false; leases.clear(); }

module.exports = { getGuardian, lock, unlock, issueLease, getLease, fenceLease, verifyBoundLease, releaseLease, authorizeActuation, close, DEFAULT_LEASE_MS, MAX_LEASE_MS };
