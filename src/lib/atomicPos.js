/** Helpers do POS Atomic — preços, descontos, códigos, dashboard e estoque */

import { tokyoDateKey, tokyoHour, tokyoNightKey } from './tokyo.js'

export function generateDiscountCode(prefix = 'ATOMIC') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
  return `${prefix}-${suffix}`
}

export function applyDiscount(preco, code) {
  if (!code || !preco) return { preco, desconto: 0 }
  const tipo = code.tipo || 'percent'
  const valor = +code.valor || 0
  let desconto = 0
  if (tipo === 'percent') desconto = Math.round(preco * (valor / 100))
  else desconto = Math.min(preco, Math.round(valor))
  return { preco: Math.max(0, preco - desconto), desconto }
}

export function itemDrinkId(item) {
  if (!item) return null
  if (item.drink_menu_id) return item.drink_menu_id
  if (item.kind === 'drink') return item.id
  return null
}

export function itemProdutoId(item) {
  if (!item) return null
  if (item.produto_id) return item.produto_id
  if (item.kind === 'shot') return item.id
  return null
}

/** Scoped codes only hit the matching drink/product. Cart-wide codes have neither id. */
export function discountAppliesToItem(code, item) {
  if (!code) return false
  if (code.drink_menu_id && itemDrinkId(item) !== code.drink_menu_id) return false
  if (code.produto_id && itemProdutoId(item) !== code.produto_id) return false
  return true
}

export function resolveItemPrice(item, priceType = 'regular', discountCode = null) {
  const lista = item.preco_lista ?? item.preco_venda ?? item.preco_drink ?? 0
  let preco = lista
  let tipo = 'regular'

  if (priceType === 'vip') {
    preco = item.preco_vip ?? item.preco_desconto ?? Math.round(lista * 0.5)
    tipo = 'vip'
  }

  if (discountCode && discountAppliesToItem(discountCode, item)) {
    const applied = applyDiscount(preco, discountCode)
    return {
      preco: applied.preco,
      preco_unitario: applied.preco,
      preco_lista: lista,
      tipo_preco: 'codigo',
      desconto_valor: applied.desconto,
    }
  }

  return {
    preco,
    preco_unitario: preco,
    preco_lista: lista,
    tipo_preco: tipo,
    desconto_valor: priceType === 'vip' ? lista - preco : 0,
  }
}

export function validateDiscountCode(code, { drinkMenuId, produtoId } = {}) {
  if (!code) return { ok: false, errorKey: 'atomicPos.codeInvalid', error: 'Invalid code' }
  if (!code.ativo) return { ok: false, errorKey: 'atomicPos.codeDisabled', error: 'Code disabled' }
  if (code.valido_ate && code.valido_ate < tokyoDateKey()) {
    return { ok: false, errorKey: 'atomicPos.codeExpired', error: 'Code expired' }
  }
  if (code.max_usos != null && (code.usos_atual || 0) >= code.max_usos) {
    return { ok: false, errorKey: 'atomicPos.codeExhausted', error: 'Code used up' }
  }
  if (code.drink_menu_id && drinkMenuId && code.drink_menu_id !== drinkMenuId) {
    return { ok: false, errorKey: 'atomicPos.codeWrongDrink', error: 'Code not valid for this drink' }
  }
  if (code.produto_id && produtoId && code.produto_id !== produtoId) {
    return { ok: false, errorKey: 'atomicPos.codeWrongProduct', error: 'Code not valid for this product' }
  }
  return { ok: true }
}

export async function checkPosSchema(supabase) {
  try {
    const r = await fetch('/api/pos-status', { signal: AbortSignal.timeout(8000) })
    const j = await r.json()
    if (j?.ready) return { ready: true, source: j.source }
  } catch {}
  const { error } = await supabase.from('pos_vendas').select('id').limit(1)
  if (!error) return { ready: true, source: 'postgres' }
  if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
    return { ready: true, source: 'live-store' }
  }
  return { ready: true, source: 'live-store', error: error.message }
}

