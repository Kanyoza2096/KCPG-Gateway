# KCPG Phase 40 — Distributed Authority & Failure Semantics

## Objective

Phase 40 hardens the control plane against distributed races, early result events, stale observations, transport ambiguity, and forged/replayed internal events.

## Implemented

- Gateway transaction identity is now actually forwarded to Python as `X-Command-ID`.
- Command transactions retain durable verification evidence, allowing an event to arrive before the HTTP acknowledgement is processed.
- Transport failures become `uncertain` unless durable evidence already proves success.
- A valid result event can complete a transaction even when the preceding HTTP response was lost.
- Idempotency remains scoped by actor, workspace, command, and key.
- Transaction updates use optimistic compare-and-set semantics with bounded retries.
- Internal events are authenticated with the Python service credential and, in production, an independent HMAC signing secret.
- Production events require explicit `event_id`; timestamps are bounded by a configurable replay window.
- Event types are allowlisted and command-linked events must resolve to an existing transaction in the same workspace.
- Event completion checks correlation, expected event type, expected resource, and expected resulting state where defined.
- Resource observations cannot move backwards or claim a generation newer than the gateway's desired generation.
- Resource freshness is calculated from `observedAt`, rather than persisting a permanent zero freshness value.
- Desired-state updates preserve omitted fields and advance generation only when the requested desired state actually changes.
- Workspace context is fail-closed and conflicting workspace selectors are rejected.
- A durable transaction recovery endpoint is available for clients that receive `202` or `uncertain` responses.
- The direct `ws` dependency is declared explicitly rather than relying on transitive installation.

## Python event signing contract

For production, Python must send:

`X-KCPG-Event-Signature: hex(HMAC-SHA256(PYTHON_EVENT_SIGNING_SECRET, canonical))`

where:

`canonical = event_id + "|" + issued_at + "|" + workspace_id + "|" + correlation_id + "|" + command_id + "|" + canonical_event_type + "|" + sha256(canonical_json(event_envelope))`

The same independent secret must be configured on both services. The bearer service token remains required as a separate authentication layer.

## Remaining certification requirements

This phase is implementation hardening, not a claim of live certification. Production certification still requires live tests covering:

1. two gateway instances racing on the same idempotency key;
2. event-before-HTTP-response;
3. HTTP timeout after Python side effect;
4. duplicate/replayed events;
5. stale and future resource generations;
6. Redis failover/reconnect;
7. process restart during `executing` and `verifying`;
8. multi-workspace isolation;
9. Python event signature interoperability;
10. load/backpressure behavior under burst command and event traffic.
