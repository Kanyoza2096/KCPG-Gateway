'use strict';

const express = require('express');
const { requireAuth, requireRole, requireWorkspace } = require('../middleware/auth');
const authorityGuard = require('../services/authorityGuard');

const router = express.Router();

router.get('/guardian', requireAuth, requireRole('viewer'), async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, guardian: await authorityGuard.getGuardian() });
});

router.post('/guardian/lock', requireAuth, requireRole('owner'), async (req, res) => {
  const guardian = await authorityGuard.lock(req.body?.reason, req.user.sub);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, guardian, revoked: true });
});

router.post('/guardian/unlock', requireAuth, requireRole('owner'), async (req, res) => {
  const guardian = await authorityGuard.unlock(req.user.sub);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, guardian });
});

router.post('/leases', requireAuth, requireRole('operator'), requireWorkspace, async (req, res) => {
  const level = String(req.body?.autonomy_level || '').toUpperCase();
  if (!['L3', 'L4'].includes(level)) return res.status(400).json({ ok: false, error: { code: 'INVALID_AUTONOMY_LEVEL', message: 'Only L3/L4 command leases are issued here' } });
  if (!(req.user?.scopes || []).includes('autonomy.execute') && !(req.user?.scopes || []).includes('*')) return res.status(403).json({ ok: false, error: { code: 'AUTONOMY_SCOPE_REQUIRED' } });
  const lease = await authorityGuard.issueLease({ actorId: req.user.sub, workspaceId: req.workspaceId, autonomyLevel: level, ttlMs: req.body?.ttl_ms });
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({ ok: true, lease });
});

router.delete('/leases/:leaseId', requireAuth, requireRole('operator'), async (req, res) => {
  const result = await authorityGuard.releaseLease(req.params.leaseId, req.user.sub);
  if (!result.released) return res.status(404).json({ ok: false, error: { code: result.code } });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, lease: result.lease });
});

module.exports = router;
