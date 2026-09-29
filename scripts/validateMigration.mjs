/**
 * Static checks for sql/migration_final.sql.
 * Does not connect to a database and does not apply the file.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../sql/migration_final.sql', import.meta.url), 'utf8')
const code = sql.replace(/--.*$/gm, '')

assert.match(sql, /Migration designed but not executed/)

const tables = [
  'pos_vendas',
  'pos_vendas_itens',
  'drink_menu',
  'bar_pricing',
  'bar_spaces',
  'bar_guests',
  'bar_visits',
  'time_clock',
  'pos_tickets',
  'pos_ticket_items',
  'pos_idempotency',
  'pos_sale_events',
  'pos_bar_config',
  'bar_employees',
  'payroll_lines',
  'payroll_rules',
  'payroll_periods',
  'bar_product_prices',
  'replenishment_rules',
  'procurement_tasks',
  'purchase_transactions',
  'purchase_lines',
  'shipments',
]
for (const table of tables) {
  assert.match(code, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`), table)
}

for (const column of ['bar_id', 'referencia_tipo', 'referencia_id', 'operational_day']) {
  assert.match(
    code,
    new RegExp(`ALTER TABLE public\\.caixa_movimentos ADD COLUMN IF NOT EXISTS ${column}\\b`),
    `caixa_movimentos.${column}`,
  )
}
assert.match(code, /ALTER TABLE public\.estoque_movimentos ADD COLUMN IF NOT EXISTS bar_id\b/)
assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS bar_pricing_bar_produto_uidx/)
assert.match(code, /FUNCTION public\.time_clock_guard\(/)
assert.match(code, /already clocked in/)
assert.match(code, /not clocked in/)
assert.match(code, /overlaps an open shift/)

const functions = [
  'pos_close_ticket',
  'pos_close_with_charges',
  'pos_quote_charges',
  'pos_load_ticket',
  'pos_ticket_item',
  'user_can_access_bar',
  'is_procurement_hq',
]
for (const name of functions) {
  assert.match(code, new RegExp(`FUNCTION public\\.${name}\\b`), name)
}

const tenantTables = [
  'pos_vendas',
  'pos_vendas_itens',
  'drink_menu',
  'bar_pricing',
  'bar_spaces',
  'bar_guests',
  'bar_visits',
  'time_clock',
  'caixa_movimentos',
  'pos_tickets',
  'pos_ticket_items',
  'pos_bar_config',
  'bar_employees',
  'payroll_lines',
]
for (const table of tenantTables) {
  assert.match(code, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `RLS ${table}`)
}

for (const table of ['vendas', 'pedidos', 'perfis', 'produtos']) {
  assert.doesNotMatch(
    code,
    new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
    `RLS must stay off ${table}`,
  )
}

assert.doesNotMatch(code, /USING\s*\(\s*true\s*\)/i)
assert.doesNotMatch(code, /UPDATE public\.caixa_movimentos\s+SET operational_day/i)
assert.doesNotMatch(code, /CREATE (?:OR REPLACE )?FUNCTION public\.(deduct_stock|create_order)\b/)
assert.doesNotMatch(code, /ALTER TABLE public\.produtos[^;]*\bbar_id\b/)
assert.doesNotMatch(code, /ALTER TABLE public\.vendas[^;]*\b(forma_pagamento|mesa|status|origem)\b/)
assert.doesNotMatch(code, /DROP TABLE/i)
assert.doesNotMatch(code, /DELETE FROM public\.\w+\s*;/i)

const chunks = code.split(/CREATE (?:OR REPLACE )?FUNCTION/i).slice(1)
for (const chunk of chunks) {
  const head = chunk.slice(0, 1800)
  if (!/SECURITY DEFINER/i.test(head)) continue
  const name = head.slice(0, 80).replace(/\s+/g, ' ')
  assert.match(head, /search_path/i, `DEFINER missing search_path: ${name}`)
}

const fulfillment = code.indexOf('CREATE TABLE IF NOT EXISTS public.pedido_fulfillment')
const procurement = code.indexOf('CREATE TABLE IF NOT EXISTS public.procurement_tasks')
const till = code.indexOf('CREATE TABLE IF NOT EXISTS public.pos_vendas')
const floor = code.indexOf('CREATE TABLE IF NOT EXISTS public.pos_tickets')
const charges = code.indexOf('FUNCTION public.pos_close_with_charges')
assert.ok(till > 0 && till < floor, 'pos_vendas must exist before the floor script')
assert.ok(fulfillment > 0 && fulfillment < procurement, 'procurement must follow fulfillment')
assert.ok(floor < charges, 'charge close must follow the floor close')

const access = code.lastIndexOf('FUNCTION public.user_can_access_bar')
const employees = code.indexOf('CREATE TABLE IF NOT EXISTS public.bar_employees')
assert.ok(employees > 0 && access > employees, 'final user_can_access_bar must follow bar_employees')

console.log('migration static checks passed')
