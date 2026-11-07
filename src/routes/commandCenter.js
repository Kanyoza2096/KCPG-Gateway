'use strict';

const express = require('express');
const { requireAuth, requireRole, requireWorkspace, requirePlatformRole } = require('../middleware/auth');
const pythonClient = require('../services/pythonClient');
const fs = require('fs');
const path = require('path');
const { contract: commandCenterTruthContract } = require('../contracts/commandCenterTruth');

const router = express.Router();

// ─── WORKSPACE-SCOPED SOURCES ────────────────────────────────────────────
// Every endpoint below requires X-Workspace-ID to be forwarded to Python.
const WORKSPACE_SOURCES = [
  ['systemHealth', '/api/v1/system/health'],
  ['deepHealth', '/api/v1/health/deep'],
  ['status', '/api/v1/status'],
  ['services', '/api/v1/services'],
  ['topology', '/api/v1/topology'],
  ['organismBody', '/api/v1/organism/body'],
  ['organismMind', '/api/v1/organism/mind'],
  ['organismHands', '/api/v1/organism/hands'],
  ['organismVitals', '/api/v1/organism/vitals'],
  ['metabolism', '/api/v1/metabolism/status'],
  ['guardian', '/api/v1/guardian/status'],
  ['circulation', '/api/v1/circulation/status'],
  ['predictions', '/api/v1/predictions/forecast'],
  ['predictionConfidence', '/api/v1/predictions/confidence'],
  ['analytics', '/api/v1/analytics/performance'],
  ['council', '/api/v1/council/statistics'],
  ['workflow', '/api/v1/workflow/status'],
  ['businessAutomation', '/api/v1/business-automation/rules'],
  ['metricsResources', '/api/v1/metrics/resources'],
  ['events', '/api/v1/events/recent'],
  ['alerts', '/api/v1/alerts'],
  ['slo', '/api/v1/slo/health'],
  ['integrations', '/api/v1/integrations/status'],
  // Added to fix UNKNOWN workforce/execution/connectors sections
  ['workforceExecution', '/api/v1/runtime/workforce-execution'],
  ['workforceBridge', '/api/v1/runtime/autonomous-workforce-bridge'],
  ['commandCenterDiagnostics', '/api/v1/command-center/diagnostics'],
  ['commandCenterReadModel', '/api/v1/command-center/read-model'],
  ['systemConnectors', '/api/v1/system/connectors'],
];

// ─── SPECIES-SCOPED SOURCES ──────────────────────────────────────────────
// Platform-wide endpoints. No X-Workspace-ID. Requires species privileges.
const SPECIES_SOURCES = [
  ['systemHealth', '/api/v1/system/health'],
  ['status', '/api/v1/status'],
  ['services', '/api/v1/services'],
  ['topology', '/api/v1/topology'],
  ['metrics', '/api/v1/metrics'],
  ['metricsResources', '/api/v1/metrics/resources'],
  ['slo', '/api/v1/slo/health'],
  ['sloPlatform', '/api/v1/slo/platform'],
  ['migrations', '/api/v1/platform-migrations'],
  ['migrationsPreflight', '/api/v1/platform-migrations/preflight'],
  ['guardian', '/api/v1/guardian/status'],
  ['integrations', '/api/v1/integrations/status'],
  ['commandCenterReadModel', '/api/v1/command-center/read-model'],
  ['commandCenterDiagnostics', '/api/v1/command-center/diagnostics'],
  ['allWorkspaces', '/api/v1/species/workspaces'],
];

// ─── WORKSPACE SECTION DEFINITIONS ───────────────────────────────────────
const WORKSPACE_SECTIONS = {
  situation: ['systemHealth', 'deepHealth', 'status', 'organismVitals', 'organismBody', 'organismMind'],
  readModel: ['commandCenterReadModel', 'workflow', 'council', 'events', 'alerts', 'integrations', 'analytics'],
  health: ['systemHealth', 'deepHealth', 'status', 'slo', 'metabolism', 'guardian', 'circulation', 'services'],
  diagnostics: ['commandCenterDiagnostics', 'events', 'alerts', 'topology', 'metricsResources'],
  workforce: ['workforceExecution', 'workforceBridge', 'workflow', 'events'],
  governance: ['guardian', 'council', 'workflow'],
  execution: ['workforceExecution', 'workflow', 'events', 'analytics'],
  intelligence: ['predictions', 'analytics', 'events'],
  connectors: ['systemConnectors', 'integrations', 'services', 'topology'],
  autonomy: ['guardian', 'council', 'workflow'],
};

