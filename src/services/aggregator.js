'use strict';

const config = require('../config');
const { cache } = require('./cache');
const pythonClient = require('./pythonClient');
const eventBus = require('./eventBus');
const logger = require('../utils/logger');

/**
 * Build Control Plane overview from real Python core endpoints.
 *
 * Primary: GET /api/v1/organism/body
 * Secondary: /api/v1/species/scale, /api/v1/council/status, /health/ready, /api/v1/status
 * Soft-fails individual sections so one down path does not blank the UI.
 */
async function getOverview({ requestId, traceparent, user } = {}) {
  const workspaceId = user?.__requestWorkspaceId || user?.workspaceId || null;
  if (!workspaceId) throw new Error('Workspace context required for Control Plane overview');
  const cacheKey = `overview:${workspaceId}`;
  const cached = config.cache.enabled ? cache.get(cacheKey) : undefined;
  if (cached) return { ...cached, cached: true };

  const ctx = { requestId, traceparent, user, workspaceId };

  const [live, publicStatus, body, scale, council, ready] = await Promise.all([
    safeSection('live', () => pythonClient.ping()),
    safeSection('publicStatus', () => pythonClient.publicStatus()),
    safeSection('body', () => fetchOrganismBody(ctx)),
    safeSection('scale', () => fetchSpeciesScale(ctx)),
    safeSection('council', () => fetchCouncilStatus(ctx)),
    safeSection('ready', () => fetchReady(ctx)),
  ]);

  const pythonOk = Boolean(live?.ok);
  const platform = buildPlatform({ live, publicStatus, ready, body });
  const posture = buildPosture({ live, publicStatus, ready, body });
  const autonomy = buildAutonomy(body);
  const organisms = buildOrganisms(scale, body);
  const engines = buildEngines(body, council);
  const llm = buildLlm(ready);
  const incidents = { critical: null, warning: null };

  const overview = {
    ts: new Date().toISOString(),
    cached: false,
    workspace_id: workspaceId,
    posture,
    gateway: {
      redis: eventBus.isConnected(),
      pythonReachable: pythonOk,
    },
    platform,
    autonomy,
    organisms,
    engines,
    llm,
    incidents,
    detail: {
      organism_body: body || null,
      species_scale: scale || null,
      council: council || null,
    },
  };

  if (config.cache.enabled) cache.set(cacheKey, overview, config.cache.overviewTtlMs);
  return overview;
}

function safeSection(name, fn) {
  return fn().catch((err) => {
    logger.warn('aggregator_section_failed', { section: name, message: err.message });
    return null;
  });
}

async function fetchOrganismBody(ctx) {
  const res = await pythonClient.callPython({
    method: 'GET',
    path: '/api/v1/organism/body',
    query: { workspace_id: ctx.workspaceId },
    requestId: ctx.requestId,
    traceparent: ctx.traceparent,
    user: ctx.user,
  });
  if (res.status >= 200 && res.status < 300) return res.data;
  if (res.status === 401 || res.status === 403) {
    logger.warn('organism_body_auth', { status: res.status });
  }
  return null;
}

async function fetchSpeciesScale(ctx) {
  const res = await pythonClient.callPython({
    method: 'GET',
    path: '/api/v1/species/scale',
    requestId: ctx.requestId,
    traceparent: ctx.traceparent,
    user: ctx.user,
  });
  if (res.status >= 200 && res.status < 300) return res.data;
  return null;
}

async function fetchCouncilStatus(ctx) {
  const res = await pythonClient.callPython({
    method: 'GET',
    path: '/api/v1/council/status',
    requestId: ctx.requestId,
    traceparent: ctx.traceparent,
    user: ctx.user,
  });
  if (res.status >= 200 && res.status < 300) return res.data;
  return null;
}

async function fetchReady(ctx) {
  const res = await pythonClient.callPython({
    method: 'GET',
    path: '/health/ready',
    requestId: ctx.requestId,
    traceparent: ctx.traceparent,
    user: ctx.user,
    timeout: 10_000,
  });
  if (res.status >= 200 && res.status < 300) return res.data;
  if (res.data && typeof res.data === 'object') return res.data;
  return null;
}

function buildPlatform({ live, publicStatus, ready, body }) {
  if (!live?.ok) {
    return { status: 'unreachable', flow_score: null, version: null };
  }
  const statusFromReady =
    ready?.status ||
    (ready && ready.reason ? 'not_ready' : null) ||
    publicStatus?.data?.status ||
    'nominal';
  const bus = body?.vitals?.bus;
  return {
    status: statusFromReady === 'ok' || statusFromReady === 'alive' ? 'nominal' : statusFromReady,
    flow_score: null,
    version: live?.data?.version || publicStatus?.data?.version || null,
    bus: bus || null,
  };
}

function buildPosture({ live, publicStatus, ready, body }) {
  if (!live?.ok) return 'critical';
  if (ready) {
    const status = ready.status || '';
    if (status === 'not_ready' || status === 'degraded') return 'degraded';
    if (status === 'ready' || status === 'alive' || status === 'ok') return 'healthy';
  }
  if (publicStatus?.data?.status === 'degraded') return 'degraded';
  if (body?.vitals?.status === 'unhealthy') return 'critical';
  if (body?.vitals?.status === 'degraded') return 'degraded';
  if (body?.vitals?.status === 'healthy' || body?.vitals?.status === 'nominal') return 'healthy';
  if (live?.ok) return 'healthy';
  return 'unknown';
}

function buildAutonomy(body) {
  if (!body) {
    return { active: null, decisions_today: null };
  }
  const metabolism = body?.vitals?.metabolism;
  const mindRecent = body?.mind?.recent;
  return {
    active: metabolism?.active ?? metabolism?.enabled ?? null,
    decisions_today: Array.isArray(mindRecent) ? mindRecent.length : null,
    metabolism: metabolism || null,
  };
}

function buildOrganisms(scale, body) {
  if (scale) {
    const census = scale.census_count;
    return {
      healthy: census != null ? census : null,
      degraded: null,
      total: census != null ? census : null,
      role: scale.role || scale.service_mode || null,
      environment: scale.environment || null,
      is_production: scale.is_production ?? null,
    };
  }
  const org = body?.vitals?.organism;
  if (org) {
    return {
      healthy: org.status === 'healthy' ? 1 : 0,
      degraded: org.status && org.status !== 'healthy' ? 1 : 0,
      total: 1,
      organism: org,
    };
  }
  return { healthy: null, degraded: null, total: null };
}

function buildEngines(body, council) {
  const mind = body?.mind?.recent;
  const hasDirectorSignal =
    Array.isArray(mind) &&
    mind.some((e) => {
      const n = e?.event_name || e?.type || e?.name || '';
      return String(n).includes('director');
    });
  const councilStatus =
    council?.status || council?.state || (council ? 'running' : 'unknown');

  return {
    director: hasDirectorSignal ? 'running' : body ? 'unknown' : 'unknown',
    condition: body?.vitals ? 'unknown' : 'unknown',
    meta: 'unknown',
    council: councilStatus,
  };
}

function buildLlm(ready) {
  if (!ready || typeof ready !== 'object') {
    return { provider: 'unknown', requests_today: null };
  }
  const intel = ready.intelligence || ready.dimensions?.intelligence || ready.intel;
  if (intel && typeof intel === 'object') {
    return {
      provider: intel.mode || intel.status || 'unknown',
      requests_today: null,
      detail: intel,
    };
  }
  if (typeof intel === 'string') {
    return { provider: intel, requests_today: null };
  }
  return { provider: 'unknown', requests_today: null };
}

module.exports = {
  getOverview,
};
