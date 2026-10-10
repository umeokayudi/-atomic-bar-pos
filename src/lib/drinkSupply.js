import { pedidoTotal } from './pedidoVenda.js'
import { buildRestockItems, productsAlreadyOnOpenOrders } from './posSupply.js'

/** One place for drinks from JBM: what to order, what is on the way, what arrived. */

export const SUPPLY_STEPS = ['order', 'way', 'received']

export function isOpenOrder(p) {
  return p?.status === 'pendente' || p?.status === 'confirmado'
}

export function orderDay(p) {
  return String(p?.data_pedido || p?.criado_em || '').slice(0, 10)
}

export function orderKey(id) {
  return String(id || '').slice(0, 8).toLowerCase()
}

/** Delivery notes made from an order carry "order <first 8 of its id>" in obs. */
export function noteOrderKey(note) {
  const m = /order\s+([0-9a-z]{1,8})/i.exec(note?.obs || '')
  return m ? m[1].toLowerCase() : ''
}

/** Drinks at or under their minimum that are not already on an open order, with a suggested quantity. */
export function restockSuggestions(stockList = [], pedidos = []) {
  const low = (stockList || []).filter(p => p?.hasCount && p.minimo > 0 && p.stock <= p.minimo)
  return buildRestockItems(low, productsAlreadyOnOpenOrders(pedidos)).sort((a, b) => a.stock - b.stock)
}

/** Open orders, the ones past their expected date first, then by expected date, then newest. */
export function openOrders(pedidos = [], today = '') {
  return (pedidos || []).filter(isOpenOrder).map(p => ({
    ...p,
    late: !!(today && p.data_entrega_prevista && String(p.data_entrega_prevista).slice(0, 10) < today),
  })).sort((a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1
    const ea = String(a.data_entrega_prevista || '9999')
    const eb = String(b.data_entrega_prevista || '9999')
    if (ea !== eb) return ea < eb ? -1 : 1
    return orderDay(b).localeCompare(orderDay(a))
  })
}

/**
 * Everything that arrived (or was cancelled), as one list: each delivery note once, joined to the order it
 * came from when there is one, plus delivered or cancelled orders that have no note yet.
 */
export function receivedTimeline({ pedidos = [], notes = [], month = '' } = {}) {
  const byKey = new Map((pedidos || []).map(p => [orderKey(p.id), p]))
  const linked = new Set()
  const rows = (notes || []).map(n => {
    const order = byKey.get(noteOrderKey(n)) || null
    if (order) linked.add(order.id)
    return {
      id: `n:${n.id}`,
      kind: 'note',
      date: String(n.data || n.data_venda || n.criado_em || '').slice(0, 10),
      total: +n.total || 0,
      items: (n.vendas_itens || []).map(it => ({ key: it.id, nome: it.produtos?.nome || '?', qtd: +it.qtd || 0, preco: +it.preco_unitario || 0 })),
      order,
      note: n,
    }
  })
  for (const p of pedidos || []) {
    if (linked.has(p.id) || (p.status !== 'entregue' && p.status !== 'cancelado')) continue
    rows.push({
      id: `o:${p.id}`,
      kind: p.status === 'cancelado' ? 'cancelled' : 'order',
      date: String(p.data_entrega_prevista || orderDay(p)).slice(0, 10),
      total: p.status === 'cancelado' ? 0 : pedidoTotal(p),
      items: (p.pedidos_itens || []).map(it => ({ key: it.id, nome: it.produtos?.nome || '?', qtd: +it.qtd || 0, preco: +it.preco_unitario || 0 })),
      order: p,
      note: null,
    })
  }
  return rows
    .filter(r => !month || r.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** The three numbers on top of the supply page. */
export function supplyOverview({ pedidos = [], notes = [], restock = [], today = '', month = '' } = {}) {
  const open = openOrders(pedidos, today)
  const upcoming = open.map(p => String(p.data_entrega_prevista || '').slice(0, 10)).filter(d => d && d >= today).sort()
  const received = receivedTimeline({ pedidos, notes, month }).filter(r => r.kind !== 'cancelled')
  return {
    toOrder: restock.length,
    onTheWay: open.length,
    pending: open.filter(p => p.status === 'pendente').length,
    confirmed: open.filter(p => p.status === 'confirmado').length,
    late: open.filter(p => p.late).length,
    nextArrival: upcoming[0] || '',
    receivedCount: received.length,
    receivedTotal: received.reduce((a, r) => a + r.total, 0),
  }
}

/** Bottles per product across a list of received rows, biggest spend first. */
export function receivedByProduct(rows = []) {
  const map = new Map()
  for (const r of rows || []) {
    if (r.kind === 'cancelled') continue
    for (const it of r.items) {
      const cur = map.get(it.nome) || { nome: it.nome, qtd: 0, total: 0 }
      cur.qtd += it.qtd
      cur.total += it.qtd * it.preco
      map.set(it.nome, cur)
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.qtd - a.qtd)
}
