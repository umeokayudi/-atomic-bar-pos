# Known limitations

- Production schema was not read. Foundation columns are the ones this repository already selects or writes, plus proposed tables `bar_catalog`, `pos_sale_payments`, `cash_closings`, `pos_settings`, `bar_memberships`, and `platform_access`.
- Three price paths remain on purpose. Procurement resolution no longer falls back to `produtos.preco_venda`. See `docs/database/review-decisions.md`.
- `vendas` and `pos_vendas` stay separate. `sales_indicator` returns gross, refunds, net, and counts for one book. A voided till row stays stored and contributes 0 to net.
- `pos_settings.tax_rate` defaults to 0. The demo ledger's 10 percent is browser-only.
- Card processor fee stays a `caixa_movimentos` row with `referencia_tipo = taxa_cartao`. Drawer math excludes that type. A report that sums every cash row will still see the fee.
- `cash_drawer_move` records sangria (`saida`) and suprimento (`entrada`) on `caixa_movimentos` for one bar and operational day. It is idempotent, refuses a sangria larger than `cash_drawer_expected`, and refuses a move after `cash_closings` exists for that night. It does not change `pos_vendas` or `estoque_movimentos`. Cashiers may move the drawer. Only the night-close roles may call `cash_close_night`. The browser demo does not call either function.
- `confirm_bar_shipment` had a variable named `obs` that collided with `estoque_movimentos.obs`. The variable is now `ship_note`. The written text is unchanged.
- A denied void is an insert in the same statement as the NULL return. Locally, the sale, cash rows, and stock count stay unchanged, and an explicit `ROLLBACK` drops the denial. The function does not use `dblink` and does not store a database password. Persistence of `denied` on Supabase is not proven.
- Fulfillment tables with RLS and no table `GRANT` to `authenticated`: `order_supplier_items`, `fulfillment_events`, `delivery_confirmations`, `supplier_purchase_requests`, `audit_logs`. `fulfillment_alerts` has an `UPDATE` policy and only `SELECT` is granted.
- `get_my_procurement_tasks` does not accept a bar id. An employee sees only tasks assigned to them on a bar they can access, and only locations linked to those tasks. A supplier cannot call it. HQ still sees the location catalog. Missing procurement prices set `price_state` to `unavailable` and leave revenue and margin null. The client portal no longer multiplies a JBM unit by 2.8.
- Holding tables `jbm_financeiro` and `hr_placements` are not created.
- No down migration. Rollback of a disposable database is `DROP DATABASE`.
- The install has not been executed on Supabase. Protected projects were not contacted.
- The browser demo (`atomic-bar-demo-ledger`) is unchanged and is not this database.
- This database foundation is not a production-ready claim. Staging Supabase was not connected, and production data was not migrated.
