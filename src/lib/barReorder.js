/** When to draft a JBM bottle order from stock. */

import { addDays, weekdayOf } from './barClose.js'

export function nextMonday(today) {
  let cursor = today
  for (let i = 0; i < 8; i += 1) {
    if (weekdayOf(cursor) === 1) return cursor
    cursor = addDays(cursor, 1)
  }
  return today
}

export function shouldDraftReorder({ modo = 'queda', today, lastRun, scheduled }) {
  if (modo === 'segunda') {
    if (weekdayOf(today) !== 1) return false
    return lastRun !== today
  }
  if (scheduled && today < scheduled) return false
  return lastRun !== today
}

export function nextReorderDate(modo, today) {
  if (modo === 'segunda') return nextMonday(addDays(today, weekdayOf(today) === 1 ? 1 : 0))
  return addDays(today, 1)
}

export function reorderLines({ products = [], modo = 'queda', orderQty = 1, threshold = 0, openIds = new Set() } = {}) {
  const qty = Math.max(1, Math.round(+orderQty || 1))
  return (products || []).filter(p => {
    if (!p?.id || openIds.has(p.id) || !p.hasCount) return false
    if (modo === 'volume') return p.stock <= Math.max(0, +threshold || 0)
    return +p.minimo > 0 && p.stock <= p.minimo
  }).map(p => ({
    produto_id: p.id,
    nome: p.nome,
    qtd: qty,
    preco_unitario: +p.preco_venda || 0,
    stock: p.stock,
  }))
}
