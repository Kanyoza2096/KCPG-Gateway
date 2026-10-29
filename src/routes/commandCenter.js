'use strict';

const express = require('express');
const { requireAuth, requireRole, requireWorkspace } = require('../middleware/auth');
const pythonClient = require('../services/pythonClient');
const fs = require('fs');
const path = require('path');
const { contract: commandCenterTruthContract } = require('../contracts/commandCenterTruth');

const router = express.Router();

// Canonical read model for the ICC/KDO.
const SOURCES = [
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
];

// Required sections for the UI's Truth Certification
const SECTION_DEFINITIONS = {
  situation: ['systemHealth', 'deepHealth', 'status', 'organismVitals', 'organismBody', 'organismMind'],
  readModel: ['workflow', 'council', 'events', 'alerts', 'integrations', 'analytics'],
  health: ['systemHealth', 'deepHealth', 'status', 'slo', 'metabolism', 'guardian', 'circulation', 'services'],
  diagnostics: ['events', 'alerts', 'topology', 'metricsResources'],
  // Optional extended sections
  workforce: ['workflow', 'events'],
  governance: ['guardian', 'council', 'workflow'],
  execution: ['workflow', 'events', 'analytics'],
  intelligence: ['predictions', 'analytics', 'events'],
  connectors: ['integrations', 'services', 'topology'],
  autonomy: ['guardian', 'council', 'workflow'],
};

function classify(status) {
  if (status >= 200 && status < 300) return 'healthy';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'unavailable';
  if (status >= 500) return 'error';
  return 'degraded';
}

function buildSection(sectionKey, sourceKeys, sources) {
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

router.get('/truth-contract', requireAuth, requireRole('viewer'), requireWorkspace, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...commandCenterTruthContract(), workspaceId: req.workspaceId });
});

router.get('/situation', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const started = Date.now();
    const results = await Promise.all(SOURCES.map(async ([key, path]) => {
      const sourceStarted = Date.now();
      try {
        const result = await pythonClient.callPython({
          method: 'GET',
          path,
          requestId: req.requestId,
          traceparent: req.trace?.traceparent,
          user: { ...req.user, __requestWorkspaceId: req.workspaceId },
          timeout: 10_000,
        });
        return [key, {
          ok: result.status >= 200 && result.status < 300,
          status: result.status,
          state: classify(result.status),
          path: path.replace(/^\/api\/v1/, ''),
          latencyMs: Date.now() - sourceStarted,
          data: result.data ?? null,
        }];
      } catch (error) {
        return [key, {
          ok: false,
          status: Number(error?.details?.status || error?.status || 0),
          state: 'unreachable',
          path: path.replace(/^\/api\/v1/, ''),
          latencyMs: Date.now() - sourceStarted,
          data: null,
          error: 'UPSTREAM_UNREACHABLE',
        }];
      }
    }));

    const sources = Object.fromEntries(results);
    const allSources = Object.values(sources);
    const healthy = allSources.filter((s) => s.ok).length;
    const failed = allSources.length - healthy;

    // Build the sections the UI requires
    const sections = {};
    for (const [sectionKey, sourceKeys] of Object.entries(SECTION_DEFINITIONS)) {
      sections[sectionKey] = buildSection(sectionKey, sourceKeys, sources);
    }

    // Determine overall state based on required sections
    const requiredSections = ['situation', 'readModel', 'health', 'diagnostics'];
    const requiredStates = requiredSections.map(k => sections[k].state);
    
    let overallState;
    if (requiredStates.every(s => s === 'LIVE')) overallState = 'LIVE';
    else if (requiredStates.some(s => s === 'LIVE')) overallState = 'DEGRADED';
    else overallState = 'UNKNOWN';

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      schema: 'CommandCenterSituation/v2',
      generatedAt: new Date().toISOString(),
      workspaceId: req.workspaceId,
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
      sources, // Raw sources kept for debugging
    });
  } catch (err) {
    next(err);
  }
});

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
    snapshot: { generatedFrom: manifest.generatedFrom, routeCount: manifest.routes.length, duplicates: manifest.duplicates?.length || 0 },
    authority: { role: req.user?.role || 'unknown', workspaceId: req.workspaceId || null, roleIsNotCommandReadiness: true },
    sources: SOURCES.map(([key, sourcePath]) => ({ key, method: 'GET', path: sourcePath.replace(/^\/api\/v1/, '') })),
    backendRoutes: manifest.routes.map(({ method, path: routePath, module, function: fn }) => ({ method, path: routePath.replace(/^\/api\/v1/, ''), module, function: fn })),
  });
});

module.exports = router;
