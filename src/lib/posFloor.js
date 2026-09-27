/**
 * Till floor rules. Prices, stock and commission are decided with the same
 * numbers the SQL function enforces. The client may display them, not invent them.
 * Till money stays on pos_vendas. JBM bills stay on vendas.
 */

import { drinkBackCommission } from './drinkBackPay.js'
import { tokyoNightKey } from './tokyo.js'

/** Same processor rate already used by create_order. One caixa line, never twice. */
export const CARD_FEE_RATE = 0.0378

export const SPACE_GROUPS = [
  { id: 'table', label: 'tables' },
  { id: 'vip', label: 'vip' },
  { id: 'floor', label: 'floor' },
  { id: 'counter', label: 'counter' },
]

export function spaceGroup(space) {
  if (!space) return 'floor'
  if (space.tipo === 'vip_room' || space.zona === 'vip') return 'vip'
  if (space.tipo === 'counter') return 'counter'
  if (space.tipo === 'table') return 'table'
  return 'floor'
}

export function groupSpaces(spaces = []) {
  const groups = { table: [], vip: [], floor: [], counter: [] }
  for (const space of spaces) {
    if (space.ativo === false) continue
    groups[spaceGroup(space)].push(space)
  }
  return groups
}

export function catalogPrice(product) {
  const price = product?.preco_venda ?? product?.preco_drink
  if (price == null || Number.isNaN(+price)) throw new Error('price unavailable')
  return Math.round(+price)
}

export function lineFromCatalog(item, catalog) {
  const product = (catalog || []).find(row => row.id === (item.drink_menu_id || item.produto_id))
  if (!product) throw new Error('product not in this bar')
  if (product.bar_id && item.bar_id && product.bar_id !== item.bar_id) throw new Error('cross bar')
  const unit = catalogPrice(product)
  const qty = Math.round(+item.qtd || 0)
  if (qty <= 0) throw new Error('invalid quantity')
  return {
    drink_menu_id: item.drink_menu_id || null,
    produto_id: item.produto_id || product.produto_id || null,
    nome: product.nome,
    qtd: qty,
    unit_price: unit,
    total: unit * qty,
    forCast: !!item.forCast && !item.produto_id,
    kind: item.produto_id && !item.drink_menu_id ? 'shot' : 'drink',
  }
}

export function expandRecipe(lines = [], qty = 1) {
  const count = Math.round(+qty || 0)
  if (count <= 0) throw new Error('invalid quantity')
  return (lines || []).map(line => ({
    produto_id: line.produto_id,
    volume_ml: line.volume_ml == null ? null : Math.round(+line.volume_ml * count),
    quantity: line.quantity == null ? null : Math.round(+line.quantity * count),
    unit: line.unit || (line.volume_ml != null ? 'ml' : 'unit'),
  }))
}

export function fifoTakes(bottles = [], needMl, { barId, produtoId } = {}) {
  const need = Math.round(+needMl || 0)
  if (need <= 0) return []
  const open = (bottles || [])
    .filter(bottle => bottle.status === 'opened')
    .filter(bottle => bottle.bar_id == null || barId == null || bottle.bar_id === barId)
    .filter(bottle => !produtoId || bottle.produto_id === produtoId)
    .filter(bottle => (+bottle.volume_atual || 0) > 0)
    .sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at)))
  let left = need
  const takes = []
  for (const bottle of open) {
    if (left <= 0) break
    const take = Math.min(Math.round(+bottle.volume_atual), left)
    takes.push({ bottle_id: bottle.id, volume_ml: take, produto_id: bottle.produto_id, bar_id: bottle.bar_id })
    left -= take
  }
  if (left > 0) throw new Error('insufficient bottle volume')
  return takes
}

