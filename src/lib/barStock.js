/** Bar stock from JBM delivery notes + POS pours + explicit movimentos. Never writes vendas/faturas. */

import { bottlesFromShots } from './posSupply.js'

export function qtyOfMove(m) {
  const n = +m?.qtd || 0
  if (!n) return 0
  return m.tipo === 'entrada' ? n : -n
}

function nameKey(m) {
  return String(m?.nome || '').trim().toLowerCase()
}

function moveKey(m) {
  if (m?.produto_id) return `id:${m.produto_id}`
  const n = nameKey(m)
  return n ? `name:${n}` : ''
}

export function deliveryNoteMoves(notes = []) {
  const out = []
  for (const v of notes || []) {
    const items = v.vendas_itens || v.itens || []
    for (const it of items) {
      const id = it.produto_id || it.produtos?.id
      const nome = it.produtos?.nome || it.nome || ''
      if ((!id && !nome) || !(+it.qtd > 0)) continue
      out.push({
        produto_id: id || null,
        nome,
        tipo: 'entrada',
        qtd: +it.qtd,
        obs: `JBM note ${String(v.id || '').slice(0, 8)}`,
        implied: true,
      })
    }
  }
  return out
}

/** POS line items → bottle saidas. No drinks_por_garrafa means skip (never eat a whole bottle per shot). */
export function posPourMoves(items = [], pricingByProduto = {}) {
  const out = []
  for (const it of items || []) {
    const id = it.produto_id || it.produtos?.id
    const nome = it.produtos?.nome || it.nome || ''
    if (!id && !nome) continue
    const dpb = (id && pricingByProduto[id]?.drinks_por_garrafa)
      || +it.drinks_por_garrafa
      || 0
    const bottles = bottlesFromShots(it.qtd || 1, dpb)
    if (bottles <= 0) continue
    out.push({
      produto_id: id || null,
      nome,
      tipo: 'saida',
      qtd: bottles,
      obs: `POS pour ${String(it.pos_venda_id || it.id || '').slice(0, 8)}`,
      implied: true,
    })
  }
  return out
}

function keysOfType(rows, tipo) {
  const keys = new Set()
  for (const m of rows || []) {
    if (m?.tipo !== tipo || !(+m.qtd > 0)) continue
    const k = moveKey(m)
    if (k) keys.add(k)
  }
  return keys
}

/** Trust explicit movimentos per product. Fill gaps with implied JBM in / POS out. Keep name-only rows. */
export function coalesceStockMoves(explicit = [], impliedIn = [], impliedOut = []) {
  const hasEntrada = keysOfType(explicit, 'entrada')
  const hasSaida = keysOfType(explicit, 'saida')
  const extraIn = (impliedIn || []).filter(m => {
    const k = moveKey(m)
    return k && !hasEntrada.has(k)
  })
  const extraOut = (impliedOut || []).filter(m => {
    const k = moveKey(m)
    return k && !hasSaida.has(k)
  })
  return [...(explicit || []), ...extraIn, ...extraOut]
}

export function stockMapFromMoves(moves = []) {
  const map = {}
  for (const m of moves) {
    if (!m?.produto_id) continue
    map[m.produto_id] = (map[m.produto_id] || 0) + qtyOfMove(m)
  }
  return map
}

export function decorateStockList(produtos = [], moves = [], regras = {}) {
  const map = stockMapFromMoves(moves)
  const byName = {}
  const counted = new Set()
  for (const m of moves) {
    if (m?.produto_id) counted.add(m.produto_id)
    const n = nameKey(m)
    if (n) {
      byName[n] = (byName[n] || 0) + qtyOfMove(m)
      counted.add(`name:${n}`)
    }
  }
  return (produtos || []).map(p => {
    const nk = String(p.nome || '').trim().toLowerCase()
    const raw = map[p.id] != null ? map[p.id] : byName[nk]
    const stock = Math.max(0, Math.round((raw || 0) * 100) / 100)
    const minimo = +regras[p.id] || 0
    const hasCount = counted.has(p.id) || counted.has(`name:${nk}`)
    const empty = hasCount && stock === 0
    const low = hasCount && minimo > 0 && stock > 0 && stock < minimo
    const crit = hasCount && minimo > 0 && stock === 0
    const good = hasCount && stock > 0 && (minimo === 0 || stock >= minimo)
    return {
      ...p,
      stock,
      minimo,
      hasCount,
      empty,
      low,
      crit,
      good,
      unknown: !hasCount,
    }
  })
}

export function stockGlance(list = []) {
  const rows = list || []
  return {
    total: rows.length,
    needAttention: rows.filter(p => p.crit || p.low).length,
    wellStocked: rows.filter(p => p.good).length,
    unknown: rows.filter(p => p.unknown).length,
    empty: rows.filter(p => p.empty).length,
  }
}

export function stockFlow(moves = []) {
  let delivered = 0
  let poured = 0
  for (const m of moves || []) {
    const n = +m?.qtd || 0
    if (n <= 0) continue
    if (m.tipo === 'entrada') delivered += n
    if (m.tipo === 'saida') poured += n
  }
  return {
    delivered: Math.round(delivered * 100) / 100,
    poured: Math.round(poured * 100) / 100,
    onHand: Math.round(Math.max(0, delivered - poured) * 100) / 100,
  }
}

export function lowStockFromList(list = []) {
  return (list || [])
    .filter(p => p.hasCount && p.minimo > 0 && p.stock <= p.minimo)
    .sort((a, b) => a.stock - b.stock)
    .map(p => ({ id: p.id, nome: p.nome, qtd: p.stock, minimo: p.minimo }))
}
