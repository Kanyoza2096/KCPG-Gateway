# Phase 70 — KCPG ↔ Action Kernel Convergence

KCPG remains the operator authority front door. Consequential business mutations now have an explicit `actionType` contract and are dispatched to `/api/v1/control-plane/action-intents` instead of directly invoking Python business endpoints.

## Invariant

`Operator → KCPG authority/lease/fence → ActionIntent → ActionKernel → action_outbox → worker → provider`

KCPG owns identity, workspace authorization, authority leases, Guardian generation fencing, command transactions and cancellation. The Action Kernel owns typed business side effects, risk/approval, idempotency, durable outbox execution, reconciliation and provider interaction.

High/critical actions remain approval-gated. KCPG exposes an owner/admin approval operation that targets the exact bound ActionIntent.

Read-only and control-plane-native commands are intentionally not forced through the Action Kernel.
