/**
 * Elo POS ↔ fornecimento JBM
 *
 * Dois livros, um ciclo:
 *   Caixa do bar  → pos_vendas          (dinheiro do cliente do bar)
 *   Conta JBM     → vendas + pedidos    (dinheiro que o bar deve à JBM)
 *
 * Ciclo: shot no caixa → baixa garrafa → estoque mínimo → pedido JBM
 *        → entrega JBM → entrada de estoque → o bar vende de novo.
 *
 * Nunca gravar venda de balcão em `vendas`. Nunca criar fatura a partir de POS.
 */

import { tokyoDateKey } from './tokyo.js'

export const RESTOCK_OBS = 'Auto: restock caixa'
export const POS_STOCK_OBS_PREFIX = 'POS caixa'
export const JBM_DELIVERY_OBS_PREFIX = 'JBM delivery'

export function isRestockPedido(pedido) {
  return String(pedido?.obs || '').includes(RESTOCK_OBS)
}

export function findOpenRestockPedido(pedidos = []) {
  return (pedidos || []).find(p =>
    isRestockPedido(p) && p.status !== 'entregue' && p.status !== 'cancelado'
  ) || null
}

export async function fetchAllRows(queryFactory, pageSize = 1000) {
  const rows = []
  let from = 0
  for (;;) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return rows
}

/** Todos os movimentos do bar — sem corte de 500 linhas. */
export async function fetchAllStockMovements(supabase, barId, columns = 'produto_id,tipo,qtd') {
  return fetchAllRows(() =>
    supabase.from('estoque_movimentos').select(columns).eq('bar_id', barId)
  )
}

export function bottlesFromShots(shotQty, drinksPerBottle) {
  const shots = +shotQty || 0
  const dpb = +drinksPerBottle || 0
  if (shots <= 0 || dpb <= 0) return 0
  return Math.round((shots / dpb) * 10000) / 10000
}

export function pricingMapFromShots(shots = []) {
  const map = {}
  for (const s of shots) {
    const id = s.produto_id || s.id
    if (!id) continue
    map[id] = { drinks_por_garrafa: +s.drinks_por_garrafa || 16 }
  }
  return map
}

/** Agrupa o carrinho POS em garrafas a baixar (só itens com produto_id = shot JBM). */
export function bottlesConsumedFromCart(cart = [], pricingByProduto = {}) {
  const byProduto = {}
  for (const it of cart) {
    if (!it.produto_id) continue
    const dpb = pricingByProduto[it.produto_id]?.drinks_por_garrafa
    const bottles = bottlesFromShots(it.qtd || 1, dpb)
    if (bottles <= 0) continue
    byProduto[it.produto_id] = Math.round(((byProduto[it.produto_id] || 0) + bottles) * 10000) / 10000
  }
  return byProduto
}

export function suggestedReorderQty(stock, minimo) {
  const s = Math.max(0, +stock || 0)
  const min = Math.max(0, +minimo || 0)
  if (min <= 0 || s > min) return 0
  return Math.max(1, Math.ceil(min * 2 - s))
}

export function productsAlreadyOnOpenOrders(pedidos = []) {
  const ids = new Set()
  for (const p of pedidos) {
    if (!p || p.status === 'entregue' || p.status === 'cancelado') continue
    for (const it of p.pedidos_itens || []) {
      if (it.produto_id) ids.add(it.produto_id)
    }
  }
  return ids
}

export function buildRestockItems(lowStock, alreadyOnOrder = new Set()) {
  return (lowStock || [])
    .filter(p => p?.id && !alreadyOnOrder.has(p.id))
    .map(p => ({
      produto_id: p.id,
      nome: p.nome,
      qtd: suggestedReorderQty(p.stock, p.minimo),
      preco_unitario: +p.preco_venda || 0,
      stock: p.stock,
      minimo: p.minimo,
    }))
    .filter(it => it.qtd > 0)
}

export function posStockObs(vendaId) {
  return `${POS_STOCK_OBS_PREFIX} ${String(vendaId || '').slice(0, 8)}`
}

export function deliveryStockObs(pedidoId) {
  return `${JBM_DELIVERY_OBS_PREFIX} ${String(pedidoId || '').slice(0, 8)}`
}

/** Baixa estoque em GARRAFAS (não em shots). Drink de cardápio sem produto_id não mexe no estoque JBM. */
export async function deductBottlesForPosSale(supabase, { barId, cart, vendaId, userId, pricingByProduto }) {
  const consumed = bottlesConsumedFromCart(cart, pricingByProduto)
  const rows = Object.entries(consumed).map(([produto_id, qtd]) => ({
    produto_id,
    bar_id: barId,
    tipo: 'saida',
    qtd,
    criado_por: userId || null,
    obs: posStockObs(vendaId),
  }))
  if (!rows.length) return { deducted: 0, bottles: consumed }

  const { error } = await supabase.from('estoque_movimentos').insert(rows)
  if (error) throw error
  return { deducted: rows.length, bottles: consumed }
}

export async function addStockFromDelivery(supabase, pedido) {
  const itens = (pedido?.pedidos_itens || []).filter(it => it.produto_id && +it.qtd > 0)
  if (!pedido?.id || !pedido?.bar_id || !itens.length) return { added: 0, skipped: true }

  const obs = deliveryStockObs(pedido.id)
  const { data: existing } = await supabase
    .from('estoque_movimentos')
    .select('id')
    .eq('bar_id', pedido.bar_id)
    .eq('obs', obs)
    .limit(1)
  if (existing?.length) return { added: 0, skipped: true }

  const { error } = await supabase.from('estoque_movimentos').insert(
    itens.map(it => ({
      produto_id: it.produto_id,
      bar_id: pedido.bar_id,
      tipo: 'entrada',
      qtd: +it.qtd,
      criado_por: pedido.criado_por || null,
      obs,
    }))
  )
  if (error) throw error
  return { added: itens.length, skipped: false }
}

