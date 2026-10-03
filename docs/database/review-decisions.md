# Review decisions

These rules are part of the local foundation install (`sql/foundation/095_review.sql` and the `pos_void_sale` body in `sql/pos_floor.sql`). They were not applied to a hosted Supabase project. They are not a production-ready claim.

## Void

`pos_void_sale` is `SECURITY DEFINER` and checks the caller inside PostgreSQL.

Allowed:

- `perfis.role = gerente` and `perfis.bar_id` is the sale bar
- a live `bar_memberships` row with `role = gerente` for that bar
- `admin` or `jbm` with live `platform_access.scope = hq`

The approver argument must be the caller. Belonging to the bar is not enough. `caixa`, `funcionario`, `bar_staff`, and `fornecedor` cannot void. A gerente of another bar fails `pos_require_bar` before the void rule. A `jbm` profile without HQ fails the same bar check.

A successful call inserts `pos_void_audit` with `user_id`, `bar_id`, `venda_id`, `reason`, `result = applied`, and `created_at`.

A denied call raises `void not allowed` or `bar not allowed`. That exception aborts the statement, so a denial row is not kept. The sale's `refunded` stays unchanged. Recording denials would need a separate committed transaction. That mechanism is not in this install.

## Prices

None of `drink_menu`, `bar_pricing`, or `bar_product_prices` was dropped. The app still reads all three.

| Operation | Function argument | Source | Used by |
| --- | --- | --- | --- |
| Till drink | `operation_price(..., 'pos_drink')` | `drink_menu.preco_venda` for that bar and drink | `pos_close_ticket`, Atomic POS, client portal |
| Till sealed unit | `operation_price(..., 'pos_unit')` | `bar_pricing.preco_drink` | `pos_close_ticket`, Atomic POS |
| Procurement | `operation_price(..., 'procurement')` | active `bar_product_prices.sale_price` | Procurement board, bar orders |

`operation_price` returns null when that source has no row. It does not substitute a till price for a procurement price, or the reverse. `price_conflict` reports when the till unit price and the procurement price are both present and different.

`resolve_bar_price` is unchanged. It still uses `bar_product_prices` and then `produtos.preco_venda`. That fallback is the legacy order book (`create_order` and some fulfillment audience paths). It is not a POS price. Callers that need a procurement price without that fallback use `operation_price(..., 'procurement')`.

`bar_catalog.sale_price` remains the activation and stock-policy row. It is not one of the three sale-price paths above.

## Sales books

| Book | Table | Official for | Writers |
| --- | --- | --- | --- |
| Till | `pos_vendas` | Atomic POS, manager till totals, AI operations center, guest and space tabs, drink-back, auto-close | `pos_close_ticket` inserts. `pos_void_sale` updates `refunded` and `void_status`. `src/lib/atomicPos.js` can insert and delete when the browser till is used. |
| JBM | `vendas` | Vendas, Faturas, Relatorio, Configs, Portal Cliente, Ryoshusho, client analytics, holding sync, notifications | `create_order` in `sql/pos_sale_security.sql`. `src/lib/pedidoVenda.js` and `src/components/Vendas.jsx` insert or update. Configs can delete the auto-order sale. |

`sales_indicator('till', bar)` sums `pos_vendas.total` for that bar, including a voided row whose `total` was not reduced. `sales_indicator('jbm', bar)` sums `vendas.total`. Any other book name raises `unknown sales book`. The function does not add the two sums.

`src/lib/costBooks.js` already keeps the till total and the JBM bill in separate fields. `booksGrandTotal` returns null.

No trigger copies a row from one table to the other. A copy would need an explicit idempotency key that is not defined here.

## Grants

Policies that exist and still have no table privilege for `authenticated`:

- `order_supplier_items` (`items_read`)
- `fulfillment_events` (`events_read`)
- `delivery_confirmations` (`confirm_read`)
- `supplier_purchase_requests` (`purchase_read`)
- `audit_logs` (`audit_jbm`)

`audit_logs` stays closed on purpose. `_fulfillment_audit` writes it as `SECURITY DEFINER`.

Granted to `authenticated`, with RLS still applied:

- `supplier_users`: `SELECT`, `INSERT`, `UPDATE` (portal read, HQ upsert). No `DELETE`.
- `supplier_products`: `SELECT`
- `supplier_routing_rules`: `SELECT`, `INSERT`, `UPDATE` (HQ upsert). No `DELETE`.
- `pedido_fulfillment`: `SELECT`
- `order_supplier_assignments`: `SELECT`
- `fulfillment_alerts`: `SELECT`

`fulfillment_alerts` has an `UPDATE` policy and no `UPDATE` grant. The app only selects alerts. A bar user cannot mark `read_at` through SQL until that grant is added on purpose.

## Installer

`sql/install_fresh.sql` keeps `ON_ERROR_STOP` and now includes `095_review.sql` after `090_security.sql`. An empty database and a second run of the same file are both supported. `sql/verify_schema.sql` remains a read-only inventory. Rollback limits are in `docs/database/fresh-install-guide.md`.

## Open risks

- Denied voids are not stored in `pos_void_audit`.
- `resolve_bar_price` can still disagree with `operation_price(..., 'procurement')` when `bar_product_prices` is missing and `produtos.preco_venda` is set.
- `sales_indicator('till')` includes voided `pos_vendas.total`. Net till sales are `total - refunded`, and this function does not subtract `refunded`.
- The browser demo ledger is not this database.
- `get_my_procurement_tasks` still returns locations without a bar filter.
- This install has not been executed on Supabase. Protected projects were not contacted.
