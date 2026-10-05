# Phase 64 — Server Authority, Guardian & Autonomous Actuation Gate

## Objective
Move the critical autonomy and Guardian enforcement boundary from the browser into KCPG, the authoritative command gateway.

## Guarantees
- Global Guardian lock is checked server-side before mutation.
- L0-L2 remain human-controlled/approval-oriented.
- L3/L4 require `autonomy.execute` scope.
- L3/L4 require bounded-action proof, dry-run proof, and verification support.
- L3/L4 require a short-lived, workspace-scoped command lease issued by KCPG.
- Command transactions persist autonomy level and lease identity for audit/reconciliation.
- Guardian and lease state use Redis in production/required-Redis mode, with process-local fallback only in non-production.
- Existing transaction idempotency and event reconciliation remain authoritative.

## Emergency control surface
- `GET /api/v1/control-plane/authority/guardian`
- `POST /api/v1/control-plane/authority/guardian/lock`
- `POST /api/v1/control-plane/authority/guardian/unlock`
- `POST /api/v1/control-plane/authority/leases`

The lock is fail-closed for non-read mutations. Unlock requires owner authority.

## Autonomous execution contract
An L3/L4 request must carry:
- `autonomy_level`: `L3` or `L4`
- `action_bounded: true`
- `dry_run: true`
- `verification_supported: true`
- `command_lease_id`: active lease matching actor, workspace and requested autonomy level

The browser may provide defense-in-depth checks, but KDO cannot grant authority that KCPG rejects.

## Verification rule
HTTP 2xx remains dispatch acknowledgement, not completion, for event-verified commands. Completion requires correlated authoritative evidence already handled by the durable command transaction path.

## Next gate
Phase 65 should add lease fencing/renewal, explicit cancellation of in-flight autonomous work, signed Guardian state propagation to KDO, and automated fault-injection tests for lock races, Redis loss, duplicate dispatch, delayed events and stale verification.