export function applyBottleTakes(bottles = [], takes = []) {
  const next = bottles.map(bottle => ({ ...bottle }))
  for (const take of takes) {
    const bottle = next.find(row => row.id === take.bottle_id)
    if (!bottle) throw new Error('bottle missing')
    if (take.volume_ml > bottle.volume_atual) throw new Error('insufficient bottle volume')
    bottle.volume_atual = Math.round(bottle.volume_atual - take.volume_ml)
    if (bottle.volume_atual === 0) bottle.status = 'depleted'
  }
  return next
}

const LOSS_KINDS = new Set(['waste', 'breakage', 'spill', 'staff_drink', 'complimentary', 'adjustment'])

export function postBottleMove(bottle, { kind, volumeMl, employeeId, reason }) {
  if (![...LOSS_KINDS, 'consume', 'refund'].includes(kind)) throw new Error('unknown bottle move')
  const volume = Math.round(+volumeMl || 0)
  if (volume <= 0) throw new Error('invalid volume')
  if (!employeeId) throw new Error('employee required')
  if (kind !== 'refund' && volume > (+bottle.volume_atual || 0)) throw new Error('insufficient bottle volume')
  const volumeAtual = kind === 'refund'
    ? Math.round((+bottle.volume_atual || 0) + volume)
    : Math.round(bottle.volume_atual - volume)
  let status = bottle.status
  if (kind === 'refund') status = volumeAtual > 0 ? 'opened' : status
  else if (volumeAtual === 0) status = LOSS_KINDS.has(kind) && kind !== 'complimentary' ? 'wasted' : 'depleted'
  return {
    bottle: { ...bottle, volume_atual: volumeAtual, status },
    move: {
      bottle_id: bottle.id,
      kind,
      volume_ml: volume,
      employee_id: employeeId,
      reason: reason || kind,
    },
  }
}

export function openBottle({ stockUnits = 0, product, code, volumeMl, employeeId, barId, openedAt }) {
  if (!product?.id) throw new Error('product required')
  if (Math.round(+stockUnits || 0) < 1) throw new Error('bottle not in stock')
  const volume = Math.round(+product?.volume_ml || 0)
  if (volume <= 0) throw new Error('product volume missing')
  if (volumeMl != null && volumeMl !== '' && Math.round(+volumeMl) !== volume) {
    throw new Error('volume must match the product')
  }
  if (!employeeId) throw new Error('employee required')
  if (!code) throw new Error('bottle code required')
  return {
    stockUnits: Math.round(stockUnits) - 1,
    stockMove: { produto_id: product.id, bar_id: barId, tipo: 'saida', qtd: 1, motivo: 'bottle_open' },
    bottle: {
      id: code,
      code,
      produto_id: product.id,
      bar_id: barId,
      status: 'opened',
      volume_original: volume,
      volume_atual: volume,
      opened_at: openedAt,
      opened_by: employeeId,
      custo: product.custo == null ? null : Math.round(+product.custo),
    },
  }
}

/** Serialized the way the SQL advisory lock is. Two opens of the last unit: one sale, one error. */
export function openBottlesConcurrent(stockUnits, requests = []) {
  let stock = Math.round(+stockUnits || 0)
  const results = []
  for (const req of requests) {
    try {
      const opened = openBottle({ ...req, stockUnits: stock })
      stock = opened.stockUnits
      results.push({ ok: true, bottle: opened.bottle, stockMove: opened.stockMove })
    } catch (error) {
      results.push({ ok: false, error: error.message })
    }
  }
  return { stock, results }
}

/**
 * One stock path per line.
 * A drink follows the recipe: ml off an open bottle, or sealed units of a mixer.
 * A sealed product follows units only. The same line never does both for the same product.
 */
