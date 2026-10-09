/** Data contábil = data de entrega requerida, não quando o admin confirmou no sistema */
export function pedidoSaleDate(pedido) {
  return pedido?.data_entrega_prevista
    || pedido?.data_pedido
    || pedido?.criado_em?.slice(0, 10)
    || new Date().toISOString().slice(0, 10)
}

export function pedidoVendaObs(pedidoId) {
  return `Auto: order ${String(pedidoId).slice(0, 8)}`
}

export function pedidoTotal(pedido) {
  const fromItems = (pedido?.pedidos_itens || []).reduce(
    (a, it) => a + (+it.preco_unitario || 0) * (+it.qtd || 0),
    0
  )
  return +pedido?.total_estimado || fromItems || 0
}

export async function findVendaForPedido(supabase, pedidoId) {
  const key = String(pedidoId).slice(0, 8)
  const { data } = await supabase.from('vendas')
    .select('id, data, total, obs')
    .ilike('obs', `%${key}%`)
    .order('data', { ascending: true })
    .limit(1)
  return data?.[0] || null
}

/** Uma query para checar vendas faltantes em vários pedidos */
export async function findVendaKeysForPedidos(supabase, pedidos) {
  const keys = new Set((pedidos || []).map(p => String(p.id).slice(0, 8).toLowerCase()))
  if (!keys.size) return new Set()

  const { data } = await supabase.from('vendas')
    .select('obs')
    .ilike('obs', 'Auto: order%')

  const found = new Set()
  for (const v of data || []) {
    const m = v.obs?.match(/order ([a-f0-9]{8})/i)
    if (m && keys.has(m[1].toLowerCase())) found.add(m[1].toLowerCase())
  }
  return found
}

/** Período de faturamento com base na data da venda (não hoje) */
export function billingPeriodForDate(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`)
  const day = d.getDate()
  const year = d.getFullYear()
  const month = d.getMonth()

  if (day <= 5) {
    return {
      periodStart: new Date(year, month, 1).toISOString().slice(0, 10),
      periodEnd: new Date(year, month, 5).toISOString().slice(0, 10),
      dueDate: new Date(year, month, 20).toISOString().slice(0, 10),
    }
  }
  if (day <= 20) {
    return {
      periodStart: new Date(year, month, 6).toISOString().slice(0, 10),
      periodEnd: new Date(year, month, 20).toISOString().slice(0, 10),
      dueDate: new Date(year, month + 1, 5).toISOString().slice(0, 10),
    }
  }
  return {
    periodStart: new Date(year, month, 21).toISOString().slice(0, 10),
    periodEnd: new Date(year, month + 1, 0).toISOString().slice(0, 10),
    dueDate: new Date(year, month + 1, 20).toISOString().slice(0, 10),
  }
}

export async function createVendaFromPedido(supabase, pedido) {
  const existing = await findVendaForPedido(supabase, pedido.id)
  if (existing) {
    const saleDate = pedidoSaleDate(pedido)
    if (existing.data !== saleDate) {
      await supabase.from('vendas').update({ data: saleDate, data_venda: saleDate }).eq('id', existing.id)
      existing.data = saleDate
    }
    const total = pedidoTotal(pedido)
    if (total && +existing.total !== +total) {
      await supabase.from('vendas').update({ total }).eq('id', existing.id)
      existing.total = total
    }
    await insertVendaItensFromPedido(supabase, existing, pedido)
    return { venda: existing, created: false }
  }

  const saleDate = pedidoSaleDate(pedido)
  const total = pedidoTotal(pedido)
  const payload = {
    data: saleDate,
    data_venda: saleDate,
    bar_id: pedido.bar_id,
    total,
    obs: pedidoVendaObs(pedido.id),
    criado_por: pedido.criado_por,
    origem: 'fornecedor',
  }
  let { data: venda, error } = await supabase.from('vendas').insert(payload).select().single()
  if (error?.message?.includes('origem')) {
    delete payload.origem
    ;({ data: venda, error } = await supabase.from('vendas').insert(payload).select().single())
  }

  if (error) throw new Error(`venda: ${error.message}`)

  await insertVendaItensFromPedido(supabase, venda, pedido)

  return { venda, created: true }
}

async function insertVendaItensFromPedido(supabase, venda, pedido) {
  const itens = (pedido.pedidos_itens || []).filter(it => it.produto_id)
  if (!venda?.id || !itens.length) return

  const { data: existing } = await supabase.from('vendas_itens').select('produto_id').eq('venda_id', venda.id)
  const have = new Set((existing || []).map(r => r.produto_id))
  const missing = itens.filter(it => !have.has(it.produto_id))
  if (!missing.length) return

  const { error: iErr } = await supabase.from('vendas_itens').insert(
    missing.map(it => ({
      venda_id: venda.id,
      produto_id: it.produto_id,
      qtd: it.qtd,
      preco_unitario: it.preco_unitario,
    }))
  )
  if (iErr) throw new Error(`itens da venda: ${iErr.message}`)
}

export async function ensureVendaFromPedido(supabase, pedido) {
  return createVendaFromPedido(supabase, pedido)
}

/** Uma fatura por bar+período — soma entregas em vez de duplicar. */
export async function mergeOrInsertPeriodFatura(supabase, { barId, amount, saleDate, vendaId, notas }) {
  const { periodStart, periodEnd, dueDate } = billingPeriodForDate(saleDate)
  const totalAdd = +amount || 0
  const { data: existing } = await supabase.from('faturas')
    .select('*')
    .eq('bar_id', barId)
    .eq('periodo_inicio', periodStart)
    .eq('periodo_fim', periodEnd)
    .maybeSingle()

  if (existing) {
    const newTotal = (+existing.total || +existing.valor || 0) + totalAdd
    await supabase.from('faturas').update({
      total: newTotal,
      valor: newTotal,
    }).eq('id', existing.id)
    return { fatura: { ...existing, total: newTotal, valor: newTotal }, merged: true, periodStart, periodEnd, dueDate }
  }

  const insert = {
    bar_id: barId,
    periodo_inicio: periodStart,
    periodo_fim: periodEnd,
    vencimento: dueDate,
    data_vencimento: dueDate,
    data_emissao: saleDate,
    total: totalAdd,
    valor: totalAdd,
    pago: 0,
    status: 'pendente',
    notas: notas || 'Auto-generated',
    venda_id: vendaId || null,
  }
  const { data, error } = await supabase.from('faturas').insert(insert).select().single()
  if (error) throw error
  return { fatura: data, merged: false, periodStart, periodEnd, dueDate }
}
