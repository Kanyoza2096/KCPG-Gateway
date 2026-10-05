# Phase 67 — Automated Route-Drift Elimination

## Purpose

Make route mismatch a release-time failure instead of a runtime discovery problem.

## Canonical flow

`Kanyoza source routes → checked-in route manifest → KCPG contract → KDO route manifest → drift certification`

The manifest records HTTP method, effective path, source module and handler. Router prefixes and the special `/api/v1` mounts for Timeline/E2E are resolved during generation.

## Enforcement

The certification fails on:

- frontend route with no backend route
- gateway-native route accidentally treated as an upstream route
- unsupported feature making a network call

Parameter variable names such as `{id}` vs `{brand_id}` are reported as warnings because they are not wire-level differences when the path shape is identical.

Unsupported capabilities are explicit in the KDO client and return `ROUTE_UNSUPPORTED` locally; they do not generate fake backend calls or 404s.

## Runtime route inspection

`GET /api/v1/command-center/routes` now exposes the checked-in Kanyoza route snapshot together with the canonical Command Center source routes. This is a release artifact, not a claim that every route is healthy at runtime.

## Evidence

- Kanyoza static route manifest generated from Python AST.
- KCPG and KDO compare against the same manifest snapshot.
- KDO route extraction is generated from `src/lib/apiClient.ts`.
- KCPG certification blocks non-native frontend routes that are not present upstream.
