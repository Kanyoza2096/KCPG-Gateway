'use strict';

const express = require('express');
const { requireAuth, requireRole, requireWorkspace } = require('../middleware/auth');
const pythonClient = require('../services/pythonClient');

const router = express.Router();

const PROBES = [
  ['systemHealth', '/api/v1/system/health'],
  ['organismVitals', '/api/v1/organism/vitals'],
  ['dashboardLive', '/api/v1/dashboard/live'],
  ['services', '/api/v1/services'],
];

function classify(status) {
  if (status >= 200 && status < 300) return 'PASS';
  if (status === 401 || status === 403) return 'AUTH_FAILURE';
  if (status === 404) return 'ROUTE_UNAVAILABLE';
  if (status >= 500) return 'UPSTREAM_ERROR';
  return 'DEGRADED';
}

function summarizeData(data) {
  if (data === null || data === undefined) return { kind: 'null' };
  if (Array.isArray(data)) return { kind: 'array', count: data.length };
  if (typeof data === 'object') return { kind: 'object', keys: Object.keys(data).slice(0, 30) };
  return { kind: typeof data };
}

router.get('/diagnostics', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const results = await Promise.all(PROBES.map(async ([key, target]) => {
      const started = Date.now();
      try {
        const result = await pythonClient.callPython({
          method: 'GET',
          path: target,
          requestId: req.requestId,
          traceparent: req.trace?.traceparent,
          user: { ...req.user, __requestWorkspaceId: req.workspaceId },
          timeout: 10_000,
        });
        return [key, {
          method: 'GET',
          target: target.replace(/^\/api\/v1/, ''),
          status: result.status,
          result: classify(result.status),
          latencyMs: Date.now() - started,
          data: summarizeData(result.data),
        }];
      } catch (error) {
        const status = Number(error?.details?.status || error?.status || 0);
        return [key, {
          method: 'GET',
          target: target.replace(/^\/api\/v1/, ''),
          status,
          result: status ? classify(status) : 'UNREACHABLE',
          latencyMs: Date.now() - started,
          data: { kind: 'unavailable' },
        }];
      }
    }));

    const probes = Object.fromEntries(results);
    const values = Object.values(probes);
    const passed = values.filter((v) => v.result === 'PASS').length;
    const failed = values.length - passed;
    const organism = probes.organismVitals;
    const organismVerified = organism?.result === 'PASS';

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      schema: 'CommandCenterRuntimeDiagnostics/v1',
      generatedAt: new Date().toISOString(),
      workspaceId: req.workspaceId,
      summary: {
        probeCount: values.length,
        passed,
        failed,
        state: failed === 0 ? 'LIVE' : passed === 0 ? 'UNKNOWN' : 'DEGRADED',
        organismReachable: organism?.result === 'PASS',
        organismEndpointVerified: organismVerified,
      },
      probes,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
