# Kanyoza Control Plane Gateway (KCPG)

Node.js **authoritative control plane + BFF + realtime edge** for the Kanyoza Python autonomous core.

```
React Control Plane  →  KCPG (this service)  →  Python Autonomous Core
                              ↕
                           Redis events
```

**KCPG owns:** authentication, scopes, workspace authorization, command contracts, durable transactions, idempotency, event verification, desired/observed state, generation fencing, REST BFF, and workspace-isolated realtime fan-out.

**Production invariant:** Redis is required for authoritative multi-instance realtime, durable command transactions, replay protection, and rate-limit behavior; the proxy escape hatch is disabled in production.  
**Python owns:** Director, Council, Meta, Condition, pipelines, publish, organisms, LLM.

## Quick start

```bash
cp .env.example .env
# edit JWT_SECRET, PYTHON_CORE_BASE_URL, REDIS_URL as needed

npm install
npm run dev
```

- HTTP: `http://localhost:3100`
- Health: `GET /health/live` · `GET /health/ready`
- Socket.IO: path `/socket.io`, namespaces `/dashboard`, `/system`, `/council`

For local UI work without a real JWT issuer:

```env
AUTH_DISABLED=true
```

**Never** enable `AUTH_DISABLED` in production (blocked by config).

## Main routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | Redis + Python checks |
| GET | `/api/v1/auth/me` | Current principal |
| GET | `/api/v1/control-plane/overview` | Aggregated Command Center DTO |
| GET | `/api/v1/control-plane/autonomy` | Autonomy detail |
| GET | `/api/v1/control-plane/engines` | Engine status |
| GET | `/api/v1/control-plane/organisms` | Species/organism scale |
| GET | `/api/v1/commands` | List allowlisted commands |
| POST | `/api/v1/commands/:id` | Execute allowlisted command |
| GET | `/api/v1/commands/:id/transactions/:transactionId` | Recover a durable command transaction |
| * | `/api/v1/proxy/*` | Disabled escape-hatch; production uses explicit BFF routes |

## Commands (allowlist)

| Id | Min role |
|----|----------|
| `autonomy.pause` | operator |
| `publish.dry_run` | operator |
| `director.hands` | owner |

See `src/contracts/commands.js`.

## Auth

Browser authentication uses `POST /api/v1/auth/session` with a gateway-signed HS256 JWT credential. The gateway validates it and issues an encrypted `HttpOnly` session cookie. Browser API and Socket.IO requests use that cookie; privileged credentials are never stored in browser storage. Bearer JWT remains supported for trusted non-browser integrations.

Claims used:

- `sub` — user id  
- `role` — `owner` | `operator` | `viewer` (also accepts `admin` → owner)  
- `workspace_id` / `workspaceId` — default room scope  

Socket.IO: browser clients authenticate with the gateway session cookie; trusted integrations may pass `auth: { token }` or an Authorization header. Query-string credentials are rejected.

## Events (Redis → Socket)

Python publishes JSON to channel `kanyoza:events` (configurable):

```json
{
  "type": "system.health.changed",
  "event_id": "evt_01J...",
  "issued_at": "2026-08-29T09:00:00.000Z",
  "workspace_id": "platform",
  "data": { "status": "nominal" }
}
```

KCPG validates the event envelope, replay window, event type, command correlation, expected result contract, and resource generation before authoritative completion/fan-out. In production, Python events also require an independent HMAC signature. Event names live in `src/contracts/events.js`.

## Python core integration (aligned)

KCPG talks to the FastAPI autonomous core using the **same auth the core expects**:

```http
Authorization: Bearer <PYTHON_SERVICE_TOKEN>
X-Workspace-ID: <workspace>
X-Request-Id: <id>
```

Set a dedicated `PYTHON_SERVICE_TOKEN` for the private gateway → Python trust boundary. Do not expose this credential to the browser.

### Paths used by the BFF

| KCPG | Python core |
|------|-------------|
| Overview assembly | `GET /api/v1/organism/body` + `/species/scale` + `/council/status` + `/health/*` |
| `publish.dry_run` | `POST /api/v1/e2e/publish` `{ dry_run: true, workspace_id, topic }` |
| `autonomy.pause` | `POST /api/v1/workflow/pause` |
| `director.hands` | `GET /api/v1/e2e/director-hands` |

Realtime: KCPG consumes the authenticated event bridge, validates workspace/correlation/verification semantics, deduplicates event IDs within a bounded replay window, and fans out only to authorized workspace rooms. Redis is mandatory in production.



## Project layout

```
server.js                 # listen + lifecycle
src/app.js                # Express app
src/config/               # env validation
src/middleware/           # auth, cors, rate limit, errors
src/routes/               # health, BFF, commands, proxy
src/socket/               # Socket.IO namespaces
src/services/             # python client, durable tx/state, event bus, aggregator
src/contracts/            # events + command allowlist
```

## Deploy (Render)

See `render.yaml`. Set env vars from `.env.example`. Bind only this service publicly; keep Python core on a private network or protected by the dedicated service credential.

## Scripts

```bash
npm start
npm run dev
npm test
npm run typecheck
npm run lint
npm run test:contracts
npm run test:contract
```

`typecheck` and `lint` are real JavaScript syntax gates for this CommonJS gateway. CI should run them before tests and deployment. A lockfile must be generated and committed by the release environment with network access; this archive was repaired without fabricating dependency integrity metadata.


## Authority model

A successful HTTP dispatch is **not** command completion. A command remains `verifying` until a valid correlated result event satisfies its contract; transport ambiguity becomes `uncertain` rather than being incorrectly declared failed. Resource observations are fenced by generation, and desired-state generation changes are concurrency-protected.

### Python event signature

Production event ingress requires:

`X-KCPG-Event-Signature = HMAC-SHA256(PYTHON_EVENT_SIGNING_SECRET, event_id|issued_at|workspace_id|correlation_id|command_id|canonical_event_type)`

The Python service credential and event-signing secret are intentionally separate trust layers.

## Phase 40 status

Implementation hardening is complete for distributed transaction evidence, early-event races, event authentication, generation fencing, freshness calculation, workspace fail-closed behavior, and transaction recovery. **Live certification is still required** with the real Python core and Redis across multi-instance, restart, timeout, replay, and concurrency scenarios.
