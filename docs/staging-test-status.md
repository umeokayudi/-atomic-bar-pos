# Staging test status

Date: 2026-09-29

No public staging URL was created. A preview of this build would open the browser against the production Drinks Supabase project. That deploy was refused.

## Identity

| Item | Value |
|---|---|
| Staging URL | none |
| Branch | `cursor/hospitality-ux-9777` |
| Commit | latest on `cursor/hospitality-ux-9777` that contains this file |
| Vercel deployment | none created for this request |
| Supabase used | none. Production was not contacted. |
| Test users | none created |

## What was checked

Vercel CLI is logged in as `umeokayudi` on team `umeokayudis-projects`.

Projects visible to that login: `jbm` (`https://jbmtech.vercel.app`), `bebidas-control`, `jbm-master`, `workspace`, `kuripuro`, `temporary-turbo-spinel-22hmbox`. There is no project named `atomic-bar-pos`. The local `.vercel/project.json` still names `atomic-bar-pos` with id `prj_uahO2BpUcPfNN40FgTYwVMFIywxG`, and `vercel project inspect atomic-bar-pos` returns `project_not_found`.

`vercel env ls` resolved the linked directory to `umeokayudis-projects/jbm`. The only environment variables there are Production: `VITE_BAR_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. There are no Preview environment variables. Values were not printed and were not pulled.

Supabase CLI has no access token. No project list was available. No SQL was run. No Auth user was created.

`.env.example` points `VITE_SUPABASE_URL` at `ojirgkqtqvugqktyuhem` (Drinks production) and `HOLDING_SUPABASE_URL` at `fxsakrshmldmkdmbevna` (Holding). No staging project ref exists in the repo.

`src/lib/supabase.js` ignores any URL or anon key that is not `ojirgkqtqvugqktyuhem` and falls back to that production project. A Vercel Preview with empty env, or with a future staging URL, would still use production until that fallback is changed.

## Separation

| Layer | What exists | Used for this test |
|---|---|---|
| Vercel Production | `jbm` → `https://jbmtech.vercel.app` | not deployed |
| Vercel Preview | no Preview env vars on `jbm`; `atomic-bar-pos` project missing | not deployed |
| Supabase Production (Drinks) | `ojirgkqtqvugqktyuhem` | not contacted |
| Supabase Production (Holding) | `fxsakrshmldmkdmbevna` | not contacted |
| Supabase Staging | does not exist in this repo or in the available CLI | — |

## Live flows

| Flow | Result |
|---|---|
| Login | FAIL — no staging Auth users, and the client targets production |
| POS end-to-end | FAIL — not run against a database |
| Stock | FAIL |
| Cash | FAIL |
| Employees | FAIL |
| Procurement | FAIL |
| Mobile on a public URL | FAIL — no staging URL. Local signed-out 390px login was captured earlier in `docs/end-to-end-test-plan.md`. |
| Security against a live database | FAIL — static tests passed; RLS was not executed |
| Build | PASS |
| Automated tests | PASS |

## Tests executed

All passed on this branch:

- `npm run test:pos`
- `npm run test:security`
- `npm run test:procurement` (36)
- `npm run test:employees`
- `npm run test:payroll`
- `npm run test:legacy`
- `npm run test:migration`
- `npm run build`

No test failed.

## What works in code, unproven online

Auth gate, POS floor rules, stock movement shape, night close, employee invites, procurement isolation, and payroll are covered by unit and static SQL tests. They have not been executed as a signed-in session on a staging database.

## What is required before a real staging URL

1. Create a new Supabase project that is neither `ojirgkqtqvugqktyuhem` nor `fxsakrshmldmkdmbevna`.
2. Apply the SQL in `docs/database-deployment.md` to that project only. Do not apply it to production.
3. Create a Vercel project, or a Preview environment on a non-production project, with:
   - `VITE_SUPABASE_URL` = the new project URL
   - `VITE_SUPABASE_ANON_KEY` = that project's anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = server only, never `VITE_`
4. Change `resolveSupabaseUrl` / `resolveAnonKey` so a staging ref is accepted and the production fallback is not used for that deployment.
5. Create gerente, caixa, funcionário, and fornecedor in that project's Auth, with matching `perfis` and `bar_employees`. Passwords stay in a secret store, not in git.
6. Deploy with `vercel` and no `--prod`. Confirm the built client’s host is the staging ref before anyone logs in.

Until step 4 exists, do not deploy this branch to Vercel. The current client would attach the browser to production.
