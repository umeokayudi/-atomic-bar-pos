# Functional readiness audit

Local only. This pass inspects the four portals, records what the code actually does, and implements the cash-drawer movement, a deterministic close explanation, and a unit comparison that refuses to add the till book to the JBM book.

No SQL was sent to the Drinks project `ojirgkqtqvugqktyuhem` or the Holding project `fxsakrshmldmkdmbevna`. No Vercel production change, deploy, merge, credential change, or remote migration was performed. Local PostgreSQL and fictional rows are the only database used.

A screen filled from the browser demo ledger is simulated. A function that exists in `sql/` and is exercised by `scripts/foundation.pg.test.mjs` is local and tested. Neither state is a hosted homologation, and neither is production release.

## Classification

| Module | Class | Why |
| --- | --- | --- |
| HQ dashboard and night indicators | Partially functional | `sales_indicator` and `saleBooks.js` share one net rule per book. The demo snapshot is a separate ledger. |
| HQ bar management | Partially functional | Bars, memberships, and `platform_access` exist in the local installer. Hosted catalogs were not read. |
| HQ billing, CMV, gross profit, expenses, cash flow | Partially functional | Figures come from stored rows when a local database is installed. Missing prices stay unavailable. Demo numbers are labeled DEMO. |
| HQ unit comparison | Functional and tested, local | `compareBarIndicators` sums one book only and returns null when a unit is missing or the books differ. |
| HQ reports | Partially functional | Report helpers read the same net rule. They are not a hosted report service. |
| HQ approvals | Partially functional | Void and night close are role-gated in SQL. There is no separate approval inbox. |
| HQ user management | Partially functional | Local tests create fictional `perfis`. The hosted Auth users were not changed. |
| HQ assistant | Simulated, plus a deterministic explainer | Without `GEMINI_API_KEY` the assistant says the model is not configured. `explainCashClose` calculates variance from a supplied snapshot, names sources, and does not close cash. |
| POS sale, payment, discount, close ticket | Functional and tested, local | Foundation and POS tests cover split pay, idempotent replay, discount role, and reconcile. |
| Tables and comandas | Functional and tested, local | `pos_load_ticket` and ticket items are in the floor tests. |
| Products and per-bar prices | Partially functional | Till price, unit price, and procurement price stay three paths. A missing or non-positive price is rejected or shown as unavailable. |
| Cash drawer, sangria, suprimento, night close | Functional and tested, local | `cash_drawer_move` and `cash_close_night` write the local ledger. The demo drawer copy still says it does not write a live shift. |
| Stock | Functional and tested, local | `stock_post` blocks an insufficient `block` policy. Receipt posts `entrada`. |
| Purchases, receiving, procurement chain | Functional and tested, local | Submit, plan, purchase, shipment, advance, bar confirm, stock, and audit are local SQL. No carrier API is attached. |
| Bar employees on the floor | Partially functional | Clock punches are SQL. Payroll pack is SQL for the signed-in employee. |
| Employee profile, schedule, clock, breaks, hours, wage estimate | Partially functional | `payroll_my_pack` and `staff_clock` isolate by employee. The desk shows dashes when the schema is missing. |
| Employee requests, tasks, announcements | Not implemented as a connected module | The desk labels them not connected. This pass does not invent rows. |
| Supplier catalog, prices, orders, confirm, prepare, ship, deliver, history | Functional and tested, local | Supplier audience is `my_supplier_ids`. Sale price stays null for that audience. No external carrier is connected. |
| Holding finance and placements | Dependent on external integration | `jbm_financeiro` and `hr_placements` are not created by the bar installer. |
| Hosted homologation | Blocked | No empty isolated Supabase project was authorized. The two existing projects stay protected. |

## What was already working locally

- Empty install through `sql/install_fresh.sql`, repeat install, and `sql/verify_schema.sql` summary OK on a disposable database.
- Bar isolation: a user of bar A does not read bar B. HQ requires live `platform_access` scope `hq`.
- Till and JBM books stay separate in `sales_indicator`.
- Void by a cashier is denied without changing the sale, the cash rows of that sale, or stock. The denial is local and is dropped by an explicit rollback.
- Procurement tasks are limited to the assignee and a bar they can access. Suppliers do not call the employee task list.
- Missing procurement prices do not become zero and do not use the old 2.8 client estimate.

## Problems found in this pass

- Sangria and suprimento were not functions. An in-memory drawer in `operationalTransactions.js` and the demo copy are not the SQL ledger.
- Night close in the POS screen wrote `pos_shifts` and did not call `cash_close_night`, so the screen and the ledger could diverge.
- Unit comparison could be misread as one total across till and JBM.
- The assistant could be asked to explain a close without a deterministic source list or an explicit human-approval stop.

## Implementations in this pass

