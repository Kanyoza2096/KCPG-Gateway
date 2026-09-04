# Phase 39 — Authority Hardening

## Objective

Upgrade KCPG from a hardened API edge into an authoritative, generation-safe control plane for the autonomous core.

## Implemented

- Workspace context is mandatory for authoritative Control Plane data routes; no implicit `platform` fallback.
- Idempotency is scoped to actor + workspace + command + key and stored durably in Redis in production.
- Transaction creation uses Redis `SET NX`; state transitions use optimistic compare-and-set semantics.
- Upstream transport failures become `uncertain`, not falsely `failed`.
- Verification transactions have a bounded deadline and transition to `uncertain` when evidence never arrives.
- Commands carry a unique transaction identity to the Python boundary via `X-Command-ID`.
- Command contracts declare expected result event types and, where applicable, expected resulting state.
- Internal event envelopes are authenticated, time-bounded, workspace/correlation checked, and replay-aware.
- Event fan-out requires an event ID, issued timestamp, and workspace; Redis-backed deduplication prevents duplicate event processing.
- Resource observations carry their own `observed_generation`; stale generations cannot roll state backwards.
- Desired-state generation updates use Redis optimistic concurrency rather than GET/increment/SET races.
- Production resource and transaction authority fails closed when Redis is unavailable instead of silently diverging across instances.
- BFF rejects conflicting workspace selectors and requires `control.read` for sensitive read surfaces.
- CORS exposes the correlation/workspace headers required by the browser contract.
- Raw WebSocket subscriptions now enforce topic filters.
- Render configuration supplies the required metrics secret and explicit proxy trust.
- Added Phase 39 regression tests covering the new authority invariants.

## Remaining external certification

The archive cannot prove live staging behavior without the real Python core, credentials, Redis, and deployment environment. Final certification still requires a harmless staging command and an end-to-end proof of:

1. actor authorization;
2. workspace authorization;
3. transaction creation/idempotency;
4. Python receipt of transaction ID and workspace;
5. actual intended handler execution;
6. resulting event with event ID, correlation ID, command/transaction ID, and expected event type;
7. resource observation with the correct observed generation;
8. UI confirmation based on resulting evidence rather than HTTP acknowledgement.
