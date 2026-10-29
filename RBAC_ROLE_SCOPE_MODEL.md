# KCPG / KDO RBAC Role-Scope Model — R1

## Authority model

Human authorization is **user-bound and workspace-bound**. The gateway does not
accept a human role, scope set, or workspace authorization from environment
variables.

1. Human signs in through the configured identity provider (Supabase).
2. KCPG exchanges the identity credential with KDO's canonical
   `/api/v1/auth/exchange` endpoint.
3. KDO resolves the authenticated user against `workspace_members` (or the
   workspace owner binding) and returns the authoritative workspace role.
4. KCPG derives gateway scopes deterministically from that role.
5. KCPG issues its short-lived HttpOnly gateway session.
6. Workspace switching performs a fresh identity exchange for the requested
   workspace, so the role is re-resolved rather than copied from the previous
   workspace.

## Human roles

- `viewer` — read-oriented workspace access.
- `operator` — operational execution/control access within governance limits.
- `admin` — workspace administration and broad control access.
- `owner` — **highest human workspace role / super-admin / super-user**.

`species` remains a machine/platform principal and is not a human workspace
role.

## Scope model

Scopes are a projection of the role policy in `src/contracts/roles.js`.
They are not environment variables and are not accepted from browser input.

`owner` receives `*`, which is the explicit super-user posture. Route-level
minimum-role checks and governance/Guardian checks still apply; `*` does not
bypass server-side safety controls.

## Removed configuration authority

The following are no longer authorization sources:

- `CONTROL_PLANE_ROLE`
- `CONTROL_PLANE_SCOPES`
- `CONTROL_PLANE_EMAIL`
- `CONTROL_PLANE_PASSWORD_HASH`
- `CONTROL_PLANE_WORKSPACES`

The former `/auth/control-login` surface is retained only as a fail-closed
retirement response so old clients receive a deterministic `410` rather than
silently using the legacy environment-backed identity model.

## Security invariant

> A gateway session must never acquire a human role or scope set merely because
> an environment variable, browser request, or stale workspace session says so.

Role authority comes from the authenticated user's workspace membership.
