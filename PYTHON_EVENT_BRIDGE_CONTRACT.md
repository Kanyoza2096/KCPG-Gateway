# Python → KCPG Event Bridge Contract (Phase 40)

Production event ingress uses two independent trust layers:

1. `Authorization: Bearer <PYTHON_SERVICE_TOKEN>` authenticates the Python service.
2. `X-KCPG-Event-Signature` authenticates the event payload and prevents tampering.

## Signature

`HMAC-SHA256(PYTHON_EVENT_SIGNING_SECRET, canonical_string)`

`canonical_string` is:

`event_id|issued_at|workspace_id|correlation_id|command_id|canonical_event_type|sha256(canonical_json(event_envelope))`

`canonical_json` recursively sorts object keys and preserves array order before JSON serialization.

## Required command-result fields

A result event that participates in command completion should contain:

- `event_id`
- `issued_at`
- `workspace_id`
- `correlation_id`
- `command_id` — the KCPG transaction id from `X-Command-ID`
- `type` — one of the canonical KCPG event types or a registered Python alias
- `data` and/or `resource`

Resource-bearing result events must include:

- `resource.kind`
- `resource.id`
- `resource.observed_generation`
- `resource.observed_state`
- `resource.health`

## Completion semantics

KCPG completes a transaction only when the event is in the same workspace, has the transaction correlation, matches the command's expected event contract, matches the expected resource when defined, and satisfies the expected resulting state when defined.

An HTTP timeout does not imply failure. If the side effect may have reached Python, KCPG records `uncertain` until valid evidence resolves the transaction.
