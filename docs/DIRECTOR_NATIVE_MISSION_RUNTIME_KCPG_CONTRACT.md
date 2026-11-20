# Director Native Mission Runtime — KCPG Integration Contract

**Status:** Backend timeline, assignment, execution, engine-question, and engine-answer routes are implemented behind a disabled-by-default feature flag. KCPG command registry entries and dispatch for assignment, execution, engine questions, and engine answers are implemented on this feature branch.  
**Base branch:** `KDO`  
**Purpose:** Define the gateway boundary for the native Director mission orchestration runtime without confusing it with advisory collaboration.

## Authority invariants

1. The browser never calls the Python orchestration runtime directly. All operator actions pass through KCPG's authenticated command boundary.
2. KCPG remains authoritative for principal authentication, role/scope checks, workspace binding, authority-lease fencing, durable command transactions, idempotency, and dispatch.
3. Python Director remains authoritative for mission/task state, native engine invocation, evidence, verification, and mission lifecycle.
4. Collaboration and engine consultation are advisory. They do not approve tasks, create execution authority, or bypass the task approval state.
5. A native task may execute only when the canonical Director task is durably approved, the approval actor is recorded, dependencies are satisfied, the mission is admitted, and the runtime feature flag is enabled.
6. No publish, financial, credential, destructive, or other external side effect is introduced by these runtime commands. Such actions must continue through the existing Action Kernel and its independent approval controls.
7. Every read and mutation is workspace-scoped. A supplied workspace identifier must match the authenticated KCPG workspace; clients cannot override it.

## Proposed command surface

The timeline remains a read-only Director proxy route, not a mutating command. Assignment, execution, engine-question, and engine-answer routes have registered KCPG command IDs on this feature branch and dispatch through the durable command transaction path. All backend routes remain behind `KDO_DIRECTOR_MISSION_RUNTIME_ENABLED`. No runtime route is usable until the actual production migration prerequisites are independently verified and the feature flag is deliberately enabled.

| Command ID | Method | Proposed Python route | Purpose |
|---|---|---|---|
| `director.mission.runtime.timeline.read` | GET | `/director/missions/{mission_id}/orchestration/timeline` | **Implemented (gated):** read the durable mission event timeline and task/engine progress |
| `director.mission.runtime.task.assign` | POST | `/director/missions/{mission_id}/orchestration/tasks/{task_id}/assign` | **Implemented (gated):** assign a task to a registered native engine adapter; assignment alone does not approve execution |
| `director.mission.runtime.task.execute` | POST | `/director/missions/{mission_id}/orchestration/tasks/{task_id}/execute` | **Implemented (gated):** request execution of an already approved, dependency-ready task |
| `director.mission.runtime.task.recovery.review` | POST | `/director/missions/{mission_id}/orchestration/tasks/{task_id}/recovery-review` | **Implemented (gated):** record operator hold or request for reconciliation; never grants retry authority |
| `director.mission.runtime.task.reconcile` | POST | `/director/missions/{mission_id}/orchestration/tasks/{task_id}/reconcile` | **Implemented (gated):** read exact engine attempt status and journal the observation without replay |
| `director.mission.runtime.engine.message` | POST | `/director/missions/{mission_id}/orchestration/messages` | **Implemented (gated):** submit a bounded engine clarification/challenge message under mission policy |

The backend app is mounted at `/director`, so the externally visible routes are prefixed with `/director`. The existing `/director/tasks/{task_id}/approve` endpoint also appends the mission approval event when the runtime flag is enabled. Request fields: assignment uses `engine_id`, `capability`, `idempotency_key`, `correlation_id`; execution uses `engine_id`, `objective`, bounded `inputs`, `idempotency_prefix`, `correlation_id`, `estimated_tokens`, and `timeout_seconds`. Timeline accepts `limit` (1–200). Execution currently returns the native contribution synchronously; do not model it as asynchronous accepted/pending until a durable job/receipt contract is implemented.

## Gateway policy requirements

- Timeline read: `minRole=viewer`, scopes `control.read` and `director.read`, risk `low`, workspace required, GET, no mutation. The Director proxy must forward a short-lived HMAC-signed human actor envelope; an unsigned species/service identity is not a workspace operator.
- Task assignment: `minRole=operator`, scopes `control.write` and `director.write`, risk at least `medium`, workspace required, POST, idempotency key required.
- Task execution: `minRole=operator`, scopes `control.write` and `director.write`, risk `high`, workspace required, POST, idempotency key required. The gateway authorization is necessary but never sufficient: the Python runtime must independently verify persisted task approval and all execution preconditions.
- Engine message: `minRole=operator`, scopes `control.write` and `director.write`, risk `medium`, workspace required, POST, idempotency key required, with server-enforced message/round/token/time limits.
- Recovery review: `minRole=operator`, scopes `control.write` and `director.write`, risk `medium`, workspace required, POST, KCPG transaction idempotency plus backend event idempotency. The only permitted decisions are `hold` and `request_reconciliation`; no operator-supplied classification or no-side-effect claim is accepted.
- Attempt reconciliation: `minRole=operator`, scopes `control.write` and `director.write`, risk `medium`, workspace required, POST, durable KCPG transaction and signed actor context. The backend checks the exact original attempt, appends an observation, and does not invoke/replay the engine or modify task approval/status/assignment.
- The KCPG command transaction must record the mission/task resource identity and correlation metadata. A successful HTTP response must not be mistaken for verified task completion.
- Read operations should use a read-only BFF route or a command path that explicitly avoids actuation authorization/lease acquisition. Do not force GET timeline reads through a mutating actuation flow.
- Mutating operations must retain KCPG's authority guard, lease fencing, durable transaction, and replay protection. Replays must return the existing transaction rather than dispatching duplicate work. KCPG's Python client must sign the authenticated human actor context for all `director.*` command dispatches; backend Director routes must verify that envelope rather than trust unsigned `X-User-*` headers.
- Unknown mission/task IDs, cross-workspace references, invalid state transitions, stale approvals, and disabled runtime must fail closed.

