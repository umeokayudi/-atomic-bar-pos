# Known limitations

- Production schema was not read. Foundation columns are the ones this repository already selects or writes, plus proposed tables `bar_catalog`, `pos_sale_payments`, `cash_closings`, `pos_settings`, `bar_memberships`, and `platform_access`.
- Three price paths remain: `drink_menu` / `bar_pricing` for the till, `bar_product_prices` for procurement, and `produtos.preco_venda` for `create_order` when `produtos.bar_id` matches the bar.
- `vendas` and `pos_vendas` are still two books. Nothing copies history between them.
- `pos_settings.tax_rate` defaults to 0. The demo ledger's 10 percent is browser-only.
- Card processor fee stays a `caixa_movimentos` row with `referencia_tipo = taxa_cartao`. Drawer math excludes that type. A report that sums every cash row will still see the fee.
- `confirm_bar_shipment` had a variable named `obs` that collided with `estoque_movimentos.obs`. The variable is now `ship_note`. The written text is unchanged.
- Several fulfillment and procurement tables still have RLS and no `GRANT` to `authenticated` in the original files. `supplier_users` is granted `SELECT` so the portal query is not rejected before RLS. Other tables follow the original files.
- `get_my_procurement_tasks` still returns active locations of types warehouse, store, supplier, and other without a bar filter. That behavior was not rewritten.
- Holding tables `jbm_financeiro` and `hr_placements` are not created.
- No down migration. Rollback of a disposable database is `DROP DATABASE`.
- The install has not been executed on Supabase. Protected projects were not contacted.
- The browser demo (`atomic-bar-demo-ledger`) is unchanged and is not this database.
- This database foundation is not a production-ready claim. Staging Supabase was not connected, and production data was not migrated.
