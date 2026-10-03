# Review decisions

Local foundation rules. They were not applied to a hosted Supabase project. Passing these tests does not make the database production-ready.

## Void and indicators

`pos_void_sale` still authorizes inside PostgreSQL. A cashier, funcionário, or fornecedor cannot void. A gerente of that bar, or admin/jbm with live HQ access, can. The approver must be the caller.

The original `pos_vendas` row stays. `total` is not reduced and the row is not deleted. `refunded` accumulates once. `void_status` becomes `partial_refund` or `void`. Cash movement for a void is a new `caixa_movimentos` row.

`sales_indicator(book, bar)` returns one book as jsonb:

| Field | Till (`pos_vendas`) | JBM (`vendas`) |
| --- | --- | --- |
| `gross` | Sum of original `total` | Sum of original `total` |
| `refunds` | Sum of `min(total, refunded)` once per row | 0. This book has no refund column |
| `net` | Valid amount. A row with `void_status` `void`, `cancelada`, or `cancelado` contributes 0. Otherwise `total` minus the capped refund, floored at 0 | Sum of `total` except rows whose `status` is `cancelada`, `cancelado`, `void`, or `estornada` |
| `transactions` | Count of rows still stored | Count of rows still stored |
| `valid_transactions` | Rows whose net amount is greater than 0 | Rows that are not in the cancelled statuses and have `total` greater than 0 |

`net` does not subtract a void twice. A full void with `refunded = total` is in `gross` and `refunds` once, and in `net` as 0. A second void of the same row is rejected. Two partial voids accumulate `refunded` on the same row; the indicator reads that column once.

`gross` is the historical book. `net` is the valid-sales figure. Reports that need both must read both fields. `sales_indicator` does not add `vendas` and `pos_vendas`.

Manager analytics and the AI sales note use the same net rule. Other screens that still add `pos_vendas.total` are listed under open risks.

## Prices

| Operation | Source | Missing, zero, or two prices |
| --- | --- | --- |
| Till drink | `drink_menu.preco_venda` for that bar and drink | `operation_price(..., 'pos_drink')` raises `sale price not configured` |
| Till sealed unit | `bar_pricing.preco_drink` | `operation_price(..., 'pos_unit')` raises `sale price not configured` |
| Procurement | active `bar_product_prices.sale_price` at the highest matching `minimum_quantity` | `resolve_bar_price` raises `sale price not configured` or `ambiguous sale price` |

`resolve_bar_price` does not read `produtos.preco_venda`, `drink_menu`, or `bar_pricing`. A global product (`produtos.bar_id` null) and a bar-scoped product both need a `bar_product_prices` row for a new procurement order. The legacy `create_order` function still prices a bar-scoped `produtos` row for the JBM `vendas` book. That path is not procurement.

`pedidos_itens.preco_unitario` is the price captured when the order was submitted. Tracking reads that column. It does not re-price history.

`price_conflict` reports the two till-unit and procurement numbers when both exist. A missing side stays null in that diagnostic. It does not copy the other price into the gap.

## Fulfillment privileges

The app selects `supplier_users`, `order_supplier_assignments`, and `fulfillment_alerts` (supplier portal), and selects `pedido_fulfillment`, `fulfillment_alerts`, `supplier_routing_rules`, and `supplier_products` (HQ). HQ upserts `supplier_routing_rules` and `supplier_users`. No API writes these tables directly. Nothing in the app updates `fulfillment_alerts.read_at`.

Granted to `authenticated`, with RLS still applied:

- `supplier_users`: `SELECT`, `INSERT`, `UPDATE`. No `DELETE`
- `supplier_products`: `SELECT`
- `supplier_routing_rules`: `SELECT`, `INSERT`, `UPDATE`. No `DELETE`
- `pedido_fulfillment`: `SELECT`
- `order_supplier_assignments`: `SELECT`
- `fulfillment_alerts`: `SELECT` only

No table grant, despite a policy:

- `order_supplier_items`
- `fulfillment_events`
- `delivery_confirmations`
- `supplier_purchase_requests`
- `audit_logs` (written by `_fulfillment_audit`)
- `UPDATE` on `fulfillment_alerts`

There is one login role, `authenticated`. Bar and supplier separation is RLS, not a second login role. A supplier sees only their `supplier_users` row and supplier-audience alerts. A bar user does not see another bar's alerts.

## Denied void audit

`pos_void_audit.result` is only `applied` or `denied`. Callers have `SELECT`. They do not have `INSERT`, `UPDATE`, or `DELETE`. The void function writes `applied` in the same transaction as the money movement. A rollback removes both.

`denied` is written by `pos_record_void_denial` through `dblink`, then the void raises. The denial survives the aborted statement. The reason is truncated text. No token or secret is stored. The caller cannot choose `result`.

`dblink` is revoked from `PUBLIC`. Only the security-definer function uses it. The connection string is `dbname=<current database>` and contains no password. On this local cluster the server user connects by peer authentication.

## Installer

`sql/install_fresh.sql` still stops on the first error, installs on an empty database, and can be run again. `sql/verify_schema.sql` only reads. There is no down migration. Rollback of a disposable database is `DROP DATABASE`. A failed statement rolls back only its own transaction; earlier statements in the script stay.

## Open risks

- Denied-void audit depends on `dblink` and a passwordless local connection as the database server user. An isolated Supabase project must enable the extension and prove one denied void leaves a `denied` row. If that connection fails, the void is still rejected, but the error may be the connection failure and the denial row will be missing.
- `get_procurement_board` and `task_economics` call `resolve_bar_price`. A task without `bar_product_prices` fails those reads instead of inventing a catalog price.
- `create_order` still uses `produtos.preco_venda` for a product whose `bar_id` is that bar. That is the legacy JBM sale, not the procurement price.
- Screens that still sum `pos_vendas.total` (`computeDayMetrics`, `barClose.periodReport`, goals, HQ filters, bar cost till total) show gross, including voided tickets. They are not `sales_indicator.net`.
- `get_my_procurement_tasks` can still return locations without a bar filter.
- This install has not been executed on Supabase. Protected projects were not contacted.
