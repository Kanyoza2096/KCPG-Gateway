# KCPG Phase 8 — Control Gateway Deep Audit

## Scope

Audited the supplied `kcpg-0.1.1.zip` as the authoritative Node.js Control Gateway source.
The audit traced HTTP auth, workspace propagation, command authorization, proxying, Python trust-boundary headers, Socket.IO authentication/rooms, Redis event fan-out, readiness, configuration, and rate limiting.

## Critical findings fixed

1. **Credential leakage through URL/query parameters**
   - HTTP `?token=` fallback removed.
   - Socket.IO `handshake.query.token` fallback removed.
   - Documentation updated.

2. **Cross-tenant realtime broadcast risk**
   - Sockets no longer auto-join a global room.
   - Room joins are limited to workspace IDs present in authenticated claims.
   - Global wildcard workspace access now requires an explicit workspace scope.
   - Events without a workspace ID are dropped rather than broadcast globally.

3. **Workspace override risk**
   - Control Plane organism-body route no longer trusts `?workspace_id` from the browser.
   - Command payload workspace IDs must match the authenticated workspace.

4. **Semantic command drift**
   - Removed commands whose labels did not map 1:1 to real backend operations (`autonomy.resume`, `service.restart`, `incident.ack`).
   - Commands now declare scopes.
   - Command policy enforces role + scope + workspace requirements.

5. **Legacy credential hierarchy**
   - Production gateway now requires a dedicated `PYTHON_SERVICE_TOKEN`.
   - Legacy `MASTER_API_TOKEN` / `PYTHON_INTERNAL_TOKEN` fallback was removed from the gateway configuration.
   - Python client no longer sends legacy `X-API-Key` / `X-Internal-Token` duplicates.

6. **Production escape-hatch proxy**
   - Proxy is disabled by default and explicitly forbidden in production.
   - Proxy query credentials are stripped before forwarding.

7. **Realtime fail-open behavior**
   - Production no longer performs local-only event fan-out when Redis is unavailable.
   - Production startup fails when required Redis cannot initialize.

8. **Production readiness semantics**
   - `/health/ready` is no longer unconditionally HTTP 200.
   - Redis requirement and Python reachability participate in readiness.

9. **Multi-instance rate limiting**
   - Added Redis-backed `express-rate-limit` stores for production.
   - Production startup initializes the stores and fails if required Redis cannot be reached.

10. **Production caching truth**
    - In-process overview caching is disabled in production to avoid stale per-instance authority.

## Validation performed

- Node syntax compilation across all source files: PASS.
- Phase 8 static security-boundary tests: **7/7 PASS**.
- Search for removed URL-token patterns: PASS.
- Command semantic-alias scan: PASS.
- Workspace/global-room boundary scan: PASS.

## Environment limitation

The sandbox did not have the npm dependency tree or network access to install it. `npm install --ignore-scripts --no-audit --no-fund` timed out, and offline package-lock generation failed because the npm registry metadata was not cached.

Therefore the existing dependency-backed KCPG test suite was **not claimed as executed** in this environment. Before production deployment, run:

```bash
npm install
npm test
npm audit --omit=dev
```

and commit the generated `package-lock.json` so production can use deterministic `npm ci`.

## Remaining production gates

- Use a real staging Redis and run multi-instance rate-limit/realtime tests.
- Verify JWT issuer/signing-key lifecycle with the real identity provider.
- Verify Python core accepts the dedicated service credential and cannot be reached publicly.
- Run cross-workspace integration tests with real identities and RLS.
- Run end-to-end UI → gateway → Python → outbox → worker → connector verification.
- Generate and commit `package-lock.json` from the production Node/npm toolchain.

## Result

The supplied gateway was **not production-ready as received**. The Phase 8 patch closes several concrete security and authority gaps and establishes a much stronger Control Plane boundary, but live infrastructure and dependency-lock validation remain mandatory before a production certification.