export async function fetchPosSetupStatus(supabase) {
  return checkPosSchema(supabase)
}

export function lineUnitPrice(it) {
  return +(it?.preco_unitario ?? it?.preco ?? 0) || 0
}

export function cartTotal(cart) {
  return (cart || []).reduce((a, it) => a + lineUnitPrice(it) * (it.qtd || 1), 0)
}

export const todayKey = tokyoDateKey

/** Agrega vendas POS por faixa horária de Tóquio (0–23) */
export function aggregateHourlySales(sales = []) {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}:00`,
    count: 0,
    total: 0,
  }))
  for (const s of sales) {
    const ts = s.criado_em || s.data
    if (!ts) continue
    const h = tokyoHour(ts)
    hours[h].count += 1
    hours[h].total += +s.total || 0
  }
  return hours
}

/** Calcula estoque atual por produto a partir dos movimentos */
export function buildStockMap(movimentos = []) {
  const map = {}
  for (const m of movimentos) {
    if (!m.produto_id) continue
    if (!map[m.produto_id]) map[m.produto_id] = 0
    map[m.produto_id] += m.tipo === 'entrada' ? +m.qtd : -+m.qtd
  }
  return map
}

/** Produtos com estoque abaixo do mínimo */
export function findLowStockProducts(produtos = [], stockMap = {}, regras = {}) {
  return produtos
    .map(p => ({
      ...p,
      stock: Math.max(0, stockMap[p.id] || 0),
      minimo: regras[p.id] || 0,
    }))
    .filter(p => p.minimo > 0 && p.stock <= p.minimo)
    .sort((a, b) => a.stock - b.stock)
}

export {
  bottlesFromShots,
  bottlesConsumedFromCart,
  pricingMapFromShots,
  suggestedReorderQty,
  buildRestockItems,
  productsAlreadyOnOpenOrders,
  isRestockPedido,
  syncPosStockAndReorder,
  fetchAllStockMovements,
} from './posSupply.js'

/** Métricas rápidas do dia para o dashboard POS */
export function computeDayMetrics(sales = []) {
  const total = sales.reduce((a, s) => a + (+s.total || 0), 0)
  const count = sales.length
  const ticketMedio = count > 0 ? Math.round(total / count) : 0
  const hourly = aggregateHourlySales(sales)
  const peakHour = hourly.reduce((best, h) => (h.total > best.total ? h : best), hourly[0])
  return { total, count, ticketMedio, peakHour, hourly }
}

export async function rollbackPosSale(supabase, vendaId) {
  if (!vendaId) return
  await supabase.from('discount_usages').delete().eq('pos_venda_id', vendaId)
  await supabase.from('vip_usages').delete().eq('pos_venda_id', vendaId)
  await supabase.from('pos_vendas_itens').delete().eq('pos_venda_id', vendaId)
  await supabase.from('pos_vendas').delete().eq('id', vendaId)
}

/**
 * Grava a venda POS e só confirma se o estoque baixar.
 * Nunca escreve em `vendas` / `faturas`.
 */
export async function commitPosSale(supabase, {
  bar,
  cart,
  payMethod = 'Cash',
  priceType = 'regular',
  vipId = null,
  activeCode = null,
  agentId = null,
  spaceId = null,
  guestId = null,
  visitId = null,
  obs = '',
  keepPour = null,
  userId = null,
  shots = [],
  syncStock,
}) {
  if (!cart?.length) return { ok: false, errorKey: 'atomicPos.cartEmpty' }
  if (priceType === 'vip' && !vipId) return { ok: false, errorKey: 'atomicPos.vipMemberRequired' }

  const subtotal = cart.reduce((a, it) => a + (it.preco_lista || lineUnitPrice(it)) * (it.qtd || 1), 0)
  const total = cartTotal(cart)
  const desconto = subtotal - total
  const tipo = priceType === 'vip' || vipId ? 'vip' : activeCode ? 'desconto' : 'balcao'

  const vendaPayload = {
    bar_id: bar.id,
    data: tokyoNightKey(),
    subtotal,
    desconto_total: desconto,
    total,
    metodo_pagamento: payMethod,
    tipo,
    vip_member_id: vipId || null,
    discount_code_id: activeCode?.id || null,
    criado_por: userId || null,
  }
  const note = String(obs || '').trim()
  if (note) vendaPayload.obs = note
  if (agentId) vendaPayload.drink_back_agent_id = agentId
  if (spaceId) vendaPayload.space_id = spaceId
  if (guestId) vendaPayload.guest_id = guestId
  if (visitId) vendaPayload.visit_id = visitId

  let venda, error
  ;({ data: venda, error } = await supabase.from('pos_vendas').insert(vendaPayload).select().single())
  if (error?.message?.includes('drink_back_agent_id') || error?.message?.includes('space_id') || error?.message?.includes('guest_id') || error?.message?.includes('visit_id') || error?.message?.includes('obs')) {
    delete vendaPayload.drink_back_agent_id
    delete vendaPayload.space_id
    delete vendaPayload.guest_id
    delete vendaPayload.visit_id
    if (error.message.includes('obs')) delete vendaPayload.obs
    ;({ data: venda, error } = await supabase.from('pos_vendas').insert(vendaPayload).select().single())
  }
  if (error) return { ok: false, error: error.message }

  const { error: itemsError } = await supabase.from('pos_vendas_itens').insert(
    cart.map(it => ({
      pos_venda_id: venda.id,
      drink_menu_id: it.drink_menu_id,
      produto_id: it.produto_id,
      nome: it.nome,
      qtd: it.qtd,
      preco_unitario: lineUnitPrice(it),
      preco_lista: it.preco_lista,
      tipo_preco: it.tipo_preco,
      desconto_valor: it.desconto_valor || 0,
    }))
  )
  if (itemsError) {
    await rollbackPosSale(supabase, venda.id)
    return { ok: false, error: itemsError.message, errorKey: 'atomicPos.saleStockFailed' }
  }

  let stock = { deducted: 0, alerts: [], pedido: null, restockItems: [] }
  try {
    if (syncStock) {
      stock = await syncStock({
        bar,
        cart,
        vendaId: venda.id,
        userId,
      })
    }
  } catch (stockErr) {
    await rollbackPosSale(supabase, venda.id)
    return { ok: false, error: stockErr.message, errorKey: 'atomicPos.saleStockFailed' }
  }

  if (activeCode) {
    await supabase.from('discount_codes').update({ usos_atual: (activeCode.usos_atual || 0) + 1 }).eq('id', activeCode.id)
    await supabase.from('discount_usages').insert({
      bar_id: bar.id,
      discount_code_id: activeCode.id,
      pos_venda_id: venda.id,
      valor_desconto: desconto,
    })
  }

  if (vipId) {
    for (const it of cart) {
      await supabase.from('vip_usages').insert({
        bar_id: bar.id,
        vip_member_id: vipId,
        drink_menu_id: it.drink_menu_id,
        produto_id: it.produto_id,
        nome: it.nome,
        qtd: it.qtd,
        preco_aplicado: lineUnitPrice(it),
        preco_lista: it.preco_lista,
        tipo: 'vip',
        pos_venda_id: venda.id,
        criado_por: userId || null,
      })
    }
  }

  if (visitId && venda?.id) {
    await supabase.from('bar_visits').update({ pos_venda_id: venda.id }).eq('id', visitId).catch(() => {})
  }

  if (keepPour?.id && +keepPour.pct > 0) {
    try {
      const { data: keep } = await supabase.from('bar_bottle_keeps').select('id,remaining_pct').eq('id', keepPour.id).maybeSingle()
      if (keep) {
        const remaining = Math.max(0, Math.round((+keep.remaining_pct || 0) - +keepPour.pct))
        await supabase.from('bar_bottle_keeps').update({ remaining_pct: remaining, ativo: remaining > 0 }).eq('id', keep.id)
      }
    } catch {
      // Keep pour is POS-side only; a miss must not roll back the till sale.
    }
  }

  return { ok: true, venda, total, desconto, stock, shots }
}
