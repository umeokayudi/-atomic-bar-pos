# Known limitations

- Production schema was not read. Foundation columns are the ones this repository already selects or writes, plus proposed tables `bar_catalog`, `pos_sale_payments`, `cash_closings`, `pos_settings`, `bar_memberships`, and `platform_access`.
- Three price paths remain on purpose. Procurement resolution no longer falls back to `produtos.preco_venda`. See `docs/database/review-decisions.md`.
- `vendas` and `pos_vendas` stay separate. `sales_indicator` returns gross, refunds, net, and counts for one book. A voided till row stays stored and contributes 0 to net.
- `pos_settings.tax_rate` defaults to 0. The demo ledger's 10 percent is browser-only.
- Card processor fee stays a `caixa_movimentos` row with `referencia_tipo = taxa_cartao`. Drawer math excludes that type. A report that sums every cash row will still see the fee.
- `confirm_bar_shipment` had a variable named `obs` that collided with `estoque_movimentos.obs`. The variable is now `ship_note`. The written text is unchanged.
- A denied void is stored only when `dblink` can open a passwordless local connection. That works on this PostgreSQL 16 cluster. It is not yet proven on Supabase.
- Fulfillment tables with RLS and no table `GRANT` to `authenticated`: `order_supplier_items`, `fulfillment_events`, `delivery_confirmations`, `supplier_purchase_requests`, `audit_logs`. `fulfillment_alerts` has an `UPDATE` policy and only `SELECT` is granted.
- `get_my_procurement_tasks` still returns active locations of types warehouse, store, supplier, and other without a bar filter. That behavior was not rewritten.
- Holding tables `jbm_financeiro` and `hr_placements` are not created.
- No down migration. Rollback of a disposable database is `DROP DATABASE`.
- The install has not been executed on Supabase. Protected projects were not contacted.
- The browser demo (`atomic-bar-demo-ledger`) is unchanged and is not this database.
- This database foundation is not a production-ready claim. Staging Supabase was not connected, and production data was not migrated.
