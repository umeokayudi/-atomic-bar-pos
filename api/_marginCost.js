function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim()
}

const PEDIDO_OBS = /^Auto: order ([a-f0-9]{8})/i

function matchProductId(nome, produtos) {
  if (!nome) return null
  const n = norm(nome)
  const exact = produtos.find(p => norm(p.nome) === n)
  if (exact) return exact.id
  const partial = produtos.find(p => norm(p.nome).includes(n) || n.includes(norm(p.nome)))
  if (partial) return partial.id
  const first = n.split(/\s+/)[0]
  const byFirst = produtos.find(p => norm(p.nome).includes(first))
  return byFirst?.id || null
}

export function saleDate(v) {
  return v?.data || v?.data_venda || ''
}

export function buildPedidoByVendaPrefix(pedidos) {
  const map = {}
  for (const p of pedidos || []) {
    map[String(p.id).slice(0, 8).toLowerCase()] = p
  }
  return map
}

export function buildPurchaseCostIndex(compras, produtos = []) {
  const index = {}
  for (const compra of compras || []) {
    const date = compra.data
    if (!date) continue
    for (const it of compra.compras_itens || []) {
      const custo = +it.custo_unitario || 0
      if (!custo) continue
      let pid = it.produto_id
      if (!pid) pid = matchProductId(it.nome, produtos)
      if (!pid) continue
      if (!index[pid]) index[pid] = []
      index[pid].push({ date, custo })
    }
  }
  for (const pid of Object.keys(index)) {
    index[pid].sort((a, b) => a.date.localeCompare(b.date))
  }
  return index
}

export function unitCostAtDate(index, produtoId, saleDateStr, fallback = 0) {
  const history = index[produtoId] || []
  if (!history.length) return +fallback || 0
  if (!saleDateStr) return history[history.length - 1].custo
  let cost = +fallback || 0
  for (const h of history) {
    if (h.date <= saleDateStr) cost = h.custo
    else break
  }
  if (!cost && history.length) cost = history[0].custo
  return cost
}

export function marginFromVendaItem(it, vendaDate, index, produtos) {
  const qtd = +it.qtd || 0
  const preco = +it.preco_unitario || 0
  const receita = preco * qtd
  const fallback = it.produtos?.custo ?? produtos?.find(p => p.id === it.produto_id)?.custo ?? 0
  const unitCost = unitCostAtDate(index, it.produto_id, vendaDate, fallback)
  const custo = unitCost * qtd
  return { receita, custo, lucro: receita - custo, unitCost }
}

function marginFromPedidoItems(itens, vendaDate, index, produtos) {
  let receita = 0
  let custo = 0
  for (const it of itens || []) {
    const qtd = +it.qtd || 0
    const preco = +it.preco_unitario || 0
    receita += preco * qtd
    const fallback = it.produtos?.custo ?? produtos?.find(p => p.id === it.produto_id)?.custo ?? 0
    custo += unitCostAtDate(index, it.produto_id, vendaDate, fallback) * qtd
  }
  return { receita, custo, lucro: receita - custo }
}

function resolvePedidoForVenda(v, pedidoMap) {
  if (!pedidoMap) return null
  const m = (v.obs || '').match(PEDIDO_OBS)
  return m ? pedidoMap[m[1].toLowerCase()] : null
}

export function marginFromVenda(v, index, produtos = [], pedidoMap = null) {
  const total = +v.total || 0
  const date = saleDate(v)
  let vReceita = 0
  let vCusto = 0
  const items = v.vendas_itens || []

  for (const it of items) {
    const m = marginFromVendaItem(it, date, index, produtos)
    vReceita += m.receita
    vCusto += m.custo
  }

  const pedido = resolvePedidoForVenda(v, pedidoMap)
  if (pedido?.pedidos_itens?.length) {
    const pm = marginFromPedidoItems(pedido.pedidos_itens, date, index, produtos)
    if (!items.length) {
      vReceita = pm.receita
      vCusto = pm.custo
    } else if (vCusto === 0 && pm.custo > 0) {
      vCusto = pm.custo
    }
  }

  if (total > 0) {
    if (vReceita === 0) {
      vReceita = total
    } else if (Math.abs(total - vReceita) > 1) {
      const scale = total / vReceita
      vReceita = total
      vCusto = vCusto * scale
    }
  }

  return { receita: vReceita, custo: vCusto, lucro: vReceita - vCusto }
}

export function marginFromSales(sales, index, produtos = [], pedidoMap = null) {
  let receita = 0
  let custo = 0
  for (const v of sales || []) {
    const m = marginFromVenda(v, index, produtos, pedidoMap)
    receita += m.receita
    custo += m.custo
  }
  const lucro = receita - custo
  return {
    receita,
    custo,
    lucro,
    margemPct: receita > 0 ? Math.round((lucro / receita) * 100) : 0,
  }
}

export function marginFromPedidoItens(itens, pedidoDate, index, produtos = []) {
  let receita = 0
  let custo = 0
  for (const it of itens || []) {
    const qtd = +it.qtd || 0
    const preco = +it.preco_unitario || 0
    receita += preco * qtd
    const fallback = it.produtos?.custo ?? produtos?.find(p => p.id === it.produto_id)?.custo ?? 0
    custo += unitCostAtDate(index, it.produto_id, pedidoDate, fallback) * qtd
  }
  return { receita, custo, lucro: receita - custo }
}