// ─── SPECIES SECTION DEFINITIONS ─────────────────────────────────────────
const SPECIES_SECTIONS = {
  platform: ['systemHealth', 'status', 'services', 'topology'],
  workspaces: ['allWorkspaces'],
  platformMetrics: ['metrics', 'metricsResources'],
  platformSlo: ['slo', 'sloPlatform'],
  migrations: ['migrations', 'migrationsPreflight'],
  governance: ['guardian', 'commandCenterReadModel'],
  diagnostics: ['commandCenterDiagnostics', 'integrations'],
};

function classify(status) {
  if (status >= 200 && status < 300) return 'healthy';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'unavailable';
  if (status >= 500) return 'error';
  return 'degraded';
}

function buildSection(sourceKeys, sources) {
  const relevant = sourceKeys.map(k => [k, sources[k]]).filter(([, v]) => v);
  if (relevant.length === 0) {
    return {
      state: 'UNKNOWN',
      authority: 'UNKNOWN',
      observed: 'UNKNOWN',
      evidence: 'NOT_PROVIDED',
      data: null,
    };
  }

  const successful = relevant.filter(([, v]) => v.ok);
  const anyOk = successful.length > 0;

  let state;
  if (successful.length === 0) state = 'UNKNOWN';
  else if (successful.length === relevant.length) state = 'LIVE';
  else state = 'DEGRADED';

  return {
    state,
    authority: anyOk ? 'OBSERVED' : 'UNKNOWN',
    observed: anyOk ? 'LIVE' : 'UNKNOWN',
    evidence: anyOk ? 'PROVIDED' : 'NOT_PROVIDED',
    data: Object.fromEntries(relevant.map(([k, v]) => [k, v.data])),
    sources: relevant.map(([k, v]) => ({ key: k, ok: v.ok, state: v.state, latencyMs: v.latencyMs })),
  };
}

async function fetchSources(sourceList, req, includeWorkspace) {
  return Promise.all(sourceList.map(async ([key, path]) => {
    const started = Date.now();
    try {
      const user = includeWorkspace
        ? { ...req.user, __requestWorkspaceId: req.workspaceId }
        : { ...req.user }; // NO workspace context for species scope
      const result = await pythonClient.callPython({
        method: 'GET',
        path,
        requestId: req.requestId,
        traceparent: req.trace?.traceparent,
        user,
        timeout: 10_000,
      });
      return [key, {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        state: classify(result.status),
        path: path.replace(/^\/api\/v1/, ''),
        latencyMs: Date.now() - started,
        data: result.data ?? null,
      }];
    } catch (error) {
      return [key, {
        ok: false,
        status: Number(error?.details?.status || error?.status || 0),
        state: 'unreachable',
        path: path.replace(/^\/api\/v1/, ''),
        latencyMs: Date.now() - started,
        data: null,
        error: 'UPSTREAM_UNREACHABLE',
      }];
    }
  }));
}

// ─── TRUTH CONTRACT ──────────────────────────────────────────────────────
router.get('/truth-contract', requireAuth, requireRole('viewer'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ...commandCenterTruthContract(),
    workspaceId: req.workspaceId || null,
    scopes: ['workspace', 'species'],
  });
});

