# Security and tenant isolation

## Functions

New and replaced `SECURITY DEFINER` functions set `search_path = public`, revoke `PUBLIC`, and grant `EXECUTE` to `authenticated` only when a signed-in user must call them. Internal helpers such as `_ensure_bar_location` stay revoked from `PUBLIC`.

`pos_require_bar` allows:

- `user_can_access_bar`
- a live `bar_memberships` row
- `platform_access` scope `hq` for `admin` or `jbm`, and writes `platform_access_audit`

`is_jbm`, `is_procurement_hq`, and `is_payroll_hq` are true only for `admin` or `jbm` with that HQ grant.

`pos_apply_discount` allows `admin`, `gerente`, `cliente`, or an HQ grant. A cashier cannot discount.

`pos_void_sale` checks authorization inside the function. The caller must be the approver, and must be a `gerente` of that bar (profile or live membership) or an `admin`/`jbm` profile with live `platform_access` scope `hq`. A cashier who belongs to the bar cannot void. A successful void inserts `pos_void_audit` with `result = applied` in the same transaction. An authorization denial inserts `result = denied` in that same statement and returns NULL. The sale is not changed. Callers cannot update that row. There is no `dblink` connection and no database password in the function.

## RLS covered by the foundation test

Distinct users: admin, JBM with HQ, JBM without HQ, Bar A manager, Bar A cashier, Bar A staff, Bar B manager, supplier linked to a supplier row, supplier with no link, two employees of Bar A.

Checked:

- Bar B selects no Bar A `vendas` or `pos_vendas`
- Bar B cannot insert a Bar A `pedidos` row
- Bar A cashier cannot update `pos_vendas` (SELECT grant only)
- Bar B cannot load a Bar A ticket
- JBM without HQ or membership cannot load Bar B
- JBM with membership can
- JBM with HQ can, and the call is audited
- A supplier profile selects no `produtos` row, so cost is not visible
- An unlinked supplier selects no `supplier_users` row for the linked supplier
- Employee B selects no payroll line of employee A
- Bar B manager cannot open a payroll period

## Grants

Till and payroll writes go through functions. Direct `UPDATE` on `pos_vendas` is not granted to `authenticated`.

## Not fully closed

`task_economics` and other procurement functions are `SECURITY DEFINER` and can return cost to a caller who already passed their own checks. A supplier who is not a buyer and not HQ does not receive a table grant on `purchase_lines` from this install. Column-level hiding inside a JSON payload was not rewritten in this phase.

`pos_void_sale` no longer treats bar membership as void authority. `caixa` receives NULL and a `denied` row when the RPC commits. A session that issues `ROLLBACK` also drops that denial. Later business errors (`already void`, `refund exceeds`) still raise, so the money movement and the `applied` row stay together. This has not been executed on Supabase.
