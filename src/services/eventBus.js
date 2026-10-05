'use strict';

const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');
const { EVENTS, EVENT_NAMESPACE, NAMESPACES, canonicalEventName } = require('../contracts/events');
const { cache } = require('./cache');

let subscriber = null;
let publisher = null;
let ioRef = null;
let rawBroadcast = null;
const waiters = new Set();
const seenEventIds = new Set();
const EVENT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

function attachSocketServer(io) {
  ioRef = io;
}

function attachRawBroadcast(fn) { rawBroadcast = fn; }

async function start() {
  try {
    subscriber = new Redis(config.redis.url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    publisher = new Redis(config.redis.url, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    await subscriber.connect();
    await publisher.connect();

    await subscriber.subscribe(config.redis.eventChannel);
    subscriber.on('message', (_channel, message) => {
      handleIncoming(message).catch((err) => logger.warn('event_handle_failed', { message: err.message }));
    });

    logger.info('event_bus_started', { channel: config.redis.eventChannel });
    return true;
  } catch (err) {
    logger.warn('event_bus_unavailable', { message: err.message });
    subscriber = null;
    publisher = null;
    if (config.isProd && config.redis.required) {
      logger.error('event_bus_required_but_unavailable');
    }
    return false;
  }
}

function matchesWaiter(payload, waiter) {
  const type = canonicalEventName(payload.type || payload.event || payload.name || payload.event_name);
  const workspace = payload.workspace_id || payload.workspaceId;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const correlation = payload.correlation_id || payload.correlationId || data.correlation_id || data.correlationId || payload.request_id || payload.requestId || data.request_id || data.requestId;
  if (waiter.workspaceId && String(workspace) !== String(waiter.workspaceId)) return false;
  if (waiter.correlationId && String(correlation) !== String(waiter.correlationId)) return false;
  if (waiter.types?.length && !waiter.types.includes(type)) return false;
  return true;
}

function waitForCorrelatedEvent({ correlationId, workspaceId, types = [], timeoutMs = 10_000 }) {
  return new Promise((resolve) => {
    const waiter = { correlationId, workspaceId, types: types.map(canonicalEventName), resolve, timer: null };
    waiter.timer = setTimeout(() => {
      waiters.delete(waiter);
      resolve(null);
    }, Math.max(1, timeoutMs));
    waiters.add(waiter);
  });
}

function resolveWaiters(payload) {
  for (const waiter of [...waiters]) {
    if (!matchesWaiter(payload, waiter)) continue;
    clearTimeout(waiter.timer);
    waiters.delete(waiter);
    waiter.resolve(payload);
  }
}

async function handleIncoming(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    logger.warn('event_bus_invalid_json');
    return;
  }

  let type = payload.type || payload.event || payload.name || payload.event_name;
  const workspace = payload.workspace_id || payload.workspaceId;
  const issuedAt = payload.issued_at || payload.issuedAt || payload.ts;
  const eventId = payload.event_id || payload.eventId;
  if (!type || !workspace || !eventId || !issuedAt) {
    logger.warn('event_bus_invalid_envelope', { type, workspace: Boolean(workspace), eventId: Boolean(eventId), issuedAt: Boolean(issuedAt) });
    return;
  }
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs) || Math.abs(Date.now() - issuedMs) > EVENT_REPLAY_WINDOW_MS) {
    logger.warn('event_bus_replay_window_rejected', { eventId, type });
    return;
  }
  if (publisher) {
    let accepted;
    try { accepted = await publisher.set(`kcp:event-seen:${workspace}:${eventId}`, '1', 'PX', EVENT_REPLAY_WINDOW_MS, 'NX'); } catch (err) {
      if (config.isProd) { logger.warn('event_dedupe_store_unavailable', { message: err.message }); return; }
      accepted = 'OK';
    }
    if (accepted !== 'OK') return;
  } else {
    if (seenEventIds.has(eventId)) return;
    seenEventIds.add(eventId);
    setTimeout(() => seenEventIds.delete(eventId), EVENT_REPLAY_WINDOW_MS).unref();
  }
  type = canonicalEventName(type);
  payload.type = type;
  resolveWaiters(payload);

  // Invalidate overview cache on significant changes
  if (
    type === EVENTS.SYSTEM_HEALTH_CHANGED ||
    type === EVENTS.AUTONOMY_STATE_CHANGED ||
    type === EVENTS.ORGANISM_STATUS_CHANGED ||
    type === EVENTS.INCIDENT_CREATED
  ) {
    cache.delPrefix('overview:');
  }

  if (rawBroadcast) { try { rawBroadcast(payload); } catch (err) { logger.warn('raw_event_fanout_failed', { message: err.message }); } }

  if (!ioRef) return;

  const nsName = EVENT_NAMESPACE[type] || NAMESPACES.DASHBOARD;
  const nsp = ioRef.of(nsName);
  const room = payload.workspace_id || payload.workspaceId;
  if (!room) {
    logger.warn('event_dropped_missing_workspace', { type });
    return;
  }

  nsp.to(room).emit(type, {
    type,
    ts: payload.ts || new Date().toISOString(),
    data: payload.data !== undefined ? payload.data : payload,
  });

  // Also emit on dashboard for cross-cutting visibility
  if (nsName !== NAMESPACES.DASHBOARD) {
    ioRef.of(NAMESPACES.DASHBOARD).to(room).emit(type, {
      type,
      ts: payload.ts || new Date().toISOString(),
      data: payload.data !== undefined ? payload.data : payload,
    });
  }

  logger.debug('event_fanout', { type, room, namespace: nsName });
}

/**
 * Publish an event (e.g. command results originating at the gateway).
 */
async function publish(type, data, workspaceId) {
  if (!workspaceId) throw new Error('workspaceId is required for event publication');

  const message = JSON.stringify({
    type,
    event_id: data?.event_id || require('node:crypto').randomUUID(),
    issued_at: new Date().toISOString(),
    ts: new Date().toISOString(),
    workspace_id: workspaceId,
    correlation_id: data?.correlation_id || data?.correlationId || data?.request_id || data?.requestId || null,
    command_id: data?.command_id || data?.commandId || null,
    data,
  });

  if (publisher) {
    try {
      await publisher.publish(config.redis.eventChannel, message);
      return;
    } catch (err) {
      logger.warn('event_publish_failed', { message: err.message });
    }
  }

  if (config.isProd) {
    throw new Error('Redis event bus unavailable; refusing local-only event fan-out in production');
  }

  // Development-only local fan-out when Redis is intentionally absent.
  handleIncoming(message);
}

async function stop() {
  try {
    if (subscriber) {
      await subscriber.quit();
      subscriber = null;
    }
    if (publisher) {
      await publisher.quit();
      publisher = null;
    }
  } catch (err) {
    logger.warn('event_bus_stop_error', { message: err.message });
  }
}

function isConnected() {
  return Boolean(subscriber && subscriber.status === 'ready');
}

module.exports = {
  attachSocketServer,
  attachRawBroadcast,
  start,
  stop,
  publish,
  waitForCorrelatedEvent,
  isConnected,
  EVENTS,
};