export function lineDeductions(item, recipeLines) {
  const qty = Math.round(+item?.qtd || 0)
  if (qty <= 0) throw new Error('invalid quantity')
  if (item.drink_menu_id) {
    if (!recipeLines || !recipeLines.length) throw new Error('recipe required')
    return recipeLines.map(line => {
      const ml = line.volume_ml != null && Math.round(+line.volume_ml) > 0
      const units = line.quantity != null && Math.round(+line.quantity) > 0
      if (ml && units) throw new Error('recipe line mixes unit and ml')
      if (!ml && !units) throw new Error('recipe required')
      if (ml) {
        return { mode: 'ml', produto_id: line.produto_id, volume_ml: Math.round(+line.volume_ml * qty) }
      }
      return { mode: 'unit', produto_id: line.produto_id, qtd: Math.round(+line.quantity * qty) }
    })
  }
  if (!item.produto_id) throw new Error('product not in this bar')
  return [{ mode: 'unit', produto_id: item.produto_id, qtd: qty }]
}

export function cardFee(total, method) {
  const due = Math.round(+total || 0)
  if (method !== 'card' && method !== 'credit') return 0
  return Math.round(due * CARD_FEE_RATE)
}

export function cashLines({ total, method, vendaId, barId }) {
  const due = Math.round(+total || 0)
  const fee = cardFee(due, method)
  const lines = [{
    bar_id: barId,
    tipo: 'entrada',
    valor: due,
    referencia_id: vendaId,
    referencia_tipo: 'pos_venda',
  }]
  if (fee > 0) {
    lines.push({
      bar_id: barId,
      tipo: 'saida',
      valor: fee,
      referencia_id: vendaId,
      referencia_tipo: 'taxa_cartao',
    })
  }
  return { lines, fee, net: due - fee }
}

export function previewSale({
  items = [],
  catalog = [],
  recipes = {},
  bottles = [],
  agent = null,
  payment = 'cash',
  barId = null,
  employeeId = null,
}) {
  const lines = items.map(item => lineFromCatalog({ ...item, bar_id: barId }, catalog))
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0)
  const commission = agent ? drinkBackCommission(lines.map(line => ({
    ...line,
    preco_unitario: line.unit_price,
    forCast: line.forCast,
    produto_id: line.kind === 'shot' ? line.produto_id : null,
  })), agent.comissao_pct) : 0
  let nextBottles = bottles.map(bottle => ({ ...bottle }))
  const consumption = []
  const stockMoves = []
  const requirements = []
  for (const line of lines) {
    const parts = line.drink_menu_id
      ? lineDeductions(line, recipes[line.drink_menu_id])
      : lineDeductions(line)
    for (const part of parts) {
      if (part.mode === 'ml') {
        const available = nextBottles
          .filter(bottle => bottle.status === 'opened')
          .filter(bottle => !barId || bottle.bar_id === barId)
          .filter(bottle => bottle.produto_id === part.produto_id)
          .reduce((sum, bottle) => sum + (+bottle.volume_atual || 0), 0)
        requirements.push({ ...part, available, drink_menu_id: line.drink_menu_id })
        const takes = fifoTakes(nextBottles, part.volume_ml, { barId, produtoId: part.produto_id })
        nextBottles = applyBottleTakes(nextBottles, takes)
        for (const take of takes) {
          consumption.push({ ...take, drink_menu_id: line.drink_menu_id, employee_id: employeeId, mode: 'ml' })
        }
      } else {
        stockMoves.push({ ...part, drink_menu_id: line.drink_menu_id || null })
      }
    }
  }
  const money = cashLines({ total: subtotal, method: payment, barId })
  return {
    lines,
    subtotal,
    commission,
    consumption,
    stockMoves,
    requirements,
    bottles: nextBottles,
    fee: money.fee,
    net: money.net,
    caixa: money.lines,
    employeeId,
  }
}

export function bottlePerformance(bottle, consumption = [], revenueByBottle = {}) {
  const consumed = (consumption || [])
    .filter(row => row.bottle_id === bottle.id && row.kind !== 'refund')
    .reduce((sum, row) => sum + (+row.volume_ml || 0), 0)
  const revenue = revenueByBottle[bottle.id]
  if (bottle.custo == null) {
    return { consumed, remaining: bottle.volume_atual, revenue: revenue ?? null, margin: null, costLabel: 'custo não disponível' }
  }
  return {
    consumed,
    remaining: bottle.volume_atual,
    revenue: revenue ?? 0,
    margin: (revenue ?? 0) - bottle.custo,
    costLabel: null,
  }
}