/**
 * Cria UM pedido JBM (pendente) com os produtos em estoque baixo
 * que ainda não estão num pedido aberto. Não toca em `vendas`.
 */
export async function createJbmRestockPedido(supabase, { bar, userId, items }) {
  const list = (items || []).filter(it => it.produto_id && it.qtd > 0)
  if (!list.length) return { pedido: null, created: false }

  const total = list.reduce((a, it) => a + (+it.preco_unitario || 0) * (+it.qtd || 0), 0)
  const { data: pedido, error } = await supabase.from('pedidos').insert({
    bar_id: bar.id,
    criado_por: userId || null,
    status: 'pendente',
    data_pedido: tokyoDateKey(),
    obs: RESTOCK_OBS,
    total_estimado: total,
  }).select().single()

  if (error) throw error

  const { error: itemsError } = await supabase.from('pedidos_itens').insert(
    list.map(it => ({
      pedido_id: pedido.id,
      produto_id: it.produto_id,
      qtd: it.qtd,
      preco_unitario: +it.preco_unitario || 0,
    }))
  )
  if (itemsError) throw itemsError

  const { data: admins } = await supabase.from('perfis').select('id').eq('role', 'admin')
  if (admins?.length) {
    await supabase.from('notificacoes').insert(
      admins.map(adm => ({
        user_id: adm.id,
        tipo: 'pedido_novo',
        titulo: `Restock ${bar.nome}`,
        mensagem: `${list.length} product(s) · ¥${Math.round(total).toLocaleString('ja-JP')} · ${RESTOCK_OBS}`,
      }))
    ).catch(() => {})
  }

  return { pedido, created: true, total, items: list }
}

/** Acrescenta SKUs novos a um pedido restock já aberto. Não toca em `vendas`. */
export async function appendItemsToRestockPedido(supabase, pedido, items) {
  const list = (items || []).filter(it => it.produto_id && it.qtd > 0)
  if (!pedido?.id || !list.length) return { pedido, added: 0, totalAdded: 0 }

  const { error } = await supabase.from('pedidos_itens').insert(
    list.map(it => ({
      pedido_id: pedido.id,
      produto_id: it.produto_id,
      qtd: it.qtd,
      preco_unitario: +it.preco_unitario || 0,
    }))
  )
  if (error) throw error

  const extra = list.reduce((a, it) => a + (+it.preco_unitario || 0) * (+it.qtd || 0), 0)
  const nextTotal = (+pedido.total_estimado || 0) + extra
  await supabase.from('pedidos').update({ total_estimado: nextTotal }).eq('id', pedido.id)
  return { pedido: { ...pedido, total_estimado: nextTotal }, added: list.length, totalAdded: extra }
}

async function notifyPosReorderWebhook(payload) {
  if (typeof fetch !== 'function') return
  let headers = { 'Content-Type': 'application/json' }
  try {
    const { staffAuthHeaders } = await import('./apiAuth.js')
    headers = await staffAuthHeaders(headers)
  } catch {
    // testes Node / sessão ausente
  }
  await fetch('/api/pos-reorder', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
}

export async function syncPosStockAndReorder(supabase, {
  bar,
  cart,
  vendaId,
  userId,
  pricingByProduto,
  buildStockMap,
  findLowStockProducts,
}) {
  const deducted = await deductBottlesForPosSale(supabase, {
    barId: bar.id, cart, vendaId, userId, pricingByProduto,
  })

  const [movimentos, rR, pedR] = await Promise.all([
    fetchAllStockMovements(supabase, bar.id),
    supabase.from('estoque_regras').select('produto_id,minimo').eq('bar_id', bar.id),
    supabase.from('pedidos').select('id,status,obs,total_estimado,pedidos_itens(produto_id,qtd,preco_unitario)').eq('bar_id', bar.id).in('status', ['pendente', 'confirmado']),
  ])

  const regras = Object.fromEntries((rR.data || []).map(r => [r.produto_id, r.minimo]))
  const regraIds = Object.keys(regras)
  let produtos = []
  if (regraIds.length) {
    const pR = await supabase.from('produtos_public').select('id,nome,preco_venda').in('id', regraIds)
    produtos = pR.data || []
  }

  const stockMap = buildStockMap(movimentos || [])
  const alerts = findLowStockProducts(produtos, stockMap, regras)
  const already = productsAlreadyOnOpenOrders(pedR.data || [])
  const restockItems = buildRestockItems(alerts, already)

  let pedido = null
  let merged = false
  if (restockItems.length) {
    const openRestock = findOpenRestockPedido(pedR.data || [])
    if (openRestock) {
      const appended = await appendItemsToRestockPedido(supabase, openRestock, restockItems)
      pedido = appended.pedido
      merged = true
    } else {
      const created = await createJbmRestockPedido(supabase, { bar, userId, items: restockItems })
      pedido = created.pedido
    }
  }

  try {
    const hookItems = (restockItems.length ? restockItems : alerts).map(a => ({
      produto_id: a.produto_id || a.id,
      nome: a.nome,
      stock_atual: a.stock,
      min_stock: a.minimo,
      qty_sugerida: a.qtd || suggestedReorderQty(a.stock, a.minimo),
    }))
    if (hookItems.length) {
      await notifyPosReorderWebhook({
        bar_id: bar.id,
        bar_nome: bar.nome,
        pedido_id: pedido?.id || null,
        items: hookItems,
      })
    }
  } catch {
    // webhook opcional
  }

  return { ...deducted, alerts, pedido, restockItems, merged }
}
