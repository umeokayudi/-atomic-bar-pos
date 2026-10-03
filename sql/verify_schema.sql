-- Read-only inventory. Does not create, alter, or drop anything.
-- Run in the Supabase SQL editor after the install scripts.
-- A row is OK only when that object is present.
-- MISSING means the app or an install script expects it and it is not there.
-- CONFLICT means an old function overload is still installed.
-- This script does not connect to production by itself.

WITH expected(object_name, object_kind, module, detail) AS (
  VALUES
  ('cast_members', 'table', 'legacy', 'CREATE TABLE in migration.sql'),
  ('cast_comissoes', 'table', 'legacy', 'CREATE TABLE in migration.sql'),
  ('user_can_access_bar', 'function', 'pos-security', 'final body in sql/pos_sale_security.sql; earlier file is replaced'),
  ('deduct_stock', 'function', 'pos-security', 'final body in sql/pos_sale_security.sql; earlier file is replaced'),
  ('create_order', 'function', 'pos-security', 'final body in sql/pos_sale_security.sql; earlier file is replaced'),
  ('cast_members_bar_access', 'policy', 'pos-security', 'on cast_members; sql/pos_sale_security.sql'),
  ('cast_comissoes_bar_access', 'policy', 'pos-security', 'on cast_comissoes; sql/pos_sale_security.sql'),
  ('supplier_users', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('supplier_products', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('supplier_routing_rules', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('pedido_fulfillment', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('order_supplier_assignments', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('order_supplier_items', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('fulfillment_events', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('delivery_confirmations', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('supplier_purchase_requests', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('fulfillment_alerts', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('audit_logs', 'table', 'fulfillment', 'CREATE TABLE in sql/supplier_fulfillment.sql'),
  ('is_jbm', 'function', 'procurement', 'final body in sql/procurement.sql; earlier file is replaced'),
  ('my_supplier_ids', 'function', 'fulfillment', 'CREATE FUNCTION in sql/supplier_fulfillment.sql'),
  ('_fulfillment_audit', 'function', 'fulfillment', 'CREATE FUNCTION in sql/supplier_fulfillment.sql'),
  ('_fulfillment_alert', 'function', 'fulfillment', 'CREATE FUNCTION in sql/supplier_fulfillment.sql'),
  ('_touch_fulfillment', 'function', 'fulfillment', 'CREATE FUNCTION in sql/supplier_fulfillment.sql'),
  ('_rollup_order_status', 'function', 'fulfillment', 'CREATE FUNCTION in sql/supplier_fulfillment.sql'),
  ('fulfillment_next_status', 'function', 'fulfillment', 'CREATE FUNCTION in sql/supplier_fulfillment.sql'),
  ('route_pedido', 'function', 'fulfillment', 'CREATE FUNCTION in sql/supplier_fulfillment.sql'),
  ('supplier_advance', 'function', 'procurement', 'final body in sql/procurement.sql; earlier file is replaced'),
  ('bar_confirm_delivery', 'function', 'procurement', 'final body in sql/procurement.sql; earlier file is replaced'),
  ('get_order_tracking', 'function', 'fulfillment', 'CREATE FUNCTION in sql/supplier_fulfillment.sql'),
  ('scan_fulfillment_alerts', 'function', 'fulfillment', 'CREATE FUNCTION in sql/supplier_fulfillment.sql'),
  ('supplier_users_jbm', 'policy', 'fulfillment', 'on supplier_users; sql/supplier_fulfillment.sql'),
  ('supplier_users_self', 'policy', 'fulfillment', 'on supplier_users; sql/supplier_fulfillment.sql'),
  ('supplier_products_jbm', 'policy', 'fulfillment', 'on supplier_products; sql/supplier_fulfillment.sql'),
  ('supplier_products_self', 'policy', 'fulfillment', 'on supplier_products; sql/supplier_fulfillment.sql'),
  ('routing_jbm', 'policy', 'fulfillment', 'on supplier_routing_rules; sql/supplier_fulfillment.sql'),
  ('ff_jbm', 'policy', 'fulfillment', 'on pedido_fulfillment; sql/supplier_fulfillment.sql'),
  ('asg_read', 'policy', 'fulfillment', 'on order_supplier_assignments; sql/supplier_fulfillment.sql'),
  ('items_read', 'policy', 'fulfillment', 'on order_supplier_items; sql/supplier_fulfillment.sql'),
  ('events_read', 'policy', 'fulfillment', 'on fulfillment_events; sql/supplier_fulfillment.sql'),
  ('confirm_read', 'policy', 'fulfillment', 'on delivery_confirmations; sql/supplier_fulfillment.sql'),
  ('purchase_read', 'policy', 'fulfillment', 'on supplier_purchase_requests; sql/supplier_fulfillment.sql'),
  ('audit_jbm', 'policy', 'fulfillment', 'on audit_logs; sql/supplier_fulfillment.sql'),
  ('fulfillment_events_milestone_uidx', 'index', 'fulfillment', 'CREATE INDEX in sql/supplier_fulfillment.sql'),
  ('fulfillment_events_order_milestone_uidx', 'index', 'fulfillment', 'CREATE INDEX in sql/supplier_fulfillment.sql'),
  ('pedidos_status_idx', 'index', 'fulfillment', 'CREATE INDEX in sql/supplier_fulfillment.sql'),
  ('pedidos_bar_created_idx', 'index', 'fulfillment', 'CREATE INDEX in sql/supplier_fulfillment.sql'),
  ('osa_supplier_status_idx', 'index', 'fulfillment', 'CREATE INDEX in sql/supplier_fulfillment.sql'),
  ('fe_order_idx', 'index', 'fulfillment', 'CREATE INDEX in sql/supplier_fulfillment.sql'),
  ('sp_product_idx', 'index', 'fulfillment', 'CREATE INDEX in sql/supplier_fulfillment.sql'),
  ('sp_supplier_idx', 'index', 'fulfillment', 'CREATE INDEX in sql/supplier_fulfillment.sql'),
  ('alerts_audience_idx', 'index', 'fulfillment', 'CREATE INDEX in sql/supplier_fulfillment.sql'),
  ('ops_counters', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('procurement_settings', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('ops_closures', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('procurement_sources', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('procurement_source_products', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('procurement_routing_rules', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('locations', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('procurement_tasks', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('purchase_transactions', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('purchase_lines', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('shipments', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('shipment_items', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('procurement_stock_moves', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('bar_product_prices', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('replenishment_rules', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('order_idempotency_keys', 'table', 'procurement', 'CREATE TABLE in sql/procurement.sql'),
  ('is_procurement_hq', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('next_ops_code', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('parse_iso_days', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('procurement_deadlines', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('sync_supplier_procurement', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('resolve_bar_price', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('_ensure_bar_location', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('_ensure_source_location', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('_order_fully_at_bar', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('_close_order_if_covered', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('plan_procurement', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('submit_bar_order', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('task_economics', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('record_purchase', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('_stock_move', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('receive_procurement', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('create_shipment', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('advance_shipment', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('confirm_bar_shipment', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('fallback_task', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('flag_deadline_exception', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('release_open_quantity', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('get_procurement_tracking', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('get_procurement_board', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('get_procurement_tasks_hq', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('get_my_procurement_tasks', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('_audit_bar_price', 'function', 'procurement', 'CREATE FUNCTION in sql/procurement.sql'),
  ('procurement_sources_hq', 'policy', 'procurement', 'on procurement_sources; sql/procurement.sql'),
  ('procurement_sources_supplier', 'policy', 'procurement', 'on procurement_sources; sql/procurement.sql'),
  ('psp_hq', 'policy', 'procurement', 'on procurement_source_products; sql/procurement.sql'),
  ('psp_supplier', 'policy', 'procurement', 'on procurement_source_products; sql/procurement.sql'),
  ('prr_hq', 'policy', 'procurement', 'on procurement_routing_rules; sql/procurement.sql'),
  ('ptask_read_hq', 'policy', 'procurement', 'on procurement_tasks; sql/procurement.sql'),
  ('purchases_read', 'policy', 'procurement', 'on purchase_transactions; sql/procurement.sql'),
  ('purchase_lines_read', 'policy', 'procurement', 'on purchase_lines; sql/procurement.sql'),
  ('shipments_hq', 'policy', 'procurement', 'on shipments; sql/procurement.sql'),
  ('shipment_items_read', 'policy', 'procurement', 'on shipment_items; sql/procurement.sql'),
  ('locations_hq', 'policy', 'procurement', 'on locations; sql/procurement.sql'),
  ('locations_bar', 'policy', 'procurement', 'on locations; sql/procurement.sql'),
  ('bar_prices_hq', 'policy', 'procurement', 'on bar_product_prices; sql/procurement.sql'),
  ('bar_prices_bar', 'policy', 'procurement', 'on bar_product_prices; sql/procurement.sql'),
  ('replenishment_hq', 'policy', 'procurement', 'on replenishment_rules; sql/procurement.sql'),
  ('proc_settings_hq', 'policy', 'procurement', 'on procurement_settings; sql/procurement.sql'),
  ('closures_hq', 'policy', 'procurement', 'on ops_closures; sql/procurement.sql'),
  ('counters_none', 'policy', 'procurement', 'on ops_counters; sql/procurement.sql'),
  ('stock_moves_hq', 'policy', 'procurement', 'on procurement_stock_moves; sql/procurement.sql'),
  ('idem_owner', 'policy', 'procurement', 'on order_idempotency_keys; sql/procurement.sql'),
  ('alerts_read', 'policy', 'procurement', 'on fulfillment_alerts; sql/procurement.sql'),
  ('alerts_read_update', 'policy', 'procurement', 'on fulfillment_alerts; sql/procurement.sql'),
  ('bar_product_prices_audit', 'trigger', 'procurement', 'CREATE TRIGGER in sql/procurement.sql'),
  ('locations_one_bar_idx', 'index', 'procurement', 'CREATE INDEX in sql/procurement.sql'),
  ('procurement_tasks_order_idx', 'index', 'procurement', 'CREATE INDEX in sql/procurement.sql'),
  ('procurement_tasks_assignee_idx', 'index', 'procurement', 'CREATE INDEX in sql/procurement.sql'),
  ('procurement_tasks_source_idx', 'index', 'procurement', 'CREATE INDEX in sql/procurement.sql'),
  ('procurement_stock_moves_loc_idx', 'index', 'procurement', 'CREATE INDEX in sql/procurement.sql'),
  ('procurement_stock_moves_task_idx', 'index', 'procurement', 'CREATE INDEX in sql/procurement.sql'),
  ('bar_product_prices_uidx', 'index', 'procurement', 'CREATE INDEX in sql/procurement.sql'),
  ('pedidos_public_code_uidx', 'index', 'procurement', 'CREATE INDEX in sql/procurement.sql'),
  ('pos_tickets', 'table', 'pos-floor', 'CREATE TABLE in sql/pos_floor.sql'),
  ('pos_ticket_items', 'table', 'pos-floor', 'CREATE TABLE in sql/pos_floor.sql'),
  ('pos_bottles', 'table', 'pos-floor', 'CREATE TABLE in sql/pos_floor.sql'),
  ('pos_bottle_moves', 'table', 'pos-floor', 'CREATE TABLE in sql/pos_floor.sql'),
  ('pos_recipes', 'table', 'pos-floor', 'CREATE TABLE in sql/pos_floor.sql'),
  ('pos_recipe_lines', 'table', 'pos-floor', 'CREATE TABLE in sql/pos_floor.sql'),
  ('pos_idempotency', 'table', 'pos-floor', 'CREATE TABLE in sql/pos_floor.sql'),
  ('pos_sale_events', 'table', 'pos-floor', 'CREATE TABLE in sql/pos_floor.sql'),
  ('pos_tokyo_night', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_require_bar', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_log', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_lock_stock', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_sealed_units', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_load_ticket', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_ticket_item', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_save_ticket', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_open_bottle', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_bottle_move', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_preview_ticket', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_close_ticket', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_void_sale', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_bottle_board', 'function', 'pos-floor', 'CREATE FUNCTION in sql/pos_floor.sql'),
  ('pos_tickets_read', 'policy', 'pos-floor', 'on pos_tickets; sql/pos_floor.sql'),
  ('pos_ticket_items_read', 'policy', 'pos-floor', 'on pos_ticket_items; sql/pos_floor.sql'),
  ('pos_bottles_read', 'policy', 'pos-floor', 'on pos_bottles; sql/pos_floor.sql'),
  ('pos_bottle_moves_read', 'policy', 'pos-floor', 'on pos_bottle_moves; sql/pos_floor.sql'),
  ('pos_recipes_read', 'policy', 'pos-floor', 'on pos_recipes; sql/pos_floor.sql'),
  ('pos_recipe_lines_read', 'policy', 'pos-floor', 'on pos_recipe_lines; sql/pos_floor.sql'),
  ('pos_idem_read', 'policy', 'pos-floor', 'on pos_idempotency; sql/pos_floor.sql'),
  ('pos_events_read', 'policy', 'pos-floor', 'on pos_sale_events; sql/pos_floor.sql'),
  ('pos_tickets_one_open_space', 'index', 'pos-floor', 'CREATE INDEX in sql/pos_floor.sql'),
  ('payroll_rules', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_periods', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_lines', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_audit', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_shift_plans', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_occurrences', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_points', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_goal_notes', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_rewards', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_advances', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('payroll_deductions', 'table', 'payroll', 'CREATE TABLE in sql/payroll.sql'),
  ('is_payroll_hq', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_require_hq', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_audit', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_open_period', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_post_lines', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_adjust', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_transition', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_my_pack', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_hq_board', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_hq_write', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_approve_deduction', 'function', 'payroll', 'CREATE FUNCTION in sql/payroll.sql'),
  ('payroll_rules_read', 'policy', 'payroll', 'on payroll_rules; sql/payroll.sql'),
  ('payroll_periods_read', 'policy', 'payroll', 'on payroll_periods; sql/payroll.sql'),
  ('payroll_lines_read', 'policy', 'payroll', 'on payroll_lines; sql/payroll.sql'),
  ('payroll_audit_read', 'policy', 'payroll', 'on payroll_audit; sql/payroll.sql'),
  ('payroll_plans_read', 'policy', 'payroll', 'on payroll_shift_plans; sql/payroll.sql'),
  ('payroll_occurrences_read', 'policy', 'payroll', 'on payroll_occurrences; sql/payroll.sql'),
  ('payroll_points_read', 'policy', 'payroll', 'on payroll_points; sql/payroll.sql'),
  ('payroll_goals_read', 'policy', 'payroll', 'on payroll_goal_notes; sql/payroll.sql'),
  ('payroll_rewards_read', 'policy', 'payroll', 'on payroll_rewards; sql/payroll.sql'),
  ('payroll_advances_read', 'policy', 'payroll', 'on payroll_advances; sql/payroll.sql'),
  ('payroll_deductions_read', 'policy', 'payroll', 'on payroll_deductions; sql/payroll.sql'),
  ('payroll_lines_source_uidx', 'index', 'payroll', 'CREATE INDEX in sql/payroll.sql'),
  ('vendas.mesa', 'column', 'legacy', 'added by migration.sql'),
  ('vendas.cast_id', 'column', 'legacy', 'added by migration.sql'),
  ('vendas.comissao_total', 'column', 'legacy', 'added by migration.sql'),
  ('vendas.status', 'column', 'legacy', 'added by migration.sql'),
  ('caixa_movimentos.referencia_tipo', 'column', 'legacy', 'added by migration.sql'),
  ('caixa_movimentos.referencia_id', 'column', 'legacy', 'added by migration.sql'),
  ('caixa_movimentos.operational_day', 'column', 'pos-floor', 'added by sql/pos_floor.sql'),
  ('produtos.estoque_minimo', 'column', 'legacy', 'added by migration.sql'),
  ('produtos.estoque_maximo', 'column', 'legacy', 'added by migration.sql'),
  ('produtos.volume_ml', 'column', 'pos-floor', 'added by sql/pos_floor.sql'),
  ('fornecedores.ativo', 'column', 'fulfillment', 'added by sql/supplier_fulfillment.sql'),
  ('fornecedores.default_lead_time_hours', 'column', 'fulfillment', 'added by sql/supplier_fulfillment.sql'),
  ('pedidos.public_code', 'column', 'procurement', 'added by sql/procurement.sql'),
  ('fulfillment_alerts.assignee_user_id', 'column', 'procurement', 'added by sql/procurement.sql'),
  ('pos_vendas.drink_back_agent_id', 'column', 'pos-floor', 'added by sql/pos_floor.sql'),
  ('pos_vendas.card_fee', 'column', 'pos-floor', 'added by sql/pos_floor.sql'),
  ('pos_vendas.void_status', 'column', 'pos-floor', 'added by sql/pos_floor.sql'),
  ('pos_vendas_itens.stock_mode', 'column', 'pos-floor', 'added by sql/pos_floor.sql'),
  ('bars', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('perfis', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('produtos', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('pedidos', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('pedidos_itens', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('vendas', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('vendas_itens', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('pos_vendas', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('pos_vendas_itens', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('caixa_movimentos', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('fornecedores', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('fornecedor_precos', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('compras', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('compras_itens', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('faturas', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('fatura_pagamentos', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('ryoshusho', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('notificacoes', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('estoque_movimentos', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('estoque_regras', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('drink_menu', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('bar_pricing', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('discount_codes', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('vip_members', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('vip_usages', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('drink_back_agents', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('bar_spaces', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('bar_guests', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('bar_visits', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('bar_bottle_keeps', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('pos_settings', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('pos_shifts', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('time_clock', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('bar_hq_meta', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('bar_overhead', 'legacy-table', 'legacy', 'used by the app; no CREATE TABLE in this repository'),
  ('produtos_public', 'legacy-view', 'products', 'used by the till and portal; no CREATE VIEW in this repository'),
  ('cast_members', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('cast_comissoes', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('supplier_users', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('supplier_products', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('supplier_routing_rules', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('pedido_fulfillment', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('order_supplier_assignments', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('order_supplier_items', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('fulfillment_events', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('delivery_confirmations', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('supplier_purchase_requests', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('fulfillment_alerts', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('audit_logs', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('procurement_sources', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('procurement_source_products', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('procurement_routing_rules', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('procurement_tasks', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('purchase_transactions', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('purchase_lines', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('shipments', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('shipment_items', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('locations', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('bar_product_prices', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('replenishment_rules', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('procurement_settings', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('ops_closures', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('ops_counters', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('procurement_stock_moves', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('order_idempotency_keys', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('pos_tickets', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('pos_ticket_items', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('pos_bottles', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('pos_bottle_moves', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('pos_recipes', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('pos_recipe_lines', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('pos_idempotency', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('pos_sale_events', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_rules', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_periods', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_lines', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_audit', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_shift_plans', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_occurrences', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_points', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_goal_notes', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_rewards', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_advances', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('payroll_deductions', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in an install script'),
  ('deduct_stock(uuid, integer)', 'absent-function', 'pos-security', '2-argument overload must stay dropped'),
  ('pos_void_sale(uuid, text, integer, text, uuid)', 'absent-function', 'pos-floor', '5-argument overload must stay dropped'),
  ('bar_catalog', 'table', 'foundation', 'CREATE TABLE in sql/foundation/003_operational_catalog.sql'),
  ('pos_sale_payments', 'table', 'foundation', 'CREATE TABLE in sql/foundation/003_operational_catalog.sql'),
  ('cash_closings', 'table', 'foundation', 'CREATE TABLE in sql/foundation/003_operational_catalog.sql'),
  ('pos_settings', 'table', 'foundation', 'CREATE TABLE in sql/foundation/003_operational_catalog.sql'),
  ('schema_install', 'table', 'foundation', 'CREATE TABLE in sql/foundation/003_operational_catalog.sql'),
  ('bar_memberships', 'table', 'foundation', 'explicit bar grant; role jbm is not enough'),
  ('platform_access', 'table', 'foundation', 'explicit HQ grant'),
  ('pos_apply_discount', 'function', 'foundation', 'sql/foundation/080_operations.sql'),
  ('pos_take_payment', 'function', 'foundation', 'sql/foundation/080_operations.sql'),
  ('stock_post', 'function', 'foundation', 'sql/foundation/080_operations.sql'),
  ('staff_clock', 'function', 'foundation', 'sql/foundation/080_operations.sql'),
  ('cash_close_night', 'function', 'foundation', 'sql/foundation/080_operations.sql'),
  ('foundation-1', 'version', 'foundation', 'schema_install.version'),
  ('vendas', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in sql/foundation/090_security.sql'),
  ('produtos', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in sql/foundation/090_security.sql'),
  ('pedidos', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in sql/foundation/090_security.sql'),
  ('time_clock', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in sql/foundation/090_security.sql'),
  ('pos_void_audit', 'table', 'foundation', 'CREATE TABLE in sql/pos_floor.sql'),
  ('operation_price', 'function', 'foundation', 'sql/foundation/095_review.sql'),
  ('price_conflict', 'function', 'foundation', 'sql/foundation/095_review.sql'),
  ('sales_indicator', 'function', 'foundation', 'sql/foundation/095_review.sql'),
  ('pos_void_audit', 'rls', 'security', 'ENABLE ROW LEVEL SECURITY in sql/foundation/095_review.sql')
),
checked AS (
  SELECT
    e.object_name,
    e.module,
    e.detail,
    CASE
      WHEN e.object_kind = 'table' AND EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = e.object_name AND t.table_type = 'BASE TABLE'
      ) THEN 'PASS'
      WHEN e.object_kind = 'legacy-table' AND EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = e.object_name AND t.table_type = 'BASE TABLE'
      ) THEN 'PASS'
      WHEN e.object_kind = 'legacy-view' AND EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = e.object_name AND t.table_type = 'VIEW'
      ) THEN 'PASS'
      WHEN e.object_kind = 'function' AND EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = e.object_name
      ) THEN 'PASS'
      WHEN e.object_kind = 'policy' AND EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.policyname = e.object_name
      ) THEN 'PASS'
      WHEN e.object_kind = 'trigger' AND EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND t.tgname = e.object_name AND NOT t.tgisinternal
      ) THEN 'PASS'
      WHEN e.object_kind = 'index' AND EXISTS (
        SELECT 1 FROM pg_indexes i
        WHERE i.schemaname = 'public' AND i.indexname = e.object_name
      ) THEN 'PASS'
      WHEN e.object_kind = 'column' AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = split_part(e.object_name, '.', 1)
          AND c.column_name = split_part(e.object_name, '.', 2)
      ) THEN 'PASS'
      WHEN e.object_kind = 'rls' AND EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = e.object_name AND c.relrowsecurity
      ) THEN 'PASS'
      WHEN e.object_kind = 'absent-function' AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = split_part(e.object_name, '(', 1)
          AND pg_get_function_identity_arguments(p.oid) = substring(e.object_name from '\((.*)\)')
      ) THEN 'PASS'
      WHEN e.object_kind = 'version' AND EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = 'schema_install'
      ) AND EXISTS (
        SELECT 1 FROM public.schema_install s WHERE s.version = e.object_name
      ) THEN 'PASS'
      WHEN e.object_kind = 'absent-function' THEN 'FAIL'
      ELSE 'FAIL'
    END AS status
  FROM expected e
)
SELECT object, status, module, detail
FROM (
  SELECT object_name AS object, status, module, detail, 0 AS sort_summary
  FROM checked
  UNION ALL
  SELECT
    'SUMMARY',
    CASE WHEN count(*) FILTER (WHERE status <> 'PASS') = 0 THEN 'OK' ELSE 'FAIL' END,
    'audit',
    count(*) FILTER (WHERE status <> 'PASS')::text || ' object(s) are not PASS',
    1
  FROM checked
) report
ORDER BY sort_summary, status, module, object;
