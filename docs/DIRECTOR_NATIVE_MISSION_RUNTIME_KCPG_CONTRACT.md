# Director Native Mission Runtime — KCPG Integration Contract

**Status:** Contract proposal; not enabled or dispatched yet.  
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

These IDs and routes are proposed contracts, **not yet entries in the live command registry**. They must be implemented and tested in the Python backend before being added to `contracts/control-plane-command-registry.v1.json`.

| Command ID | Method | Proposed Python route | Purpose |
|---|---|---|---|
| `director.mission.runtime.timeline.read` | GET | `/director/missions/{mission_id}/orchestration/timeline` | Read the durable mission event timeline and task/engine progress |
| `director.mission.runtime.task.assign` | POST | `/director/missions/{mission_id}/orchestration/tasks/{task_id}/assign` | Assign a task to a registered native engine adapter; assignment alone does not approve execution |
| `director.mission.runtime.task.execute` | POST | `/director/missions/{mission_id}/orchestration/tasks/{task_id}/execute` | Request execution of an already approved, dependency-ready task |
| `director.mission.runtime.engine.message` | POST | `/director/missions/{mission_id}/orchestration/messages` | Submit a bounded engine clarification/challenge message under mission policy |

The Python team may adjust route spelling to match its router conventions, but the final route, method, request schema, response schema, and authorization contract must be agreed in both repositories before registry entries are merged.

## Gateway policy requirements

- Timeline read: `minRole=viewer`, scopes `control.read` and `director.read`, risk `low`, workspace required, GET, no mutation.
- Task assignment: `minRole=operator`, scopes `control.write` and `director.write`, risk at least `medium`, workspace required, POST, idempotency key required.
- Task execution: `minRole=operator`, scopes `control.write` and `director.write`, risk `high`, workspace required, POST, idempotency key required. The gateway authorization is necessary but never sufficient: the Python runtime must independently verify persisted task approval and all execution preconditions.
- Engine message: `minRole=operator`, scopes `control.write` and `director.write`, risk `medium`, workspace required, POST, idempotency key required, with server-enforced message/round/token/time limits.
- The KCPG command transaction must record the mission/task resource identity and correlation metadata. A successful HTTP response must not be mistaken for verified task completion.
- Read operations should use a read-only BFF route or a command path that explicitly avoids actuation authorization/lease acquisition. Do not force GET timeline reads through a mutating actuation flow.
- Mutating operations must retain KCPG's authority guard, lease fencing, durable transaction, and replay protection. Replays must return the existing transaction rather than dispatching duplicate work.
- Unknown mission/task IDs, cross-workspace references, invalid state transitions, stale approvals, and disabled runtime must fail closed.

## Runtime response and event contract

Mutation responses should return a stable envelope containing:
- `ok`, `mission_id`, and `task_id` where applicable;
- a durable `event_id` or operation identifier;
- current authoritative state and a correlation identifier;
- whether the operation was accepted, completed, rejected, or remains pending.

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

## Integration sequence

1. Implement and test the backend routes and state preconditions in `AI-Automation-Platform`.
2. Align the exact request/response/event schemas and route paths with this document.
3. Add registry entries on the KCPG `KDO`-based feature branch.
4. Add KCPG route/command contract tests, including role, scope, workspace, idempotency, lease, and uncertainty behavior.
5. Integrate the Director UI through KCPG only.
6. Keep both changes unmerged until end-to-end tests pass. The backend `staging` branch auto-deploys to production; no release is implied by this contract work.
