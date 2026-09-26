const PEDIDO_OBS = /^Auto: order ([a-f0-9]{8})/i

function pedidoSaleDate(p) {
  return p.data_entrega_prevista || p.data_pedido || p.criado_em?.slice(0, 10)
}

/** Corrige vendas Auto: order → data = data_pedido do pedido */
export async function fixVendaDatesFromPedidos(sb, opts = {}) {
  const { barId } = opts
  let vQuery = sb.from('vendas').select('id, bar_id, data, obs, total').ilike('obs', 'Auto: order %')
  if (barId) vQuery = vQuery.eq('bar_id', barId)
  const { data: vendas, error } = await vQuery
  if (error) throw new Error(error.message)

  const { data: pedidos } = await sb.from('pedidos').select('id, data_pedido, data_entrega_prevista, criado_em')
  const prefixMap = Object.fromEntries((pedidos || []).map(p => [p.id.slice(0, 8), p]))

  const report = { updated: 0, unchanged: 0, unmatched: 0, ids: [] }

  for (const v of vendas || []) {
    const m = (v.obs || '').match(PEDIDO_OBS)
    const prefix = m?.[1]
    const pedido = prefix ? prefixMap[prefix] : null
    if (!pedido) {
      report.unmatched++
      continue
    }
    const correctDate = pedidoSaleDate(pedido)
    if (!correctDate || v.data === correctDate) {
      report.unchanged++
      continue
    }
    const { error: uErr } = await sb.from('vendas').update({ data: correctDate, data_venda: correctDate }).eq('id', v.id)
    if (uErr) throw new Error(uErr.message)
    report.updated++
    report.ids.push({ vendaId: v.id, from: v.data, to: correctDate, pedidoId: pedido.id })
  }

  return report
}

/** Remove vendas duplicadas do mesmo pedido (mantém a mais antiga) */
export async function dedupePedidoVendas(sb, opts = {}) {
  const { barId, dryRun = false } = opts
  let vQuery = sb.from('vendas').select('id, bar_id, data, obs, total, criado_em').ilike('obs', 'Auto: order %')
  if (barId) vQuery = vQuery.eq('bar_id', barId)
  const { data: vendas, error } = await vQuery.order('data')
  if (error) throw new Error(error.message)

  const groups = {}
  for (const v of vendas || []) {
    const m = (v.obs || '').match(PEDIDO_OBS)
    const key = m?.[1] || v.obs
    if (!groups[key]) groups[key] = []
    groups[key].push(v)
  }

  const report = { groups: 0, removed: 0, kept: 0, removedTotal: 0, ids: [] }

  for (const [key, list] of Object.entries(groups)) {
    if (list.length <= 1) continue
    report.groups++
    list.sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.criado_em || '').localeCompare(b.criado_em || ''))
    const [keep, ...dupes] = list
    report.kept++

    for (const d of dupes) {
      report.removed++
      report.removedTotal += +d.total || 0
      report.ids.push({ removed: d.id, kept: keep.id, obs: d.obs, total: d.total })
      if (!dryRun) {
        await sb.from('vendas_itens').delete().eq('venda_id', d.id)
        await sb.from('vendas').delete().eq('id', d.id)
      }
    }
  }

  return report
}

