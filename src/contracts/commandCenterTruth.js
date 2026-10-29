'use strict';

const express = require('express');
const { requireAuthOrSuperuser, requireRoleOrSuperuser, requireWorkspace } = require('../middleware/auth');
const pythonClient = require('../services/pythonClient');
const fs = require('fs');
const path = require('path');
const { SECTION_DEFINITIONS, contract: commandCenterTruthContract } = require('../contracts/commandCenterTruth');

const router = express.Router();

// The raw sources that feed the truth sections.
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

function classify(status) {
  if (status >= 200 && status < 300) return 'healthy';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'unavailable';
  if (status >= 500) return 'error';
  return 'degraded';
}

// ─────────────────────────────────────────────────────────────────────────
// TRANSFORMERS: Map raw sources to the 10 sections the UI expects.
// Each section returns an object with:
//   - state: 'LIVE' | 'DEGRADED' | 'UNKNOWN'
//   - authority: string (from commandCenterTruth.js definition)
//   - observed: 'LIVE' | 'UNKNOWN'
//   - evidence: 'PROVIDED' | 'NOT_PROVIDED'
//   - data: the aggregated payload
// ─────────────────────────────────────────────────────────────────────────

function buildSections(sources) {
  const sections = {};

  for (const [sectionKey, definition] of Object.entries(SECTION_DEFINITIONS)) {
    const relevantSources = definition.sourceKeys
      .map((key) => [key, sources[key]])
      .filter(([, source]) => source);

    if (relevantSources.length === 0) {
      sections[sectionKey] = {
        state: 'UNKNOWN',
        authority: definition.authority,
        observed: 'UNKNOWN',
        evidence: 'NOT_PROVIDED',
        data: null,
      };
      continue;
    }

    const successes = relevantSources.filter(([, s]) => s.ok);
    const failures = relevantSources.filter(([, s]) => !s.ok);
    const total = relevantSources.length;
    const successful = successes.length;

    let state;
    if (successful === 0) {
      state = 'UNKNOWN';
    } else if (failures.length > 0) {
      state = 'DEGRADED';
    } else {
      state = 'LIVE';
    }

    sections[sectionKey] = {
      state,
      authority: definition.authority,
      observed: successful > 0 ? 'LIVE' : 'UNKNOWN',
      evidence: successful > 0 ? 'PROVIDED' : 'NOT_PROVIDED',
      data: Object.fromEntries(relevantSources.map(([key, source]) => [key, source.data])),
      sources: relevantSources.map(([key, source]) => ({
        key,
        ok: source.ok,
        state: source.state,
        latencyMs: source.latencyMs,
      })),
    };
  }

  return sections;
}

// ─────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────

router.get('/truth-contract', requireAuthOrSuperuser, requireRoleOrSuperuser('viewer'), requireWorkspace, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ...commandCenterTruthContract(),
    workspaceId: req.workspaceId,
    // The UI expects the contract to be hydrated with the *current* state.
    // We don't return state here; that's what /situation is for.
    // This endpoint is the schema, the situation endpoint is the data.
  });
});

router.get('/situation', requireAuthOrSuperuser, requireRoleOrSuperuser('viewer'), requireWorkspace, async (req, res, next) => {
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
          user: {
            ...req.user,
            __requestWorkspaceId: req.workspaceId,
            workspaceId: req.workspaceId,
            workspaceIds: [req.workspaceId],
          },
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
    const sections = buildSections(sources);

    // Compute overall state from the sections
    const sectionStates = Object.values(sections).map((s) => s.state);
    const liveSections = sectionStates.filter((s) => s === 'LIVE').length;
    const degradedSections = sectionStates.filter((s) => s === 'DEGRADED').length;
    const unknownSections = sectionStates.filter((s) => s === 'UNKNOWN').length;

    let overallState;
    if (liveSections === 0) {
      overallState = 'UNKNOWN';
    } else if (unknownSections === 0 && degradedSections === 0) {
      overallState = 'LIVE';
    } else {
      overallState = 'DEGRADED';
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      schema: 'CommandCenterSituation/v2',
      generatedAt: new Date().toISOString(),
      workspaceId: req.workspaceId,
      state: overallState,
      latencyMs: Date.now() - started,
      summary: {
        totalSections: Object.keys(sections).length,
        liveSections,
        degradedSections,
        unknownSections,
      },
      sections,
      rawSources: sources, // Keep the raw sources for debugging
    });
  } catch (err) {
    next(err);
  }
});

router.get('/routes', requireAuthOrSuperuser, requireRoleOrSuperuser('viewer'), (req, res) => {
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
