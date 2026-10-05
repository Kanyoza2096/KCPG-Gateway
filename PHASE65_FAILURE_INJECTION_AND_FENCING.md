# Phase 65 — Lease Fencing, Cancellation & Failure Injection

Phase 65 hardens the KCPG authority boundary against races and distributed-system ambiguity.

## Guarantees

- Guardian lock increments an authority generation.
- Autonomous command leases capture that generation.
- A lease cannot be fenced/bound after the Guardian generation changes.
- New L3/L4 leases cannot be issued while the Guardian is locked.
- Leases are explicitly `issued`, `bound`, or `released`.
- Lease expiry is an actuation fence, not a retry signal.
- Logical duplicate commands continue to use the same idempotency transaction.
- Queued commands can be authoritatively cancelled.
- Once a command is executing, cancellation is represented as `cancelRequested`; the system does not falsely claim that an external side effect was cancelled.

## Failure scenarios certified

1. Guardian lock racing with command dispatch.
2. Guardian lock preventing new autonomous leases.
3. Duplicate logical command replay.
4. Queued command cancellation.
5. Expired lease rejection.

The next production certification should execute these races against real Redis, real KCPG, and a disposable Kanyoza instance, including process restart and network partition tests.