/** Cria vendas para pedidos entregues que ainda não têm venda vinculada */
export async function syncMissingVendasFromPedidos(sb, opts = {}) {
  const { barId } = opts
  let pQuery = sb.from('pedidos')
    .select('id, bar_id, criado_por, data_pedido, data_entrega_prevista, criado_em, total_estimado, status, pedidos_itens(produto_id, qtd, preco_unitario)')
    .eq('status', 'entregue')
    .order('data_pedido')

  if (barId) pQuery = pQuery.eq('bar_id', barId)

  const { data: pedidos, error } = await pQuery
  if (error) throw new Error(error.message)

  const report = { checked: 0, created: 0, skipped: 0, errors: [], ids: [] }

  for (const p of pedidos || []) {
    report.checked++
    const key = p.id.slice(0, 8)
    const { data: existing } = await sb.from('vendas')
      .select('id')
      .eq('bar_id', p.bar_id)
      .ilike('obs', `%${key}%`)
      .limit(1)

    if ((existing || []).length) {
      report.skipped++
      continue
    }

    const saleDate = p.data_pedido || p.data_entrega_prevista || p.criado_em?.slice(0, 10)
    const total = +p.total_estimado
      || (p.pedidos_itens || []).reduce((a, it) => a + (+it.preco_unitario || 0) * (+it.qtd || 0), 0)

    const { data: venda, error: vErr } = await sb.from('vendas').insert({
      data: saleDate,
      bar_id: p.bar_id,
      total,
      obs: `Auto: order ${key}`,
      criado_por: p.criado_por,
    }).select().single()

    if (vErr) {
      report.errors.push({ pedidoId: p.id, error: vErr.message })
      continue
    }

    const itens = (p.pedidos_itens || []).filter(it => it.produto_id)
    if (venda && itens.length) {
      const { data: vi } = await sb.from('vendas_itens').select('produto_id').eq('venda_id', venda.id)
      const have = new Set((vi || []).map(r => r.produto_id))
      const missing = itens.filter(it => !have.has(it.produto_id))
      if (missing.length) {
        await sb.from('vendas_itens').insert(
          missing.map(it => ({
            venda_id: venda.id,
            produto_id: it.produto_id,
            qtd: it.qtd,
            preco_unitario: it.preco_unitario,
          }))
        )
      }
    }

    report.created++
    report.ids.push({ pedidoId: p.id, vendaId: venda.id, data: saleDate, total })
  }

  return report
}

/** Preenche vendas_itens em vendas Auto: order que ficaram só com total */
export async function backfillVendaItensFromPedidos(sb, opts = {}) {
  const { barId } = opts
  let pQuery = sb.from('pedidos')
    .select('id, bar_id, pedidos_itens(produto_id, qtd, preco_unitario)')
    .eq('status', 'entregue')

  if (barId) pQuery = pQuery.eq('bar_id', barId)

  const { data: pedidos, error } = await pQuery
  if (error) throw new Error(error.message)

  const report = { checked: 0, filled: 0, skipped: 0, errors: [] }

  for (const p of pedidos || []) {
    report.checked++
    const key = p.id.slice(0, 8)
    const { data: vendas } = await sb.from('vendas')
      .select('id')
      .eq('bar_id', p.bar_id)
      .ilike('obs', `%${key}%`)
      .limit(1)

    const venda = vendas?.[0]
    if (!venda) {
      report.skipped++
      continue
    }

    const itens = (p.pedidos_itens || []).filter(it => it.produto_id)
    if (!itens.length) {
      report.skipped++
      continue
    }

    const { data: vi } = await sb.from('vendas_itens').select('produto_id').eq('venda_id', venda.id)
    const have = new Set((vi || []).map(r => r.produto_id))
    const missing = itens.filter(it => !have.has(it.produto_id))
    if (!missing.length) {
      report.skipped++
      continue
    }

    const { error: iErr } = await sb.from('vendas_itens').insert(
      missing.map(it => ({
        venda_id: venda.id,
        produto_id: it.produto_id,
        qtd: it.qtd,
        preco_unitario: it.preco_unitario,
      }))
    )

    if (iErr) {
      report.errors.push({ pedidoId: p.id, vendaId: venda.id, error: iErr.message })
      continue
    }

    report.filled++
  }

  return report
}

/** Ajusta data de compras 請求書 para o período da fatura (não data de registro) */
export async function fixSeikyushoCompraDates(sb, opts = {}) {
  const { targetDate = '2026-07-15' } = opts
  const { data: compras, error } = await sb.from('compras')
    .select('id, data, obs, criado_em')
    .ilike('obs', 'Seikyusho%')
    .order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)

  const report = { checked: 0, updated: 0, itensMatched: 0, itensUnmatched: 0, ids: [] }
  const { data: prods } = await sb.from('produtos').select('id,nome').eq('ativo', true)

  for (const c of compras || []) {
    report.checked++
    if (c.data !== targetDate) {
      const { error: uErr } = await sb.from('compras').update({ data: targetDate }).eq('id', c.id)
      if (uErr) throw new Error(uErr.message)
      report.updated++
      report.ids.push({ compraId: c.id, from: c.data, to: targetDate })
    }

    const { data: itens } = await sb.from('compras_itens').select('id, nome').eq('compra_id', c.id)
    for (const it of itens || []) {
      const nome = (it.nome || '').toLowerCase()
      const prod = (prods || []).find(p => {
        const n = (p.nome || '').toLowerCase()
        return n === nome || n.includes(nome) || nome.includes(n)
      })
      if (prod) report.itensMatched++
      else report.itensUnmatched++
    }
  }

  return report
}
