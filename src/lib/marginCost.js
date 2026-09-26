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

/** Map pedido id prefix (8 chars) → pedido for venda Auto: order */
export function buildPedidoByVendaPrefix(pedidos) {
  const map = {}
  for (const p of pedidos || []) {
    map[String(p.id).slice(0, 8).toLowerCase()] = p
  }
  return map
}

function compraDate(compra) {
  const d = compra?.data_compra || compra?.data || ''
  return d ? String(d).slice(0, 10) : ''
}

/** Histórico de custo unitário por produto (compras_itens) */
export function buildPurchaseCostIndex(compras, produtos = []) {
  const index = {}

  for (const compra of compras || []) {
    const date = compraDate(compra)
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

/** Custo unitário vigente na data da venda — só preços de notas de compra (sem catálogo) */
export function unitCostAtDate(index, produtoId, saleDateStr) {
  const history = index[produtoId] || []
  if (!history.length) return 0
  if (!saleDateStr) return history[history.length - 1].custo

  let cost = 0
  for (const h of history) {
    if (h.date <= saleDateStr) cost = h.custo
    else break
  }
  if (!cost && history.length) cost = history[0].custo
  return cost
}

/** Total pago nas notas de compra de um mês */
export function comprasTotalForMonth(compras, monthKeyFn, month) {
  return (compras || [])
    .filter(c => monthKeyFn(c) === month)
    .reduce((a, c) => a + (+c.total_real || 0), 0)
}

/** Rateia custo das notas proporcionalmente à receita (bar / venda / produto) */
export function allocateInvoiceCost(totalCompras, receita, receitaTotal) {
  if (!totalCompras || !receitaTotal) return 0
  return totalCompras * (receita / receitaTotal)
}

/** Linhas item a item das notas de compra de um mês */
export function flattenComprasItens(comprasMes) {
  const rows = []
  for (const c of [...(comprasMes || [])].sort((a, b) => (a.data || '').localeCompare(b.data || ''))) {
    for (const it of c.compras_itens || []) {
      const qtd = +it.qtd || 0
      const custoUnit = +it.custo_unitario || 0
      rows.push({
        compraId: c.id,
        data: c.data,
        fornecedor: c.fornecedor,
        pagamento: c.pagamento,
        nome: it.nome || '—',
        qtd,
        custoUnit,
        totalLinha: qtd * custoUnit,
        notaTotal: +c.total_real || 0,
        desconto: +c.desconto_pontos || 0,
      })
    }
  }
  return rows
}

/** Soma qtd/custo por produto nas notas do mês */
export function aggregateComprasItens(comprasMes) {
  const map = {}
  for (const row of flattenComprasItens(comprasMes)) {
    const key = row.nome
    if (!map[key]) map[key] = { nome: key, qtd: 0, custoTotal: 0 }
    map[key].qtd += row.qtd
    map[key].custoTotal += row.totalLinha
  }
  return Object.values(map).sort((a, b) => b.custoTotal - a.custoTotal)
}

export function marginFromVendaItem(it, vendaDate, index, produtos) {
  const qtd = +it.qtd || 0
  const preco = +it.preco_unitario || 0
  const receita = preco * qtd
  const unitCost = unitCostAtDate(index, it.produto_id, vendaDate)
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
    custo += unitCostAtDate(index, it.produto_id, vendaDate) * qtd
  }
  return { receita, custo, lucro: receita - custo }
}

function resolvePedidoForVenda(v, pedidoMap) {
  if (!pedidoMap) return null
  const m = (v.obs || '').match(PEDIDO_OBS)
  return m ? pedidoMap[m[1].toLowerCase()] : null
}

/** Margem de uma venda — receita alinhada ao total; custo via itens ou pedido vinculado */
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
    custo += unitCostAtDate(index, it.produto_id, pedidoDate) * qtd
  }
  return { receita, custo, lucro: receita - custo }
}
