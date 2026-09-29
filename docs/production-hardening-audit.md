# Production hardening audit

This pass did not query production, did not run production SQL, and did not deploy. Classifications are from the repository and from the earlier read-only schema notes in `docs/production-schema-evidence.md`. A green `npm run build` is not evidence that a shift can be worked on the live bar.

Labels:

- **WORKING** — the path exists in code and is covered by a local test that does not need the live database.
- **PARTIALLY WORKING** — the path exists, but a required piece is missing, unverified, or only works after `sql/migration_final.sql`.
- **BROKEN** — the current code does the wrong thing for an operator who is already on the live database.
- **MISSING** — the product does not have this behavior.
- **PRODUCTION BLOCKER** — the live shift chain cannot be claimed until this is resolved. Several blockers are the same fact: the floor, clock, procurement, and employee tables were not present in the last read-only look at production, and that migration has not been applied.

No new `sql/production_hardening.sql` was added. The additive migration is already `sql/migration_final.sql`. It is READY FOR REVIEW and not applied. A second file would diverge from it. Applying it is still blocked on the external checks in `docs/production-schema-evidence.md`.

## Chain the operator needs

Real employee → Auth session → profile role and bar → POS → sale → payment → cash → inventory movement → closed ticket → dashboard → report → shift close.

That chain is **not** satisfied on today's production schema.

## Classification

| Area | Label | What the repo shows |
|---|---|---|
| Supabase Auth session for POS and employees | PARTIALLY WORKING | The client now uses `signInWithPassword` only. A `perfis` row is not a session. Live login was not executed. |
| Lane token login | BROKEN as an operator path, left on the server | `pos@atomic.bar` and `funcionario@atomic.bar` no longer enter through `/api/bar/lane-login`. The API still exists. Those emails do not become real users by themselves. |
| Profile, role, bar | PARTIALLY WORKING | Invite writes `auth.users`, `perfis`, and `bar_employees` when the service role and the table exist. Production was last seen without `bar_employees`. |
| Password setup and reset | PARTIALLY WORKING | Invite and `resetPasswordForEmail` are in the client. `jbmtech.vercel.app` is now an allowed redirect origin in code. It is not deployed. |
| Suspended / inactive login | PARTIALLY WORKING | The client signs those statuses out. The staff API bans them when the service role is present. Not tested against Auth. |
| POS floor sale and payment | PRODUCTION BLOCKER | `PosFloor` closes with `pos_close_ticket` or `pos_close_with_charges`. Idempotency is in `sql/pos_floor.sql` (`pos_idempotency`). Those objects were not in the last production read. |
| Classic till `commitPosSale` | PARTIALLY WORKING | Still inserts `pos_vendas` directly and can move stock. It is not the floor close. Production was last seen without `pos_vendas`. |
| Cash reconciliation | PARTIALLY WORKING | `reconcileNight` sums tenders and card-fee movements. Expected cash is the night's cash tender, not opening float plus cash sales. Manual close now refuses a blank count so an empty field cannot be stored as a perfect match. Automatic close still writes counted cash equal to expected cash. |
| Inventory movement on a floor sale | PRODUCTION BLOCKER | The floor close is designed to record movements in SQL that is not applied. Bottle open in the bar stock screen writes `estoque_movimentos` only. `produtos.estoque_atual` is not the bar balance. |
| Dashboard and hourly bars | PARTIALLY WORKING | Numbers come from loaded `pos_vendas`. Gross margin stays "Insufficient data" when product cost is not on the ticket. If production has no `pos_vendas`, the desk is empty rather than wrong. |
| Reports vs till | UNKNOWN on production | Reports can read `vendas` and `pos_vendas`. Those are two books and must not be added together. Equality with the till was not measured on live data. |
| Floor tables | PRODUCTION BLOCKER | `bar_spaces` and visits are in the unapplied migration. Last production read did not show them. |
| Orders / procurement / supplier | PARTIALLY WORKING in code, PRODUCTION BLOCKER on the live database | Local procurement tests pass (36). Fulfillment tables were not in the last production read. The procurement design was not rewritten. |
| Employees invite | PARTIALLY WORKING | Manager invite is server-side and does not accept a password. It fails closed without `SUPABASE_SERVICE_ROLE_KEY` or without `bar_employees`. |
| Time clock | PRODUCTION BLOCKER | `time_clock` was not in the last production read. A break is not a punch type. |
| Payroll | PARTIALLY WORKING as math, BLOCKED on live hours | `payrollCore` does not invent a transport line. It cannot read punches that the live database does not store. |
| Multi-bar isolation | PARTIALLY WORKING in SQL tests, UNKNOWN on production policies | Staff routes take `bar_id` from the profile. Policies for `vendas`, `pedidos`, `perfis`, and `produtos` are not in this repo. |
| Mobile layout | PARTIALLY WORKING | Phone tables become cards. Login at 390px on `#/pos` showed the sign-in form. Authenticated POS, payment, and clock were not clicked. |
| Security model in repo SQL | WORKING as a static test | `test:security` checks `search_path`, no `USING (true)` after comment strip, and no service role in `src/lib/supabase.js`. That does not prove production policies. |

## Critical blockers

1. `sql/migration_final.sql` is not applied. Floor tickets, `pos_vendas`, time clock, `bar_employees`, and procurement tables were absent from the last production read.
2. Policies on `vendas`, `pedidos`, `perfis`, and `produtos` are unread. Enabling RLS there without that read is forbidden.
3. No disposable Supabase Auth project was available, so login, invite, refresh, and logout were not executed against Auth.
4. A live sale was not clicked, so payment, stock, cash, dashboard, and close were not observed on one ticket.

## What this pass changed in code

Manual night close in `AtomicPos` no longer treats a blank counted-cash field as equal to expected cash. The variance formula is unchanged. Automatic close is unchanged and still records a zero variance.
