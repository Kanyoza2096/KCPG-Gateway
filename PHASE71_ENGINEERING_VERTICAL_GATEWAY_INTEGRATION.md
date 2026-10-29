# KCPG Phase 71 — KDO Engineering Vertical Gateway Integration

## Changes

- Added explicit, authenticated `/api/v1/engineering/console/*` gateway routes before the generic BFF router. The new endpoints do not depend on the disabled proxy escape hatch.
- Added workspace validation and server-selected workspace propagation for all reads and mutations. Browser-supplied conflicting workspace IDs are rejected.
- Enforced `viewer + control.read` for reads and `operator + control.write` for task intake, plan submission, and plan decisions.
- Added bounded validation for task objectives, acceptance criteria, pagination, plan steps, and revision-bound decisions.
- Added HMAC-signed actor/workspace context to gateway-to-Python calls. The envelope includes timestamp, request ID, workspace ID, actor ID, and actor role; the backend verifies signature and five-minute freshness. This prevents review history from attributing every action to the shared Python service identity.
- Added `KCPG_CONTEXT_SIGNING_SECRET` to gateway configuration and Render environment declarations. The same secret must be configured on the Python backend.
- Added gateway integration tests and backend signed-context tests.

## Routes

- `GET /api/v1/engineering/console/capabilities`
- `GET /api/v1/engineering/console/tasks?limit=30`
- `POST /api/v1/engineering/console/tasks`
- `GET /api/v1/engineering/console/tasks/:taskId`
- `GET /api/v1/engineering/console/tasks/:taskId/events`
- `POST /api/v1/engineering/console/tasks/:taskId/plan`
- `POST /api/v1/engineering/console/tasks/:taskId/decision`

## Required deployment configuration

1. Configure `PYTHON_CORE_BASE_URL` and the private `PYTHON_SERVICE_TOKEN` as before.
2. Generate one random secret of at least 32 characters and set it as `KCPG_CONTEXT_SIGNING_SECRET` in both KCPG and the Python backend. Do not place it in frontend environment variables.
3. Deploy the backend provider/migrations before exposing the frontend route. The API correctly propagates backend 503 responses if the provider is not configured.
4. Test with a real authorized user and two distinct operator identities; confirm workspace scoping, event attribution, plan revision checks, and independent-reviewer enforcement.

## Validation

- Node syntax checks passed for the new route, route registry, Python client, config, and gateway test.
- Python engineering vertical suite: 180 passed, including signed context workspace/actor attribution and tamper rejection.
- Full gateway runtime tests could not be executed in this environment because `npm ci` timed out and dependencies such as Express and jsonwebtoken were unavailable. Do not interpret static syntax checks as end-to-end gateway certification.
- No deployed gateway, live PostgreSQL instance, migration application, or production planner/worker was available.

## Capability boundary

This change wires the gateway transport and trusted identity context. It does not turn on dynamic agent planning, sandbox execution, test workers, automatic repair, or deployment authority. The backend reports those capabilities as unavailable until a governed worker lifecycle is implemented and explicitly configured.
