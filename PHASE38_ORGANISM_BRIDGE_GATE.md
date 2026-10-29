# Phase 38 — Organism Command/Result Bridge

## Purpose
Close the command-integrity boundary between KCPG and the Python organism.

## Implemented boundary
UI/operator command → KCPG policy → authorized workspace → Python request
(with request/correlation ID) → engine action → Python event ingress →
workspace + correlation validation → event bus → resource state / command
transaction → verified UI state.

## Hard rules
- HTTP 2xx is execution acknowledgement, not final verification.
- Command transactions remain `verifying` until a correlated resulting event
  confirms completion.
- Python event ingress requires the dedicated `PYTHON_SERVICE_TOKEN`.
- Event envelopes require workspace and correlation identifiers.
- Command completion additionally requires command, workspace, and correlation
  to match the existing transaction.
- Resource state can only be advanced by an event carrying an explicit resource
  envelope.

## Certification boundary
This phase closes the gateway-side protocol boundary but does not claim that a
real Python engine emitted the expected event. Final certification still needs
a harmless staging command and capture of the complete trace end-to-end.