- `cash_drawer_move(bar, day, kind, amount, note, key)` in `sql/foundation/080_operations.sql`.
  - `sangria` inserts `saida`. `suprimento` inserts `entrada`. `referencia_tipo` is the kind.
  - Caller must pass `pos_require_bar` and have role caixa, gerente, cliente, admin, or jbm. Funcionario, fornecedor, and bar staff are rejected.
  - Same `(bar_id, idempotency_key)` returns the existing row and `duplicate: true`.
  - Sangria above `cash_drawer_expected` raises `drawer short` and inserts nothing.
  - A row in `cash_closings` for that bar and day raises `already closed`.
  - Sales and stock tables are not updated.
- POS night close calls `cash_close_night` before it writes the screen shift. The demo path still writes nothing.
- The night-close bar and the floor till (`PosFloor`, tablet and phone pay step) record a drawer movement only when the session is not the local demo. In the demo, the till says nothing is written and does not show a save button for sangria.
- `compareBarIndicators` in `src/lib/saleBooks.js`.
- `explainCashClose` in `src/lib/cashCloseExplain.js`. `executed` is false and `requiresApproval` is true. Missing integers leave variance null.
- `sql/verify_schema.sql` expects `cash_drawer_move`.

## Ecosystem flow

The local chain remains BAR order, central procurement task, purchase record, shipment, transport advance, bar receipt, stock `entrada`, indicator read, and audit rows. This pass does not add a fake carrier, a fake bank, or a fake model call. Indicator reads keep using `sales_indicator` for one book.

## Files in this pass

- `sql/foundation/080_operations.sql` — `cash_drawer_move`
- `sql/verify_schema.sql` — expected function row
- `scripts/foundation.pg.test.mjs` — known amounts for sale, stock, drawer, close variance, receipt
- `src/components/AtomicPos.jsx`, `src/components/PosFloor.jsx`, `src/components/pos/FloorDrawerControls.jsx`, `src/components/pos/PosTablet.jsx`, `src/components/pos/PosMobile.jsx`
- `src/lib/saleBooks.js`, `src/lib/cashCloseExplain.js`
- `src/components/DemoModeBanner.jsx`, `src/lib/localDemoClient.js` — local demo portal switch
- `src/index.css`, `src/locales/en.js`, `src/locales/ja.js`

## Known amounts from `npm run test:foundation`

The disposable database is `atomic_bar_foundation_test` on `127.0.0.1`. Users are fictional.

| Step | Input | Expected | Obtained |
| --- | --- | --- | --- |
| Stock arithmetic | entrada 1, entrada 4, perda 1, estorno 1 | on hand 5 | 5 |
| Concurrent saida of 5 | two callers, on hand 5 | one commit, on hand 0 | one success, the other `insufficient stock`, on hand 0 |
| Restock then unit sale | entrada 3, then 1 unit at `preco_drink` 2500 | on hand 2 | 2 |
| Sale math | qty 1 × 2500, discount 100, cash 1400, card 1000 | total 2400, discount 100, fee round(1000 × 0.0378) = 38 | 2400, 100, 38 |
| Drawer | suprimento 200, same key again, sangria 200 | expected 1600, still 1600, then 1400 | those three values; two movement rows |
| Night close | counted 1400 | expected 1400, counted 1400, difference 0 | 1400, 1400, 0 |
| Variance night `2020-01-15` | suprimento 500, counted 450 | expected 500, counted 450, difference −50 | 500, 450, −50 |
| Receipt | shipment quantity 2 | stock `entrada` with note `JBM ship` equals 2 | 2 |
| Payroll | employee A line 200000 | A sees 1 row, B sees 0 | 1 and 0 |

Unauthorized void returns NULL and leaves `refunded` 0. A later authorized void sets `void_status` void and `refunded` 2400, with one `applied` audit row. A second void raises `already void` and the applied audit count stays 1. Cashier update of `pos_vendas.total` is denied. Cashier insert into `pos_void_audit` is denied. Supplier B cannot read supplier A's link or tracking. Manager B cannot read bar A sales. An explicit rollback of a denied void is the session behavior already recorded in `docs/database/known-limitations.md`: the denial insert shares the statement transaction.

`explainCashClose({ expected: 1400, counted: 1300 })` returns variance −100 and `executed: false`. A missing counted value leaves variance null.

## Local run

`docs/database/fresh-install-guide.md` is the installer. Automated coverage uses `npm run test:foundation`, which creates the disposable database and refuses a `supabase.co` host. The browser preview is `npm run dev`. The banner switch labeled DEMO portal changes only the fictional profile in this browser.

## Browser passes on 3 October 2026

Local Vite at `http://127.0.0.1:5175/`. No page error was recorded. Horizontal overflow was 0 at 1280, 768, and 390 for Bar, POS, Employee, Supplier, and HQ. The banner states the books are fictional.

