# Auth architecture

Status: **implemented in the client, not verified against live Supabase Auth.**

## Session

A user is signed in only when Supabase Auth returns a session from `signInWithPassword`, an invite link, or a recovery link.

`perfis` is loaded after that session. `perfis.id` must equal `auth.users.id`. If it does not, the client signs out.

The session is stored by the Supabase client in `localStorage` under `sb-<project>-auth-token`, with `autoRefreshToken`. Logout calls `signOut`. A lane token in `localStorage` is cleared and is not restored.

## Role landing

| Role | Hash |
|---|---|
| caixa | `#/pos` |
| bar_staff | `#/clock` |
| gerente, cliente | `#/hq` |
| admin, jbm, staff, funcionario | `#/jbm` |
| fornecedor | `#/supplier` |

`caixa` and `bar_staff` are not HQ roles. Staff API calls use `bar_id` from the signed-in profile.

## Employees

A manager invites by name, email, and job. The server calls `inviteUserByEmail` with the service role. The browser never receives that key and never sends a password. The person sets a password from the Auth email. `bar_accept_invitation` marks the directory row when the password step finishes.

Suspended and inactive bar roles are signed out. The staff API also sets an Auth ban for those two statuses when the service role is configured, and clears it on reactivate.

## What is not a login

- A `perfis` row with no Auth user.
- The legacy lane login at `/api/bar/lane-login`.
- `scripts/provisionDevAuth.mjs` against `*.supabase.co`. That script refuses those hosts. See `docs/dev-auth-users.md`.

## Unverified

Correct password, wrong password, refresh, logout, expired session, mobile login, and the invite email were not run against a real Auth project in this pass.
