# KDO Engineering Vertical — Phase 16.11 Dynamic Planning Integration

## Implemented

- Added `services/kdo_engineering_phase16_11_planner.py`, a structured proposal-only planner using the existing KDO `LLMGateway.complete_structured` interface.
- Wired the PostgreSQL console provider to create a planner adapter when the existing LLM gateway is available. Provider boot remains fail-closed and optional; no database or gateway fallback is invented.
- Added `POST /api/v1/engineering/console/tasks/{task_id}/plan/generate`. It is workspace-scoped, returns a validated 3–12 step proposal, and does not persist, execute, approve, or authorize release.
- Added KCPG forwarding at `POST /api/v1/engineering/console/tasks/:taskId/plan/generate`, gated by authenticated operator role and `control.write` scope; the gateway supplies workspace and signed actor context.
- Added a Control Plane action to generate an AI proposal, edit the returned steps, then submit the plan for the existing independent review flow.
- Capability status reports planning as configured only when a planner adapter is actually attached. Agent count remains zero because a planner configuration is not a running agent team.

## Safety properties

- Model output is treated as unverified proposal content and is validated before display.
- Generation has no repository write, command execution, approval, deployment, or release authority.
- The existing plan submission and revision-bound independent review path remains the approval gate.
- Build/test sandbox execution and automatic repair remain disabled in this phase because a production isolated worker has not yet been wired into the authoritative task lifecycle. This is the next implementation gate, not a permanent exclusion.

## Validation

- `tests/engineering_vertical/test_phase16_11_planner.py`: 4 passed.
- Regression tests `test_phase16_7_dynamic_quality_loop.py` and `test_phase16_8_console.py`: 20 passed.
- KCPG `node --check` is run for the changed route. Full KCPG route tests could not execute because this extraction does not include installed npm dependencies (`express`, `jsonwebtoken`, `ioredis`).
- No live LLM gateway, PostgreSQL database, deployed KCPG, or production worker was available; no end-to-end production claim is made.
