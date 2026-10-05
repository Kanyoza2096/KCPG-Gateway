'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const aggregator = require('../services/aggregator');
const pythonClient = require('../services/pythonClient');
const metrics = require('../services/metrics');
const resourceState = require('../services/resourceState');
const { requireWorkspace } = require('../middleware/auth');

const router = express.Router();


/** Canonical resource state: desired + observed + provenance + reconciliation. */
router.get('/state/:kind/:id', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const resource = await resourceState.get(req.workspaceId, req.params.kind, req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json(resource);
  } catch (err) { next(err); }
});

/** Change desired state only; execution remains a controller responsibility. */
router.put('/state/:kind/:id/spec', requireAuth, requireRole('operator'), requireWorkspace, async (req, res, next) => {
  try {
    const desiredState = typeof req.body?.desired_state === 'string' ? req.body.desired_state : null;
    if (!desiredState) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'desired_state is required' } });
    const resource = await resourceState.setDesired({
      workspaceId: req.workspaceId,
      kind: req.params.kind,
      id: req.params.id,
      desiredState,
      mode: req.body?.mode,
      config: req.body?.config,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, resource, reconciliation: resourceState.reconcile(resource) });
  } catch (err) { next(err); }
});

router.get('/state/:kind/:id/reconcile', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const resource = await resourceState.get(req.workspaceId, req.params.kind, req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ resource, reconciliation: resourceState.reconcile(resource) });
  } catch (err) { next(err); }
});

/** Process-local gateway telemetry. Never represents a fleet aggregate. */
router.get('/gateway/slo', requireAuth, requireRole('viewer'), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const target = Number(req.query.availability_target);
  const latency = Number(req.query.latency_target_seconds);
  res.json({
    source: 'gateway-process',
    authoritative: true,
    scope: 'instance',
    data: metrics.sloSnapshot({
      targetAvailability: Number.isFinite(target) && target > 0 && target <= 1 ? target : 0.995,
      latencySeconds: Number.isFinite(latency) && latency > 0 && latency <= 60 ? latency : 0.5,
    }),
  });
});

router.get('/gateway/observability', requireAuth, requireRole('viewer'), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    source: 'gateway-process',
    authoritative: true,
    scope: 'instance',
    ts: new Date().toISOString(),
    data: metrics.snapshot(),
  });
});

/**
 * GET /api/v1/control-plane/overview
 * Aggregated Command Center payload from organism body + scale + council.
 */
router.get('/overview', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const overview = await aggregator.getOverview({
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: req.workspaceId },
    });
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

/** Full organism body (passthrough to core) */
router.get('/organism/body', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const result = await pythonClient.callPython({
      method: 'GET',
      path: '/api/v1/organism/body',
      query: {
        workspace_id: req.workspaceId,
      },
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: req.workspaceId },
    });
    res.status(result.status).json(result.data ?? {});
  } catch (err) {
    next(err);
  }
});

router.get('/species/scale', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const result = await pythonClient.callPython({
      method: 'GET',
      path: '/api/v1/species/scale',
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: req.workspaceId },
    });
    res.status(result.status).json(result.data ?? {});
  } catch (err) {
    next(err);
  }
});

router.get('/council/status', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const result = await pythonClient.callPython({
      method: 'GET',
      path: '/api/v1/council/status',
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: req.workspaceId },
    });
    res.status(result.status).json(result.data ?? {});
  } catch (err) {
    next(err);
  }
});

/** Legacy aliases kept for earlier KCPG docs */
router.get('/autonomy', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const overview = await aggregator.getOverview({
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: req.workspaceId },
    });
    res.json(overview.autonomy || {});
  } catch (err) {
    next(err);
  }
});

router.get('/engines', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const overview = await aggregator.getOverview({
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: req.workspaceId },
    });
    res.json(overview.engines || {});
  } catch (err) {
    next(err);
  }
});

router.get('/organisms', requireAuth, requireRole('viewer'), requireWorkspace, async (req, res, next) => {
  try {
    const overview = await aggregator.getOverview({
      requestId: req.requestId,
      traceparent: req.trace?.traceparent,
      user: { ...req.user, __requestWorkspaceId: req.workspaceId },
    });
    res.json(overview.organisms || {});
  } catch (err) {
    next(err);
  }
});

module.exports = router;
