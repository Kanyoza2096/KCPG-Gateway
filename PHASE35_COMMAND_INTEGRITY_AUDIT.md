# Phase 35 — Command Integrity Boundary

## Verified source path
UI command -> KCPG `/api/v1/commands/:id` -> `commandPolicy.executeCommand` -> allowlisted Python path -> command result event.

## Hardening applied
- Command workspace is resolved from the requested workspace only when it is already authorized for the authenticated user.
- Workspace is injected into the upstream command context and cannot be silently replaced by the user's primary workspace.
- Command result events now carry the originating request/correlation ID and authorized workspace.
- Command responses expose `X-Command-Id` and `X-Request-Id` for operator-side tracing.
- Existing role/scope allowlist remains authoritative.

## Important certification boundary
This does NOT prove that the Python endpoint or engine action exists or succeeds. The supplied Phase 35 integration review identifies `publish.dry_run` and `director.hands` as targeting backend routes that were not mounted, while `autonomy.pause` maps to the real workflow pause route.

## Required live proof
1. Authenticated operator selects workspace.
2. KCPG accepts only an authorized workspace.
3. Python receives the request with correlation ID and workspace context.
4. Target engine performs the action.
5. Resulting event returns with the same correlation ID.
6. Control Plane confirms actual resulting state, not merely HTTP 200.


## Phase 38 bridge hardening
The gateway now exposes a dedicated Python-service event ingress. A 2xx command
response is no longer promoted to `completed`; the transaction remains
`verifying` until a workspace-scoped, correlation-matched resulting event is
received. Resource state may be updated from an event resource envelope.
