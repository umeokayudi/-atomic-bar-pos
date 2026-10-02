# Database object inventory

Classification uses the repository, not a live database. Objects created by `sql/install_fresh.sql` are in the repo. Production-only objects, if any, are unknown.

Dependency order is the order in `sql/install_fresh.sql`.

## Classification

| Class | Objects |
|---|---|
| CORE | `auth.users` (stub only when missing), `bars`, `perfis`, `bar_memberships`, `platform_access`, `platform_access_audit`, `schema_install` |
| LEGACY | `vendas`, `vendas_itens`, `cast_members`, `cast_comissoes`, `create_order`, `deduct_stock` |
| POS | `pos_vendas`, `pos_vendas_itens`, `pos_tickets`, `pos_ticket_items`, `pos_bottles`, `pos_bottle_moves`, `pos_recipes`, `pos_recipe_lines`, `pos_idempotency`, `pos_sale_events`, `pos_sale_payments`, `pos_shifts`, `pos_settings`, `drink_menu`, `bar_pricing`, `discount_codes`, till functions in `sql/pos_floor.sql`, `pos_apply_discount`, `pos_take_payment` |
| FINANCE | `caixa_movimentos`, `cash_closings`, `faturas`, `fatura_pagamentos`, `ryoshusho`, `compras`, `compras_itens`, `cash_drawer_expected`, `cash_close_night`, `tax_on` |
| INVENTORY | `estoque_movimentos`, `estoque_regras`, `stock_post`, `stock_on_hand`, `pos_bottles` |
| PROCUREMENT | tables and functions in `sql/procurement.sql` |
| SUPPLIER | `fornecedores`, `fornecedor_precos`, `supplier_users`, `supplier_products`, fulfillment tables in `sql/supplier_fulfillment.sql` |
| FLOOR | `bar_spaces`, `bar_visits`, `bar_guests`, `bar_bottle_keeps`, `pos_tickets` |
| STAFF | `time_clock`, `staff_clock`, `drink_back_agents` |
| PAYROLL | tables and functions in `sql/payroll.sql` |
| CRM | `vip_members`, `vip_usages`, `bar_guests` |
| REPORTING | `produtos_public`, `bar_hq_meta`, `bar_overhead` |
| AUDIT | `audit_logs`, `platform_access_audit`, `payroll_audit`, `pos_sale_events` |
| DEMO ONLY | browser key `atomic-bar-demo-ledger`. No table. |
| DEPRECATED | none removed. `deduct_stock(uuid, integer)` and the five-argument `pos_void_sale` stay dropped |

## Conflicts kept on purpose

- Global `produtos` versus `create_order`, which still filters `produtos.bar_id`.
- Till price versus procurement price versus `create_order` price.
- `pos_vendas` versus `vendas`.

## Extensions, enums, grants

No `CREATE EXTENSION` in the install. `gen_random_uuid()` is built in on PostgreSQL 13+. No enums. Checks are text constraints. Grants are `REVOKE` from `PUBLIC` and `GRANT` to `authenticated` on the functions and tables named in the SQL files. `anon` is not granted the new HQ functions.

## Auth

`perfis.id` references `auth.users`. Policies and `SECURITY DEFINER` functions call `auth.uid()`.
