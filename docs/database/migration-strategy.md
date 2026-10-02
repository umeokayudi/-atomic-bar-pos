# Migration strategy

## Fresh database

`sql/install_fresh.sql` creates the catalog the later files alter. No hidden table is required. `supplier_users` is created before `my_supplier_ids()` because that SQL function is parsed at creation time.

## Existing database

Do not run `sql/install_fresh.sql` against production. The foundation uses `CREATE TABLE IF NOT EXISTS`. On a database that already has these tables with a different shape, the existing table is kept and a later `ALTER` or policy can fail. That failure is intentional. Production columns were not inspected.

`CREATE OR REPLACE` updates function bodies. `sql/foundation/090_security.sql` replaces `user_can_access_bar`, `is_jbm`, `is_procurement_hq`, and `is_payroll_hq`. After that file, HQ access requires `platform_access`. Applying only the older files leaves the previous rule, where role `jbm` is HQ.

## Books that stay separate

| Name | Role |
|---|---|
| `pos_vendas` | Till sale |
| `vendas` | JBM book from `create_order` |
| `pedidos` | Bar replenishment order |
| `bar_pricing`, `drink_menu` | Till price |
| `bar_product_prices` | Procurement price |
| `bar_catalog` | Activation, cost, stock policy |
| `produtos` | Global identity, or a legacy bar-scoped row when `bar_id` is set |

No script copies `vendas` into `pos_vendas` or the reverse.

## Repeat and failure

The install is idempotent on the disposable database used by `npm run test:foundation`. A statement that fails inside a transaction rolls back. The foundation test opens a transaction, creates a probe table, divides by zero, and checks that the probe table is absent.

## Not part of install

`seed_usuarios.sql`, `RESET_UMEOKAGROUP.sql`, and `NOVO_BAR.sql` write logins or bar rows. Do not run them as schema.