## Runtime response and event contract

Current backend responses are interim: assignment returns `accepted`, mission/task IDs, and mission version; execution returns contribution status, summary, confidence, evidence, and limitations. They do not yet expose a stable event ID or complete correlation envelope. KCPG must not mark execution as completed solely because dispatch returned HTTP 2xx; verify the durable timeline/task state. Treat transport timeout as uncertain and reconcile before any retry.

For long-running execution, KCPG should return a durable accepted/pending transaction and reconcile it using authenticated, workspace-scoped, correlated backend events. Do not mark a command completed merely because dispatch returned HTTP 2xx.

## Required contract tests before registry activation

1. Viewer can read only the timeline for an authorized workspace.
2. Cross-workspace mission and task IDs are rejected even if guessed.
3. Operator without required scopes cannot assign, message, or execute.
4. Assignment cannot implicitly approve a task.
5. Execution of unapproved, rejected, blocked, dependency-pending, or unadmitted tasks is rejected by Python.
6. Duplicate idempotency keys do not create duplicate messages, assignments, or engine invocations.
7. Lease revocation/Guardian fencing between authorization and dispatch prevents dispatch.
8. Transport ambiguity remains uncertain and is reconciled from durable evidence; it is not blindly retried.
9. Runtime feature flag off means no native engine invocation.
10. No Action Kernel bypass or direct external side effect is possible through these endpoints.

## KCPG gateway implementation progress

- The existing Director proxy now applies `director.read` / `director.write` scopes to mission-runtime paths in addition to `control.read` / `control.write`.
- Timeline reads remain on the read-only proxy path; no actuation lease or mutation transaction is acquired for a GET.
- Task assignment and execution are registered as `director.mission.runtime.task.assign` and `director.mission.runtime.task.execute`; both use the generic KCPG command transaction, idempotency, authority lease/fencing, and signed actor context.
- Engine follow-up messages and recipient answers are registered as `director.mission.runtime.engine.message` and `director.mission.runtime.engine.message.answer`; the source engine is derived from the canonical task assignment, not supplied by the client. The state machine enforces bounded rounds and pending-question sequencing.
- Recovery review and exact-attempt reconciliation are registered as `director.mission.runtime.task.recovery.review` and `director.mission.runtime.task.reconcile`. Both use durable KCPG command transactions and signed human actor context; no direct proxy bypass is allowed. The API accepts only `hold` / `request_reconciliation`, and adapter outcomes without exact-attempt authoritative evidence remain `unknown`.
- Direct POST/PUT/PATCH/DELETE mission-runtime proxy calls are rejected with `DIRECTOR_RUNTIME_COMMAND_GATEWAY_REQUIRED`, preventing bypass of durable KCPG command transactions.
- The proxy signs the authenticated actor, role, workspace, and request ID with the configured KCPG context secret before forwarding to Python.
- The generic Director command dispatcher also supplies the signed actor envelope for `director.*` commands.
- Workspace roles now include `director.read`, including viewer, operator, and admin; owner retains wildcard scopes.
- Backend Director endpoints verify the HMAC envelope and reject unsigned species/service context for mission runtime access.
- These changes remain on the KDO-based feature branch and are not merged or deployed.

## Integration sequence

1. Complete and retain backend route, dependency-precondition, approval-sync recovery, and runtime feature-flag test evidence on the latest backend head.
2. Use the user-designated production Supabase project KDO (`kfgutijhrywnxpsjjacd`, `https://kfgutijhrywnxpsjjacd.supabase.co`) as the production database. Reconcile the required migration chain against that project with read-only verification first; do not substitute a separate staging/build project or apply unverified DDL.
3. Keep request/response/event schemas and route paths aligned across backend, KCPG, and the Director UI.
4. Re-run KCPG role, scope, workspace, idempotency, lease, retry, and uncertainty contract tests when CI quota is available; do not equate quota-blocked checks with passing tests.
5. Complete live API/KCPG tests for engine questions, recipient answers, and recovery of pending questions after ambiguous transport outcomes.
6. Verify the Director UI through KCPG only, including the six Director Mission Control acceptance criteria.
7. Keep both changes unmerged until required checks and end-to-end tests pass. The backend `staging` branch auto-deploys to production; no release is implied by this contract work.
