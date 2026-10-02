# Implementation status

Date of this note: 2026-10-02. Branch `cursor/staging-foundation-9d4b`.

## Done

- Readiness audit, staging setup, and transaction architecture docs in this folder.
- Browser channels other than `production` no longer fall through to the drinks project.
- Server connections throw unless `VERCEL_ENV` is `production` (existing live path, not used here) or `preview` with a non-protected URL.
- `describeRuntime` / `assertMayWrite` list the missing staging configuration and still refuse writes after the checklist passes.
- In-memory transaction rules cover sale, cash payment, discount, stock, cash movement, cash close, clock, purchase request, supplier status, and stock receipt.
- AI proposals separate draft, approval, and execution. Execution stays `executed: false` and `staging_required` while staging is down. Figures outside the source list are rejected.
- Employee shell opens on the clock. The embedded owner board no longer repeats a second page title. Supplier orders split pending actions from history.

## Not done

- No staging project was created.
- No SQL ran. No row was inserted, updated, or deleted in any database.
- No production variable was changed. No deploy ran.
- The transaction module is not called by an API route.
- RLS, live idempotency, and payment or payroll providers were not exercised.
- The model was not called.

## Staging connected

No.

## Database writes

None.

## Operator action

Create an empty Supabase project that is not `ojirgkqtqvugqktyuhem` or `fxsakrshmldmkdmbevna`. Put its URL and anon key on Vercel Preview only, set `VITE_DEPLOY_CHANNEL=preview` and `ATOMIC_STAGING_AUTHORIZED=1`, then apply the migration order in `staging-setup.md`. Until that exists, the app stays on the browser demo and operational writes stay refused.
