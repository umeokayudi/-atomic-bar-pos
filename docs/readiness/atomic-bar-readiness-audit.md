# Atomic Bar readiness audit

Baseline: `cursor/operational-usability-9d4b` at `79d2703`. This audit did not connect to a database and did not run SQL.

Protected projects that stay prohibited: `ojirgkqtqvugqktyuhem` and `fxsakrshmldmkdmbevna`.

## What works

The browser demo is a single ledger (`src/lib/demoLedger.js`) for one fictional night of Atomic Bar.

- Owner home reads that ledger: revenue, gross profit, CMV, labor, cash, alerts, venue comparison, and period filters.
- The floor opens a table, adds drinks, applies a manager discount, and closes cash or another method. Totals use included 10% tax from `src/lib/consumptionTax.js`.
- Cash movements and closing stay on the same drawer.
- Inventory and the supplier order share the ledger. Stock increases only when delivery is confirmed.
- Clock punches, breaks, hours, and earnings stay on that ledger.
- Demo AI answers call `composeDemoAnswer`. They do not call a model. A purchase question stays a draft until an explicit approval, and an open request is not duplicated.

Existing server modules already describe the live shape, without this environment being allowed to run them:

- POS floor SQL in `sql/pos_floor.sql`: tickets, bottles, idempotency, close, void.
- Sale security in `sql/pos_sale_security.sql`.
- Procurement in `sql/procurement.sql` and `src/lib/procurementCore.js`.
- Supplier fulfillment in `sql/supplier_fulfillment.sql`.
- Payroll in `sql/payroll.sql` and `src/lib/payrollCore.js`.
- Staff API auth in `api/_requireStaff.js` and the drinks admin client in `api/_supabaseAdmin.js`.

`docs/database-deployment.md` records that those SQL files were not applied by this repository.

## What is demo-only

`resolveDataTarget` in `src/lib/supabaseTarget.js` returns local mode for preview, development, and any channel that is not exactly `production` when the URL or anon key is missing, incomplete, or protected. The UI then uses `createLocalDemoClient`.

Demo writes never leave the browser. The classic till still refuses demo charges. Unconfigured non-demo chat can still show the Harbor Sample studio, and that path is labeled as a sample, not as books.

## What is connected

Nothing in this workspace is connected.

Checked and unset: `VERCEL_ENV`, `VITE_DEPLOY_CHANNEL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `ATOMIC_STAGING_AUTHORIZED`, `POS_PG_TEST_URL`.

The production channel in code still falls back to the drinks project URL. That path was not invoked. Preview and an unidentified server environment now refuse it before a client is created.

## What is missing

- An isolated staging Supabase project authorized by the operator.
- A preview environment whose URL and anon key belong to that project, with `ATOMIC_STAGING_AUTHORIZED=1`.
- Application of the SQL order in `docs/database-deployment.md` on that project only.
- Server handlers that call the transaction rules in `src/lib/operationalTransactions.js` inside a database transaction. The rules are in-memory and are not wired to a client.
- Row-level security proof on that staging project.
- A model key that is forbidden from supplying financial figures. Calculations stay in the ledger or SQL.

## Security risks

- `api/_supabaseAdmin.js` still knows the drinks project URL and anon key, and `resolveServiceRoleKey` still expects that project. `assertServerMayConnect` blocks that client unless `VERCEL_ENV` is exactly `production`. A production deploy would still open it. This work did not deploy.
- An unidentified channel used to fall through to the drinks URL in `resolveDataTarget`. It now stays on the local demo.
- Service-role use bypasses RLS wherever it is later enabled. Staging writes must use the staff JWT path in `createStaffUserClient`, not the service role, except for migrations run by the operator.
- `cliente` is the legacy bar-owner role and can discount and sell. That is existing behavior, not a new grant.
- Preview with a complete non-protected URL can still build a remote browser client. Writes from the new gate stay refused until the operator connects staging and a writer exists. There is no writer in this change.

## Dependencies

Legacy catalog tables are assumed by the SQL and are not created here: `bars`, `perfis`, `produtos`, `pedidos`, `vendas`, `pos_vendas`, `caixa_movimentos`, `fornecedores`, `estoque_movimentos`, `time_clock`.

Install order, when an isolated project exists: `migration.sql`, `sql/pos_sale_security.sql`, `sql/supplier_fulfillment.sql`, `sql/procurement.sql`, `sql/pos_floor.sql`, `sql/payroll.sql`, then read-only `sql/verify_schema.sql`.

## Recommended sequence

1. Operator creates an empty Supabase project that is neither protected ref, and sets preview env vars plus `ATOMIC_STAGING_AUTHORIZED=1`.
2. Operator applies the SQL order above and runs `sql/verify_schema.sql` as a read.
3. Point preview at that project and reject boot if `describeRuntime` is not operational.
4. Wrap POS close, cash, clock, purchase, and supplier receipt in the transaction rules, with the database as the lock.
5. Connect AI so the model may phrase an answer but the figures come only from those queries.
