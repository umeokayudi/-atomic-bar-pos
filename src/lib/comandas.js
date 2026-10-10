/**
 * Tabs (comandas) and floor tables on the server (sql/floor_comandas.sql).
 * Pure helpers first (unit tested in scripts/redesign.test.mjs), then thin RPC wrappers.
 * Every write goes through a SECURITY INVOKER function, so RLS still decides who can do what.
 */

import { cartTotal, lineUnitPrice } from './atomicPos.js'
import { ticketChargeLines } from './nightTicket.js'

export const OPEN_STATUSES = ['open', 'awaiting_payment']

/** Minutes without a new round after which a table reads as "occupied" (seated, not ordering) instead of "consuming". */
export const IDLE_MINUTES = 45

/**
 * Table state shown on the floor (colour + text + icon in the UI).
 * - reserved / cleaning: set by hand on the table (estado_manual), only when no tab is open.
 * - free: no open tab.
 * - awaiting_order: a tab is open but nothing was ordered yet.
 * - consuming: a tab with lines, last line added less than IDLE_MINUTES ago.
 * - occupied: a tab with lines, nothing new for IDLE_MINUTES or more.
 * - awaiting_payment: the bill was asked for / a partial payment was taken.
 */
export const TABLE_STATES = ['free', 'awaiting_order', 'consuming', 'occupied', 'awaiting_payment', 'reserved', 'cleaning']

export function tableState(table, tabs = [], now = Date.now()) {
  const open = tabs.filter(c => c.table_id === table.id && OPEN_STATUSES.includes(c.status))
  if (!open.length) return table.estado_manual || 'free'
  if (open.some(c => c.status === 'awaiting_payment')) return 'awaiting_payment'
  const withLines = open.filter(c => (c.itens_qtd ?? c.items?.length ?? 0) > 0)
  if (!withLines.length) return 'awaiting_order'
  const last = Math.max(...withLines.map(c => Date.parse(c.ultimo_item_em || c.aberta_em) || 0))
  return now - last >= IDLE_MINUTES * 60000 ? 'occupied' : 'consuming'
}

/** Live lines of a tab as cart lines (same shape the till uses). */
export function tabLines(items = []) {
  return items.filter(i => !i.removido_em).map(i => ({
    key: i.id,
    item_id: i.id,
    drink_menu_id: i.drink_menu_id || null,
    produto_id: i.produto_id || null,
    nome: i.nome,
    categoria: i.categoria || null,
    qtd: +i.qtd,
    preco_unitario: +i.preco_unitario,
    preco_lista: i.preco_lista == null ? null : +i.preco_lista,
    tipo_preco: i.tipo_preco || 'regular',
    desconto_valor: +i.desconto_valor || 0,
    obs: i.obs || null,
  }))
}

/**
 * Money of a tab. Drinks = Σ qtd × preco_unitario; service and VIP room minimum come from the
 * same rule as the counter (nightTicket.ticketChargeLines). Paid = live payments. Due = total − paid.
 */
export function tabMoney(tab, items = [], payments = [], settings = {}, spaceType = '') {
  const lines = tabLines(items)
  const drinksTotal = cartTotal(lines)
  const charges = ticketChargeLines({
    drinksTotal,
    servicePct: +tab?.service_pct || 0,
    roomMin: settings.room_min || 0,
    spaceType,
  })
  const paid = payments.filter(p => !p.estornado_em).reduce((a, p) => a + (+p.valor || 0), 0)
  return { lines, drinksTotal, charges: charges.lines, total: charges.total, paid, due: Math.max(0, charges.total - paid) }
}

/** Split a total in n parts that add up exactly (the first parts take the leftover yen). */
export function splitEvenly(total, n) {
  const parts = Math.max(1, Math.floor(+n || 1))
  const whole = Math.round(+total || 0)
  const base = Math.floor(whole / parts)
  const rest = whole - base * parts
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0))
}

/** Check a list of moves [{item, qtd}] against the live lines before calling the server. Returns an error key or ''. */
export function validateMoves(moves = [], lines = []) {
  if (!moves.length) return 'tabs.errNothingSelected'
  const byId = new Map(lines.map(l => [l.item_id || l.key, l]))
  for (const m of moves) {
    const line = byId.get(m.item)
    if (!line) return 'tabs.errLineGone'
    if (!(+m.qtd > 0) || +m.qtd > line.qtd) return 'tabs.errQty'
  }
  return ''
}

