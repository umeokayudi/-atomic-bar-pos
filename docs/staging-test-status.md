# Staging test status

Date: 2026-09-29

STAGING SUPABASE NECESSÁRIO

A later request said a staging project already exists. `npx supabase projects list` still returns `AccessTokenRequiredError`. No project ref could be read, so the new project could not be distinguished from the protected ones. Schema, users, Preview variables, and deploy were not started. Production was not deployed and no SQL was executed.

## Identity

| Item | Value |
|---|---|
| Staging URL | none |
| Branch | `cursor/hospitality-ux-9777` |
| Vercel deployment | none |
| Supabase staging | none |
| Test users | none |

## Why staging was not created

`npx supabase projects list` returns `AccessTokenRequiredError`. There is no `SUPABASE_ACCESS_TOKEN` in this environment, and `~/.supabase` has no login. Vercel project `jbm` still has only the three Production variables. No Preview variables exist. Without a project list, a ref cannot be confirmed as staging.

The protected projects were not used:

- Drinks production `ojirgkqtqvugqktyuhem`
- Holding `fxsakrshmldmkdmbevna`

Vercel CLI is logged in as `umeokayudi`. The linked directory resolves to project `jbm` (`https://jbmtech.vercel.app`). Its environment variables exist only for Production. There is no Preview environment. Preview variables were not added, because the only known Supabase projects are the protected ones. Production variables were not changed.

## What changed in code

`src/lib/supabase.js` no longer substitutes the production URL or anon key. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must both be set, and the anon key must belong to that URL. Otherwise the screen says `Supabase configuration missing` and the browser client is not created.

`api/_supabaseAdmin.js` uses the same rule. A missing URL throws `Supabase configuration missing`. The service-role key must belong to that same project. Holding calls use `HOLDING_SUPABASE_URL` only when it is set. `api/_applyBarSql.js` no longer defaults the database host to production.

## Live flows

| Flow | Result |
|---|---|
| Login | FAIL — no staging project, no users, no URL |
| Gerente / caixa / funcionário / fornecedor | FAIL |
| POS end-to-end | FAIL |
| Inventory | FAIL |
| Cash | FAIL |
| Employees | FAIL |
| Procurement | FAIL |
| Mobile in a real browser on a public URL | FAIL — there is no URL to open |
| Security against live RLS | FAIL |
| Build | PASS |
| Automated tests | PASS |

Browser click-through was not possible. There is no deployment that points at a staging database.

## Tests executed

All passed:

- `npm run test:pos`
- `npm run test:security`
- `npm run test:procurement`
- `npm run test:employees`
- `npm run test:payroll`
- `npm run test:legacy`
- `npm run test:migration`
- `npm run test:auth`
- `npm run build`

## Next action

1. Create a Supabase project that is neither protected ref above. Provide `SUPABASE_ACCESS_TOKEN` to this environment, or create the project in the Supabase dashboard and supply its URL and anon key as Preview variables only.
2. Apply the schema from `docs/database-deployment.md` to that project only. Stop on the first SQL error.
3. Set Vercel Preview (not Production) `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_BAR_ID`. Keep `SUPABASE_SERVICE_ROLE_KEY` server-side.
4. Create the four staging Auth users there, linked to `perfis`, role, and bar.
5. Deploy with `vercel` and no `--prod`, then repeat the browser flows.
