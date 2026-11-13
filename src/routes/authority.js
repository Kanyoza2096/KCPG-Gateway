'use strict';

const express = require('express');
const { requireAuth, requireRole, requireWorkspace, requirePlatformRole } = require('../middleware/auth');
const authorityGuard = require('../services/authorityGuard');

const router = express.Router();

// Read-only proof of the platform grant carried by the authenticated Gateway
// session. The session is minted only after the canonical backend identity
// exchange; requireAuth verifies the Gateway signature before these claims are
// exposed. This route intentionally does not accept caller-supplied identity.
router.get('/platform-check', requireAuth, (req, res) => {
  const isHumanSuperAdmin = req.user?.principalType === 'human'
    && req.user?.platformRole === 'super_admin';
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie, Authorization');
  return res.json({
    ok: true,
    authorized: isHumanSuperAdmin,
    authority_type: isHumanSuperAdmin ? 'human_platform_super_admin' : null,
    principal_type: req.user?.principalType || 'unknown',
    platform_role: req.user?.platformRole || null,
    grant_source: 'canonical_identity_exchange',
    read_only: true,
  });
});

router.get('/guardian', requireAuth, requireRole('viewer'), async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, guardian: await authorityGuard.getGuardian() });
});

router.post('/guardian/lock', requireAuth, requirePlatformRole('super_admin'), async (req, res) => {
  const guardian = await authorityGuard.lock(req.body?.reason, req.user.sub);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, guardian, revoked: true });
});

router.post('/guardian/unlock', requireAuth, requirePlatformRole('super_admin'), async (req, res) => {
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