/** New lines to send: what is in the local cart and not yet on the server tab. */
export function pendingToLines(pending = []) {
  return pending.filter(l => l.qtd > 0).map(l => ({
    drink_menu_id: l.drink_menu_id || null,
    produto_id: l.produto_id || null,
    nome: l.nome,
    categoria: l.categoria || null,
    qtd: l.qtd,
    preco_unitario: lineUnitPrice(l),
    preco_lista: l.preco_lista ?? null,
    tipo_preco: l.tipo_preco || 'regular',
    desconto_valor: l.desconto_valor || 0,
    obs: l.obs || null,
  }))
}

export function newKey(prefix = 'k') {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `${prefix}-${id}`
}

export function isMissingRpc(error) {
  return !!error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message || ''))
}
export function isMissingRelation(error) {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message || ''))
}
/** Errors the server raises when someone else changed the same tab/layout: reload and retry. */
export function isConflict(error) {
  return !!error && (error.code === '40001' || /changed on another device|price changed|does not match/i.test(error.message || ''))
}

// ─── server access ─────────────────────────────────────────────────────────────────────────

async function rpc(supabase, fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw Object.assign(new Error(error.message), { code: error.code, details: error.details })
  return data
}

/** Is the server floor/tabs model installed? (sql/floor_comandas.sql applied) */
export async function floorAvailable(supabase, barId) {
  const { error } = await supabase.from('pos_comandas').select('id').eq('bar_id', barId).limit(1)
  if (!error) return true
  if (isMissingRelation(error)) return false
  throw error
}

/** Open tabs of a bar with their live lines and payments, in two round trips. */
export async function loadOpenTabs(supabase, barId) {
  const { data: tabs, error } = await supabase.from('pos_comandas')
    .select('*').eq('bar_id', barId).in('status', OPEN_STATUSES).order('aberta_em')
  if (error) throw error
  const ids = (tabs || []).map(t => t.id)
  if (!ids.length) return []
  const [it, pg] = await Promise.all([
    supabase.from('pos_comanda_itens').select('*').in('comanda_id', ids).is('removido_em', null).order('criado_em'),
    supabase.from('pos_comanda_pagamentos').select('*').in('comanda_id', ids).is('estornado_em', null).order('criado_em'),
  ])
  if (it.error) throw it.error
  if (pg.error) throw pg.error
  return tabs.map(t => {
    const items = (it.data || []).filter(i => i.comanda_id === t.id)
    return {
      ...t,
      items,
      payments: (pg.data || []).filter(p => p.comanda_id === t.id),
      itens_qtd: items.reduce((a, i) => a + (+i.qtd || 0), 0),
      ultimo_item_em: items.length ? items[items.length - 1].criado_em : null,
    }
  })
}

