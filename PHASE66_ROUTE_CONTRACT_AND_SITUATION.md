# Phase 66 — Canonical Route Contract + CommandCenterSituation

## Problem
The frontend had to know too many backend route shapes independently. That made route drift, missing aliases, and inconsistent truth semantics likely. The gateway also exposed `/api/v1/*` as a broad BFF while individual KDO pages encoded dozens of upstream paths.

## Decision
KCPG remains the browser authority and now exposes a small, explicit read model:

- `GET /api/v1/command-center/situation`
- `GET /api/v1/command-center/routes`

`CommandCenterSituation/v1` fans out to verified Kanyoza sources and preserves per-source status, latency, canonical upstream path, and payload. It never converts partial success into global LIVE.

## Authority boundary
Browser -> KCPG -> Kanyoza.

The browser does not call Kanyoza directly and does not infer backend health from socket connectivity. Workspace authorization is enforced by KCPG before the situation is assembled.

## Frontend migration
The Organism Map now consumes `command-center/situation` and projects `sources.topology` / `sources.services`, reducing page-level route coupling.

Other feature pages can migrate incrementally. Legacy endpoints remain available during migration; they are not duplicated into a second execution path.

## Route truth
The `/routes` contract is deliberately machine-readable. It is intended for certification and tooling, not for granting authority. Visibility of a route never implies permission to execute it.

## Next step
Generate a CI route-drift report comparing the frontend route registry, KCPG-owned routes, and the live Kanyoza OpenAPI schema. Any unmatched or deprecated frontend route should fail certification before release.