| Surface | What was exercised |
| --- | --- |
| Bar, gerente, `#/hq` | Home opened. Orders navigation shows the demo sentence that this sign-in does not submit an order. |
| POS, caixa, `#/pos` | Till opened. Demo copy says sangria is not written. At 390, after clearing `POS_DEVICE_MODE`, the floor mode was `mobile`. |
| Employee, funcionario, `#/jbm` | Clock opened. Clock in changed the text to clocked in. My goals with an empty note returned `Add a short note`. The page says the punch is not a live payroll run. |
| Supplier, fornecedor | Purchase orders opened with the sentence that nothing is sent to a supplier. |
| HQ, admin, `#/jbm` | Dashboard opened with the sentence `Fictional DEMO books` above the figures. |

Screens not clicked in this pass include rent, tax, accountant, and every house-cost form. Those remain classified from the code, not from a click.

## Definition of done

Classification of this branch: **partially complete locally**. Integrity checks below passed. The product is not cleared for production. Hosted homologation stays blocked.

| Item | Result | Evidence |
| --- | --- | --- |
| Four portals opened in the local demo | Recorded | Browser table above. 0 page errors. |
| Module inventory classified | Recorded | Classification table in this file. Unclicked house-cost screens are not described as exercised. |
| Sale, discount, payment, drawer, stock, void, close, variance, purchase, receipt | Recorded on local Postgres | Known-amounts table. `npm run test:foundation` exit 0 after those assertions. |
| Duplicate financial operation | Recorded | Same payment key returns the same id. Same order key sets `replayed` true. Same drawer key sets `duplicate` true. |
| Invalid data and rollback | Recorded | `drawer short`, `insufficient stock`, `sale price not configured`, empty leave note. Stock race rolls the loser back. |
| Two bars, employee pay, supplier orders, cashier admin denial | Recorded | Foundation assertions for bar B, employee B, supplier B, cashier SQL denial. |
| Secret strings absent from the repo | Not approved | This pass added none. Pre-existing credential-shaped strings remain in `src/lib/supabase.js` and `api/_supabaseAdmin.js`. They were not printed. |
| Tests used protected Supabase data | Not observed | Foundation URL is local. `npm run test:supabase` checks the target guard. |
| `npm run build` | Passed | Vite build exit 0. Existing `import.meta` CJS warning and chunk-size warning remain. |
| `npm run test:pos` | Passed | `pos floor tests passed` |
| `npm run test:procurement` | Passed | 36 checks |
| `npm run test:supabase` | Passed | |
| `npm run test:readiness` | Passed | |
| `npm run test:books` and `npm run test:ai` | Passed | Extra commands, present in `package.json`. |
| Remote SQL, remote table change, production data change | Not performed in this workspace | No command targeted the protected refs. |
| Vercel Production variables | Not verified in the Vercel dashboard | This diff does not change an env file or call the Vercel API. |
| Deploy | Not performed | `npm run deploy` was not run. |
| PR merged | Not merged | PR 79 is open, draft, `mergedAt` null, base `cursor/existing-supabase-audit-9d4b`. |

## Tests

Commands required by the task, run on this machine against local PostgreSQL or pure unit checks:

- `npm run test:foundation`
- `npm run test:pos`
- `npm run test:procurement`
- `npm run test:supabase`
- `npm run test:readiness`
- `npm run build`

Additional checks for this pass:

- `npm run test:books`
- `npm run test:ai`

Results on this machine after the variance, stock, receipt, and demo-portal changes:

| Command | Result |
| --- | --- |
| `npm run test:foundation` | Passed. Includes the known-amounts table: on hand 2 after the unit sale, drawer back to 1400, close difference 0, odd-night difference −50, receipt quantity 2. |
| `npm run test:pos` | Passed. |
| `npm run test:procurement` | Passed. 36 checks. |
| `npm run test:supabase` | Passed. |
| `npm run test:readiness` | Passed. |
| `npm run test:books` | Passed. Includes mixed-book and missing-indicator totals staying null. |
| `npm run test:ai` | Passed. Includes the deterministic close explanation and the missing-figure case. |
| `npm run build` | Passed. Existing Vite CJS `import.meta` warnings and the chunk-size warning remain. |

No required command failed. The Node module-type warning is pre-existing. `package.json` was not given `"type": "module"`.

## Limitations

- Schema is not applied to any Supabase project.
- Denied-void persistence on a hosted RPC is not proven.
- `create_order` still prices `produtos.preco_venda` for the bar-scoped product row.
- HQ still sees the procurement location catalog by design.
- Employee requests, tasks, and announcements are not a live module.
- No Gemini key is configured in this environment. The assistant must keep saying the model is not configured. `explainCashClose` is not a model.
- The demo ledger is unchanged and must not be described as the database.

## External dependencies

- Supabase Auth and the two protected projects, unused here.
- Gemini, unused unless `GEMINI_API_KEY` is set outside this repository. This pass does not set it.
- Vercel production, unused.
- No payment processor, no carrier, and no payroll bank file.

## Next steps

1. Create a new empty Supabase project that is neither protected ref, confirm it has no bar or client data, and authorize that ref outside the repo.
2. Run the installer only on that empty database, then repeat the local operational script against fictional users.
3. Do not point the demo, Vercel production, or the two existing projects at that database until that checklist is signed.