export async function loadTabHistory(supabase, barId, { limit = 50 } = {}) {
  const { data, error } = await supabase.from('pos_comandas')
    .select('id,nome,mesa_nome,status,aberta_em,fechada_em,venda_id,pessoas,responsavel_nome')
    .eq('bar_id', barId).not('status', 'in', '(open,awaiting_payment)')
    .order('aberta_em', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

export async function loadTabEvents(supabase, comandaId) {
  const { data, error } = await supabase.from('pos_comanda_eventos').select('*').eq('comanda_id', comandaId).order('criado_em')
  if (error) throw error
  return data || []
}

export const tabsApi = {
  open: (sb, { barId, nome, tableId = null, pessoas = 1, responsavel = null, servicePct = 0, key = newKey('open') }) =>
    rpc(sb, 'comanda_open', { p_bar: barId, p_nome: nome, p_table: tableId, p_pessoas: pessoas, p_responsavel: responsavel, p_service_pct: servicePct, p_key: key }),
  addItems: (sb, comandaId, lines, key = newKey('add')) => rpc(sb, 'comanda_add_items', { p_comanda: comandaId, p_lines: lines, p_key: key }),
  setQty: (sb, itemId, qtd) => rpc(sb, 'comanda_set_qty', { p_item: itemId, p_qtd: qtd }),
  update: (sb, comandaId, { nome = null, pessoas = null, responsavel = null, obs = null, servicePct = null }) =>
    rpc(sb, 'comanda_update', { p_comanda: comandaId, p_nome: nome, p_pessoas: pessoas, p_responsavel: responsavel, p_obs: obs, p_service_pct: servicePct }),
  moveTable: (sb, comandaId, tableId) => rpc(sb, 'comanda_move_table', { p_comanda: comandaId, p_table: tableId }),
  transfer: (sb, fromId, toId, moves) => rpc(sb, 'comanda_transfer_items', { p_from: fromId, p_to: toId, p_moves: moves }),
  merge: (sb, fromId, intoId) => rpc(sb, 'comanda_merge', { p_from: fromId, p_into: intoId }),
  split: (sb, comandaId, groups) => rpc(sb, 'comanda_split', { p_comanda: comandaId, p_groups: groups }),
  pay: (sb, comandaId, { valor, metodo, pagador = null, key = newKey('pay') }) =>
    rpc(sb, 'comanda_pay', { p_comanda: comandaId, p_valor: valor, p_metodo: metodo, p_key: key, p_pagador: pagador }),
  voidPayment: (sb, paymentId, reason) => rpc(sb, 'comanda_void_payment', { p_payment: paymentId, p_reason: reason }),
  reopen: (sb, comandaId) => rpc(sb, 'comanda_reopen', { p_comanda: comandaId }),
  cancel: (sb, comandaId, reason) => rpc(sb, 'comanda_cancel', { p_comanda: comandaId, p_reason: reason }),
}

// ─── floor plan without sql/floor_comandas.sql ─────────────────────────────────────────────
// The plan tables also live in the bar live-store (api/_barLiveStore.js): Postgres when the migration
// is applied, the bar's private JSON store until then. The RPCs only exist with the migration, so each
// layout write falls back to plain writes with the same rules (version check, keep ids, drop removed rows).

export const LAYOUT_DEFAULTS = { largura: 1200, altura: 800, versao: 1 }

function staleError(a, b) {
  return Object.assign(new Error(`layout changed on another device (version ${a} vs ${b})`), { code: '40001' })
}

async function must(q) {
  const r = await q
  if (r.error) throw Object.assign(new Error(r.error.message || 'Query failed'), { code: r.error.code })
  return r.data
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

/** Rows to write for one layout save: pure, unit tested. */
export function planSaveRows(payload, { barId, oldSectorIds = [], oldTableIds = [], makeId = uuid } = {}) {
  const keymap = {}
  const sectors = (payload.sectors || []).map(sc => {
    const id = sc.id || makeId()
    if (sc.key) keymap[sc.key] = id
    return { id, bar_id: barId, layout_id: payload.layoutId, nome: sc.nome, cor: sc.cor || null, ordem: sc.ordem || 0 }
  })
  const tables = (payload.tables || []).map(tb => {
    const { sector_key: key, ...row } = tb
    return {
      ...row,
      id: tb.id || makeId(),
      bar_id: barId,
      layout_id: payload.layoutId,
      sector_id: (key && keymap[key]) || tb.sector_id || null,
      capacidade: tb.capacidade ?? 0,
    }
  })
  const keepS = new Set(sectors.map(x => x.id))
  const keepT = new Set(tables.map(x => x.id))
  return {
    sectors,
    tables,
    dropSectors: oldSectorIds.filter(id => !keepS.has(id)),
    dropTables: oldTableIds.filter(id => !keepT.has(id)),
  }
}

async function directSave(sb, p) {
  const cur = await must(sb.from('floor_layouts').select('*').eq('id', p.layoutId).maybeSingle())
  if (!cur) throw new Error('layout not found')
  const now = cur.versao ?? 1
  if ((p.versao ?? 1) !== now) throw staleError(p.versao, now)
  const [oldS, oldT] = await Promise.all([
    must(sb.from('floor_sectors').select('id').eq('layout_id', p.layoutId)),
    must(sb.from('floor_tables').select('id').eq('layout_id', p.layoutId)),
  ])
  const rows = planSaveRows(p, { barId: cur.bar_id, oldSectorIds: (oldS || []).map(r => r.id), oldTableIds: (oldT || []).map(r => r.id) })
  if (rows.sectors.length) await must(sb.from('floor_sectors').upsert(rows.sectors))
  if (rows.tables.length) await must(sb.from('floor_tables').upsert(rows.tables))
  if (rows.dropTables.length) await must(sb.from('floor_tables').delete().in('id', rows.dropTables))
  if (rows.dropSectors.length) await must(sb.from('floor_sectors').delete().in('id', rows.dropSectors))
  await must(sb.from('floor_layouts').update({
    nome: String(p.nome || '').trim() || cur.nome, largura: p.largura, altura: p.altura, versao: now + 1, atualizado_em: new Date().toISOString(),
  }).eq('id', p.layoutId))
  return { versao: now + 1 }
}

async function directDuplicate(sb, layoutId, nome) {
  const src = await must(sb.from('floor_layouts').select('*').eq('id', layoutId).maybeSingle())
  if (!src) throw new Error('layout not found')
  const id = uuid()
  await must(sb.from('floor_layouts').insert({ ...LAYOUT_DEFAULTS, id, bar_id: src.bar_id, nome, largura: src.largura, altura: src.altura, ativo: false }))
  const [sectors, tables] = await Promise.all([
    must(sb.from('floor_sectors').select('*').eq('layout_id', layoutId)),
    must(sb.from('floor_tables').select('*').eq('layout_id', layoutId)),
  ])
  const map = {}
  const newSectors = (sectors || []).map(x => { map[x.id] = uuid(); return { ...x, id: map[x.id], layout_id: id } })
  const newTables = (tables || []).map(x => ({ ...x, id: uuid(), layout_id: id, sector_id: x.sector_id ? map[x.sector_id] || null : null, estado_manual: null }))
  if (newSectors.length) await must(sb.from('floor_sectors').insert(newSectors))
  if (newTables.length) await must(sb.from('floor_tables').insert(newTables))
  return id
}

async function directActivate(sb, layoutId) {
  const row = await must(sb.from('floor_layouts').select('id,bar_id').eq('id', layoutId).maybeSingle())
  if (!row) throw new Error('layout not found')
  await must(sb.from('floor_layouts').update({ ativo: false }).eq('bar_id', row.bar_id))
  await must(sb.from('floor_layouts').update({ ativo: true }).eq('id', layoutId))
}

async function rpcOr(sb, fn, args, fallback) {
  const { data, error } = await sb.rpc(fn, args)
  if (!error) return data
  if (isMissingRpc(error)) return fallback()
  throw Object.assign(new Error(error.message), { code: error.code, details: error.details })
}

export const floorApi = {
  async layouts(sb, barId) {
    const { data, error } = await sb.from('floor_layouts').select('*').eq('bar_id', barId).order('criado_em')
    if (error) throw error
    return (data || []).map(l => ({ ...LAYOUT_DEFAULTS, ...l }))
  },
  async layout(sb, layoutId) {
    const [s, t] = await Promise.all([
      sb.from('floor_sectors').select('*').eq('layout_id', layoutId).order('ordem'),
      sb.from('floor_tables').select('*').eq('layout_id', layoutId).order('nome'),
    ])
    if (s.error) throw s.error
    if (t.error) throw t.error
    return { sectors: s.data || [], tables: t.data || [] }
  },
  /** New empty layout (works with or without the migration). */
  async create(sb, { barId, nome, ativo = false }) {
    const row = await must(sb.from('floor_layouts').insert({ ...LAYOUT_DEFAULTS, id: uuid(), bar_id: barId, nome, ativo }).select('id').single())
    return row.id
  },
  save: (sb, { layoutId, versao, nome, largura, altura, sectors, tables }) =>
    rpcOr(sb, 'floor_save_layout', { p_layout: layoutId, p_versao: versao, p_nome: nome, p_largura: largura, p_altura: altura, p_sectors: sectors, p_tables: tables },
      () => directSave(sb, { layoutId, versao, nome, largura, altura, sectors, tables })),
  duplicate: (sb, layoutId, nome) => rpcOr(sb, 'floor_duplicate_layout', { p_layout: layoutId, p_nome: nome }, () => directDuplicate(sb, layoutId, nome)),
  activate: (sb, layoutId) => rpcOr(sb, 'floor_activate_layout', { p_layout: layoutId }, () => directActivate(sb, layoutId)),
  setState: (sb, tableId, state, note = null) => rpcOr(sb, 'floor_set_table_state', { p_table: tableId, p_state: state, p_note: note },
    () => must(sb.from('floor_tables').update({ estado_manual: state }).eq('id', tableId))),
}

/** Is the floor plan readable (server tables, or the live-store copy without the migration)? */
export async function floorPlanAvailable(supabase, barId) {
  const { error } = await supabase.from('floor_layouts').select('id').eq('bar_id', barId).limit(1)
  return !error
}
