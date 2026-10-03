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

Results on this machine, commit after `3432269`:

| Command | Result |
| --- | --- |
| `npm run test:foundation` | Passed. Includes suprimento, duplicate key, sangria back to 1400, drawer short, employee and supplier denial, other-bar denial, unchanged sales and stock, and a move rejected after close. |
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