export function rememberClose(store, key, vendaId) {
  if (!key) throw new Error('idempotency key required')
  if (store.has(key)) return { created: false, vendaId: store.get(key) }
  store.set(key, vendaId)
  return { created: true, vendaId }
}

function feeSlice(sale, value) {
  const gross = Math.round(+sale.total || 0)
  const method = sale.metodo_pagamento
  const stored = sale.card_fee == null ? cardFee(gross, method) : Math.round(+sale.card_fee)
  if (stored <= 0 || gross <= 0) return 0
  const already = Math.round(+sale.refunded || 0)
  const alreadyFee = Math.round(+sale.card_fee_reversed || 0)
  const nextFee = Math.round(stored * (already + value) / gross)
  return Math.max(0, nextFee - alreadyFee)
}

export function voidSale(sale, { kind, amount, reason, employeeId, approverId, itemId, qty }) {
  if (!reason || !employeeId || !approverId) throw new Error('void needs reason, employee and approver')
  if (!['void', 'refund', 'partial_refund'].includes(kind)) throw new Error('unknown void')
  if (sale.void_status === 'void') throw new Error('already void')
  const gross = Math.round(+sale.total || 0)
  const already = Math.round(+sale.refunded || 0)
  const items = (sale.items || []).map(row => ({ ...row, refunded_qtd: Math.round(+row.refunded_qtd || 0) }))
  let value = 0
  let commissionBack = 0
  const restores = []
  if (kind === 'partial_refund') {
    const item = items.find(row => row.id === itemId)
    if (!item) throw new Error('item missing')
    const left = Math.round(+item.qtd || 0) - item.refunded_qtd
    const n = Math.round(+qty || 0)
    if (n <= 0 || n > left) throw new Error('refund exceeds item')
    value = Math.round(+item.unit_price || 0) * n
    if (amount != null && Math.round(+amount) !== value) throw new Error('refund exceeds sale')
    const lineCommission = Math.round(+item.comissao_valor || 0)
    const qtd = Math.round(+item.qtd || 0)
    commissionBack = Math.round(lineCommission * (item.refunded_qtd + n) / qtd) - Math.round(lineCommission * item.refunded_qtd / qtd)
    item.refunded_qtd += n
    if (item.stock_mode === 'ml' || item.consumed_ml) {
      const consumed = Math.round(+item.consumed_ml || 0)
      restores.push({ mode: 'ml', volume_ml: Math.round(consumed * n / qtd), item_id: item.id })
    }
    if (item.stock_mode === 'unit') {
      restores.push({ mode: 'unit', qtd: n, produto_id: item.produto_id, item_id: item.id })
    }
  } else {
    value = gross - already
    commissionBack = Math.round(+sale.comissao_valor || 0) - Math.round(+sale.comissao_estornada || 0)
    for (const item of items) {
      const left = Math.round(+item.qtd || 0) - item.refunded_qtd
      if (left <= 0) continue
      const qtd = Math.round(+item.qtd || 0)
      if (item.stock_mode === 'ml' || item.consumed_ml) {
        const consumed = Math.round(+item.consumed_ml || 0)
        const alreadyMl = Math.round(consumed * item.refunded_qtd / qtd)
        restores.push({ mode: 'ml', volume_ml: Math.round(consumed * (item.refunded_qtd + left) / qtd) - alreadyMl, item_id: item.id })
      }
      if (item.stock_mode === 'unit') {
        restores.push({ mode: 'unit', qtd: left, produto_id: item.produto_id, item_id: item.id })
      }
      item.refunded_qtd += left
    }
  }
  if (value <= 0 || value > gross - already) throw new Error('refund exceeds sale')
  const feeBack = feeSlice(sale, value)
  const refunded = already + value
  const cash = [{
    tipo: 'saida',
    valor: value,
    referencia_id: sale.id,
    referencia_tipo: 'pos_void',
  }]
  if (feeBack > 0) {
    cash.push({
      tipo: 'entrada',
      valor: feeBack,
      referencia_id: sale.id,
      referencia_tipo: 'taxa_cartao_estorno',
    })
  }
  return {
    sale: {
      ...sale,
      total: gross,
      refunded,
      void_status: refunded >= gross ? 'void' : 'partial_refund',
      comissao_valor: Math.round(+sale.comissao_valor || 0),
      comissao_estornada: Math.round(+sale.comissao_estornada || 0) + commissionBack,
      card_fee: sale.card_fee == null ? cardFee(gross, sale.metodo_pagamento) : Math.round(+sale.card_fee),
      card_fee_reversed: Math.round(+sale.card_fee_reversed || 0) + feeBack,
      items,
    },
    event: { kind, amount: value, reason, employee_id: employeeId, approver_id: approverId, venda_id: sale.id },
    cash,
    feeReversal: feeBack,
    commissionReversal: commissionBack,
    restores,
  }
}