// ─── SITUATION (HYBRID) ──────────────────────────────────────────────────
router.get('/situation', requireAuth, requireRole('viewer'), async (req, res, next) => {
  try {
    const scope = String(req.query.scope || 'workspace').toLowerCase();
    const started = Date.now();

    // ─── SPECIES SCOPE ──────────────────────────────────────────────────
    if (scope === 'species') {
      const hasPlatformRead = req.user?.principalType === 'human'
        && ['super_admin', 'operator'].includes(req.user?.platformRole)
        && (req.user?.platformRole === 'super_admin' || (req.user?.platformPermissions || []).includes('platform:workspaces:read'));
      if (!hasPlatformRead) {
        return res.status(403).json({
          ok: false,
          error: 'species_scope_required',
          message: 'Platform scope requires an explicit human platform authority grant.',
        });
      }

      const results = await fetchSources(SPECIES_SOURCES, req, false);
      const sources = Object.fromEntries(results);
      const allSources = Object.values(sources);
      const healthy = allSources.filter(s => s.ok).length;
      const failed = allSources.length - healthy;

      const sections = {};
      for (const [sectionKey, sourceKeys] of Object.entries(SPECIES_SECTIONS)) {
        sections[sectionKey] = buildSection(sourceKeys, sources);
      }

      const requiredSections = ['platform', 'workspaces'];
      const requiredStates = requiredSections.map(k => sections[k]?.state || 'UNKNOWN');
      let overallState;
      if (requiredStates.every(s => s === 'LIVE')) overallState = 'LIVE';
      else if (requiredStates.some(s => s === 'LIVE')) overallState = 'DEGRADED';
      else overallState = 'UNKNOWN';

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        schema: 'CommandCenterSituation/v2',
        scope: 'species',
        generatedAt: new Date().toISOString(),
        workspaceId: null,
        state: overallState,
        latencyMs: Date.now() - started,
        summary: { sourceCount: allSources.length, healthy, failed },
        sections,
        sources,
      });
    }

    // ─── WORKSPACE SCOPE ────────────────────────────────────────────────
    const workspaceId = req.workspaceId || req.user?.__requestWorkspaceId || req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({
        ok: false,
        error: 'workspace_required',
        message: 'Workspace scope requires X-Workspace-ID header or workspace-bound session.',
      });
    }
    req.workspaceId = workspaceId;

    const results = await fetchSources(WORKSPACE_SOURCES, req, true);
    const sources = Object.fromEntries(results);
    const allSources = Object.values(sources);
    const healthy = allSources.filter(s => s.ok).length;
    const failed = allSources.length - healthy;

    const sections = {};
    for (const [sectionKey, sourceKeys] of Object.entries(WORKSPACE_SECTIONS)) {
      sections[sectionKey] = buildSection(sourceKeys, sources);
    }

    const requiredSections = ['situation', 'readModel', 'health', 'diagnostics'];
    const requiredStates = requiredSections.map(k => sections[k].state);
    let overallState;
    if (requiredStates.every(s => s === 'LIVE')) overallState = 'LIVE';
    else if (requiredStates.some(s => s === 'LIVE')) overallState = 'DEGRADED';
    else overallState = 'UNKNOWN';

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      schema: 'CommandCenterSituation/v2',
      scope: 'workspace',
      generatedAt: new Date().toISOString(),
      workspaceId,
      state: overallState,
      latencyMs: Date.now() - started,
      summary: {
        sourceCount: allSources.length,
        healthy,
        failed,
        required: requiredSections.length,
        usable: requiredStates.filter(s => s === 'LIVE').length,
        unknown: requiredStates.filter(s => s === 'UNKNOWN').length,
      },
      sections,
      sources,
    });
  } catch (err) {
    next(err);
  }
});

// ─── ROUTES METADATA ─────────────────────────────────────────────────────
router.get('/routes', requireAuth, requireRole('viewer'), (req, res) => {
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../contracts/kanyoza-route-manifest.v1.json'), 'utf8'));
  } catch {
    manifest = { schema: 'KanyozaRouteManifest/v1', routes: [], unavailable: true };
  }
  res.json({
    schema: 'CommandCenterRouteContract/v2',
    canonicalPrefix: '/api/v1',
    snapshot: {
      generatedFrom: manifest.generatedFrom,
      routeCount: manifest.routes.length,
      duplicates: manifest.duplicates?.length || 0,
    },
    authority: {
      role: req.user?.role || 'unknown',
      workspaceId: req.workspaceId || null,
      roleIsNotCommandReadiness: true,
    },
    sources: {
      workspace: WORKSPACE_SOURCES.map(([key, sourcePath]) => ({
        key,
        method: 'GET',
        path: sourcePath.replace(/^\/api\/v1/, ''),
      })),
      species: SPECIES_SOURCES.map(([key, sourcePath]) => ({
        key,
        method: 'GET',
        path: sourcePath.replace(/^\/api\/v1/, ''),
      })),
    },
    backendRoutes: manifest.routes.map(({ method, path: routePath, module, function: fn }) => ({
      method,
      path: routePath.replace(/^\/api\/v1/, ''),
      module,
      function: fn,
    })),
  });
});

module.exports = router;
