# KCPG Authentication / Session Exchange Repair

Date: 2026-09-26
Component: KCPG Gateway

## Root cause

The browser login flow was reaching KCPG `/api/v1/auth/session`, but the gateway's Supabase identity exchange contract was inconsistent with the canonical backend contract in three ways:

1. The runtime configuration exposed `identityExchangeEnabled` under `config.python.identityExchangeEnabled`, while `src/routes/session.js` checked `config.identityExchangeEnabled`. The check therefore evaluated as undefined/false.
2. The gateway attempted to validate the browser Supabase token by calling `GET /api/v1/context/me` with the browser token. The canonical backend contract is the internal `POST /api/v1/auth/exchange` endpoint, authenticated with the KCPG `PYTHON_SERVICE_TOKEN`, carrying the browser token as `access_token`.
3. The backend exchange returns canonical identity fields as `sub`, `workspaceId`, and `scopes`, while the gateway expected `principal_id` and `workspace_id`.

These mismatches can produce the observed `POST /api/v1/auth/session -> 401` even when the browser Supabase credential is valid.

## Repair

`src/routes/session.js` now:

- reads `config.python.identityExchangeEnabled`;
- requires the configured `PYTHON_SERVICE_TOKEN` when identity exchange is enabled;
- calls `POST {PYTHON_CORE_BASE_URL}/api/v1/auth/exchange`;
- authenticates that internal call with `Authorization: Bearer <PYTHON_SERVICE_TOKEN>`;
- sends `{ access_token: <browser Supabase token> }` as the request body;
- accepts the canonical backend identity response (`sub`, `workspaceId`, `scopes`) with defensive snake_case compatibility;
- preserves 401 behavior for invalid browser credentials;
- surfaces backend 5xx identity-provider failures as an upstream 502 instead of converting them into a misleading 401.

The browser credential is never persisted or exposed as a gateway credential. KCPG still issues the normal HttpOnly gateway session after successful exchange.

## Architecture after repair

Command Center / Browser
  -> Supabase access token
  -> KCPG `POST /api/v1/auth/session`
  -> KCPG internal `POST /api/v1/auth/exchange`
  -> Backend canonical SpeciesAuth validation
  -> canonical identity + workspace + scopes
  -> KCPG signs gateway session JWT
  -> HttpOnly session cookie
  -> Command Center authenticated requests

## Tests

Focused authentication/session contract tests: **4/4 PASS**.

- nested identity-exchange configuration is used
- canonical backend `/api/v1/auth/exchange` is used instead of `/context/me`
- internal Python service credential is required and sent
- canonical backend response field mapping is preserved

`node --check src/routes/session.js`: PASS.

A broader `npm test` was attempted. 50 tests passed. Four existing tests failed for reasons unrelated to this repair: three suites could not load dependencies after the interrupted local `npm ci` (`ioredis`, `jsonwebtoken`, `express`), and one pre-existing static security assertion expected an older source shape (`scopes:`). The focused repair suite remains green.

## Scope

Changed only KCPG Gateway authentication/session exchange code and added focused regression tests. No Backend authority, Command Center authentication UI, provider connector, or execution path was changed.
