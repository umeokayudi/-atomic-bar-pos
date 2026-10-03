# Canonical architecture

This is the schema a clean database gets from `sql/install_fresh.sql`. It is a proposed canonical design. Production was not read. The files named `docs/production-readiness.md`, `docs/production-schema-evidence.md`, `docs/security-model.md`, `docs/migration-readiness-decision.md`, `docs/migration-legacy-audit.md`, and `sql/migration_final.sql` are not in this repository.

## Tenancy

Operational rows carry `bar_id` where the application already filtered by bar. `user_can_access_bar` allows a profile whose `perfis.bar_id` matches and whose role is `cliente`, `gerente`, `caixa`, `bar_staff`, or `funcionario`. `bar_memberships` is an extra explicit grant. `admin` reaches every bar only with a `platform_access` row of scope `hq`. Role `jbm` does not. A JBM user with `platform_access` can open a till on another bar, and that call is written to `platform_access_audit`.

## Identity

`perfis.id` references `auth.users`. Authentication stays in Supabase Auth. The local `auth.uid()` stub exists only when the function is absent. It reads `request.jwt.claim.sub` or `pos.test_actor`. It stores no passwords.

Roles kept as profile values: `admin`, `jbm`, `gerente`, `caixa`, `bar_staff`, `funcionario`, `fornecedor`, plus the existing `cliente` and `staff` values the current policies already name.

## Catalog

`produtos.bar_id` null is a global product. A non-null `bar_id` is the legacy bar-scoped row `create_order` still requires. `bar_catalog` is the bar activation, cost, stock policy, and minimum stock. Precedence by operation is in `docs/database/review-decisions.md`: `drink_menu` for a till drink, `bar_pricing` for a till sealed unit, `bar_product_prices` for procurement. `operation_price` does not fall through from one of those to another. `resolve_bar_price` still falls back to `produtos.preco_venda` for the legacy order book. One product can be sold by more than one bar. Historical rows are not merged.

## Sales

`pos_vendas` is the till sale written by `pos_close_ticket`. `vendas` is the JBM book written by `create_order` and by the JBM screens. `sales_indicator('till')` and `sales_indicator('jbm')` each sum one table. This install does not copy one into the other.

A till close separates subtotal, `discount_total`, payments in `pos_sale_payments`, card fee, and cash. Cash drawer lines are written only for cash amounts. A card fee is one `taxa_cartao` line and is excluded by `cash_drawer_expected`. Split payments must sum to the net before `pos_close_ticket` commits. A second close of the same ticket returns the existing sale.

Tax is `pos_settings.tax_rate`. The default is 0. The function `tax_on` does not invent a rate. The browser demo still shows its own labeled 10 percent and does not write this table.

## Stock

`estoque_movimentos` is the bar ledger. `stock_post` refuses a sale, waste, or transfer that would pass a `block` policy with insufficient quantity. It does not clamp the balance to zero. `locations` remains the procurement warehouse, supplier, and bar location book. Warehouse quantity is `procurement_stock_moves`, not a second bar ledger.

## What is implemented

Fresh install, repeat install, till discount, split cash and card, cash close, stock races, procurement through bar confirmation, payroll lines, and the RLS checks in `scripts/foundation.pg.test.mjs`.

## What is not claimed

Production parity, a single price path, tax law, and replacement of the browser demo ledger.