export function openOrResume(tickets = [], { barId, spaceId, employeeId, id }) {
  if (!employeeId) throw new Error('employee required')
  const open = (tickets || []).filter(row => row.bar_id === barId && row.space_id === spaceId && row.status === 'open')
  if (open.length > 1) throw new Error('ticket not open')
  if (open.length === 1) return { created: false, ticket: open[0] }
  return {
    created: true,
    ticket: {
      id: id || `ticket-${spaceId}`,
      bar_id: barId,
      space_id: spaceId,
      status: 'open',
      created_by: employeeId,
      closed_by: null,
      venda_id: null,
      items: [],
    },
  }
}

export function addTicketItem(ticket, { drinkMenuId, produtoId, qty = 1, employeeId, forCast = false, id }) {
  if (!ticket || ticket.status !== 'open') throw new Error('ticket not open')
  if (!employeeId) throw new Error('employee required')
  const qtd = Math.round(+qty || 0)
  if (qtd <= 0) throw new Error('invalid quantity')
  if (!drinkMenuId && !produtoId) throw new Error('product not in this bar')
  if (drinkMenuId && produtoId) throw new Error('recipe line mixes unit and ml')
  const item = {
    id: id || `item-${ticket.items.length + 1}`,
    drink_menu_id: drinkMenuId || null,
    produto_id: produtoId || null,
    qtd,
    for_cast: !!forCast && !produtoId,
    added_by: employeeId,
  }
  return { ...ticket, items: [...ticket.items, item] }
}

export function removeTicketItem(ticket, itemId) {
  if (!ticket || ticket.status !== 'open') throw new Error('ticket not open')
  if (!ticket.items.some(row => row.id === itemId)) throw new Error('item missing')
  return { ...ticket, items: ticket.items.filter(row => row.id !== itemId) }
}

export function closeTicket(ticket, { key, store, vendaId, employeeId }) {
  if (!key) throw new Error('idempotency key required')
  if (!ticket || ticket.status !== 'open') {
    return { duplicate: true, vendaId: ticket?.venda_id || null, ticket }
  }
  if (store.has(key)) return { duplicate: true, vendaId: store.get(key), ticket }
  store.set(key, vendaId)
  return {
    duplicate: false,
    vendaId,
    ticket: { ...ticket, status: 'closed', venda_id: vendaId, closed_by: employeeId || null },
  }
}

export function commitClose(store, key, vendaId, { failBeforeWrite = false } = {}) {
  if (!key) throw new Error('idempotency key required')
  if (store.has(key)) return { created: false, vendaId: store.get(key) }
  if (failBeforeWrite) throw new Error('close failed')
  store.set(key, vendaId)
  return { created: true, vendaId }
}

export function operationalNight(iso) {
  return tokyoNightKey(new Date(iso))
}
