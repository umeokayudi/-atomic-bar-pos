# Implementation status

Date of this note: 2026-10-02. The connection checklist is `staging-readiness-checklist.md`.

Modes are `LOCAL_DEMO`, `STAGING`, and `PRODUCTION`. A preview URL and key are not enough: `ATOMIC_STAGING_AUTHORIZED=1` is required on the server and `VITE_ATOMIC_STAGING_AUTHORIZED=1` is required in the browser. A production channel on a preview server stays in `LOCAL_DEMO`. Development never receives the drinks URL. No writer is attached, so a ready checklist still throws `STAGING_NOT_CONNECTED`.

The staging command contract is `src/lib/stagingOperations.js`. It ignores the browser's role, bar, and total. It does not open a database client. The demo ledger is unchanged.

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
