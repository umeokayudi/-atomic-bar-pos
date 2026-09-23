import { aReceberForMonth, faturamentoForMonth, faturaCoversMonth } from './_faturasMonth.js'

export const JUNE_MONTH = '2026-06'
export const JULY_MONTH = '2026-07'

export function monthKey(d) {
  return String(d || '').slice(0, 7)
}

export function compraMonthKey(c) {
  const d = c?.data_compra || c?.data || ''
  return monthKey(d)
}

/** Compra entra no mês da nota (data/data_compra), não no vencimento do pagamento */
export function compraMatchesMonth(c, selMonth) {
  if (!selMonth || !c) return false
  return [c.data_compra, c.data].some(d => monthKey(d) === selMonth)
}

export function compraTotal(c) {
  const real = +c.total_real || 0
  if (real) return real
  const pago = +c.total_pago || 0
  if (pago) return pago
  return (c.compras_itens || []).reduce((a, it) => a + (+it.qtd || 0) * (+it.custo_unitario || 0), 0)
}

export function saleMonthKey(v) {
  return monthKey(v?.data || v?.data_venda || '')
}

export function pedidoMonthKey(p) {
  return monthKey(p?.data_pedido || p?.data_entrega_prevista || p?.criado_em || '')
}

/** Jun/2026 — faturamento dos pedidos/notas emitidas; custo proporcional à razão compras/faturamento de jul/2026 */
function juneStats({ compras, faturas, faturamentoPedidos, aReceber, pedidos }) {
  const faturamento = faturamentoPedidos || 0
  const julyCompras = (compras || [])
    .filter(c => compraMatchesMonth(c, JULY_MONTH))
    .reduce((a, c) => a + compraTotal(c), 0)
  const julyFat = faturamentoForMonth(faturas, JULY_MONTH)
  const custo = faturamento > 0 && julyFat > 0 && julyCompras > 0
    ? Math.round(faturamento * (julyCompras / julyFat))
    : 0
  const lucroProjetado = faturamento - custo

  return {
    receita: 0,
    faturamento,
    compras: custo,
    lucro: lucroProjetado,
    lucroProjetado,
    margem: faturamento > 0 ? Math.round(lucroProjetado / faturamento * 100) : 0,
    vendasCount: (pedidos || []).filter(p => pedidoMonthKey(p) === JUNE_MONTH && ['entregue', 'confirmado'].includes(p.status)).length,
    comprasCount: (compras || []).filter(c => compraMatchesMonth(c, JULY_MONTH)).length,
    aReceber,
    precoBase: JULY_MONTH,
    comprasEstimadas: true,
  }
}

function pedidosFaturamentoForMonth(pedidos, m) {
  return (pedidos || [])
    .filter(p => pedidoMonthKey(p) === m && ['entregue', 'confirmado'].includes(p.status))
    .reduce((a, p) => a + (+p.total_estimado || 0), 0)
}

/** Regra única: faturamento − notas pagas do mês (Jul e demais meses) */
export function monthDashboardStats(m, { vendas, compras, faturas, pedidos, produtos }) {
  const receita = (vendas || []).filter(v => saleMonthKey(v) === m).reduce((a, v) => a + (+v.total || 0), 0)
  const faturamentoFaturas = faturamentoForMonth(faturas, m)
  const faturamentoPedidos = pedidosFaturamentoForMonth(pedidos, m)
  const aReceber = aReceberForMonth(faturas, m)

  if (m === JUNE_MONTH) {
    return juneStats({ compras, faturas, faturamentoPedidos, aReceber, pedidos })
  }

  const comprasMes = (compras || []).filter(c => compraMatchesMonth(c, m))
  const comprasTotal = comprasMes.reduce((a, c) => a + compraTotal(c), 0)
  const faturamento = faturamentoFaturas || receita || faturamentoPedidos
  const lucroProjetado = faturamento - comprasTotal

  return {
    receita,
    faturamento,
    compras: comprasTotal,
    lucro: receita - comprasTotal,
    lucroProjetado,
    margem: faturamento > 0 ? Math.round(lucroProjetado / faturamento * 100) : 0,
    vendasCount: (vendas || []).filter(v => saleMonthKey(v) === m).length,
    comprasCount: comprasMes.length,
    aReceber,
  }
}

export function faturaMonthKeys(faturas) {
  const keys = []
  for (const f of faturas || []) {
    const start = monthKey(f.periodo_inicio || f.data_emissao)
    const end = monthKey(f.periodo_fim || f.data_vencimento || start)
    if (start) keys.push(start)
    if (end && end !== start) keys.push(end)
  }
  return keys
}

function faturaOutstanding(f) {
  return Math.max(0, (+f.total || +f.valor || 0) - (+f.pago || 0))
}

function compraDueDateServer(c, fornecedorPagamento) {
  const explicit = c?.data_pagamento ? String(c.data_pagamento).slice(0, 10) : ''
  if (explicit) return explicit
  const base = String(c?.data_compra || c?.data || '').slice(0, 10)
  if (!base) return ''
  const pag = String(fornecedorPagamento || c?.pagamento || '')
  const m = pag.match(/dia\s*(\d{1,2})/i) || pag.match(/day\s*(\d{1,2})/i) || pag.match(/(\d{1,2})\s*(?:of|do mês)/i)
  if (!m) return ''
  const day = Math.min(28, Math.max(1, +m[1]))
  const d = new Date(base + 'T12:00:00')
  d.setMonth(d.getMonth() + 1)
  d.setDate(day)
  return d.toISOString().slice(0, 10)
}

function mapVendaEntrega(v, barMap) {
  return {
    id: v.id,
    data: v.data || v.data_venda,
    barNome: barMap[v.bar_id]?.nome || '—',
    barCor: barMap[v.bar_id]?.cor,
    receita: +v.total || 0,
    obs: v.obs || '',
  }
}

function mapPedidoEntrega(p, barMap) {
  return {
    id: p.id,
    data: p.data_entrega_prevista || p.data_pedido || String(p.criado_em || '').slice(0, 10),
    barNome: barMap[p.bar_id]?.nome || '—',
    barCor: barMap[p.bar_id]?.cor,
    receita: +p.total_estimado || 0,
    obs: p.obs || `Pedido · ${p.status || 'entregue'}`,
  }
}

function pedidoInPeriod(p, start, end) {
  const d = (p.data_entrega_prevista || p.data_pedido || String(p.criado_em || '')).slice(0, 10)
  if (!d) return false
  if (start && d < start) return false
  if (end && d > end) return false
  return true
}

function vendaLinkedPedidoKey(v) {
  const m = String(v?.obs || '').match(/order\s+([a-f0-9]{8})/i)
  return m ? m[1] : null
}

/** Entregas do mês — pedidos entregues + vendas no período das faturas */
export function entregasDetalheForMonth(m, { vendas = [], pedidos = [], faturas = [], bars = [] }) {
  const barMap = Object.fromEntries(bars.map(b => [b.id, b]))
  const faturasMes = faturas.filter(f => faturaCoversMonth(f, m))
  const seen = new Set()
  const linkedPedidos = new Set()
  const entregas = []

  function addEntrega(e) {
    const key = e.kind === 'pedido' ? `p:${e.id}` : `v:${e.id}`
    if (!e.id || seen.has(key)) return
    seen.add(key)
    entregas.push(e)
  }

  function collectForPeriod(start, end, barId) {
    for (const p of pedidos) {
      if (!['entregue', 'confirmado'].includes(p.status)) continue
      if (barId && p.bar_id !== barId) continue
      if (!pedidoInPeriod(p, start, end)) continue
      linkedPedidos.add(String(p.id).slice(0, 8))
      addEntrega({ ...mapPedidoEntrega(p, barMap), kind: 'pedido' })
    }
    for (const v of vendas) {
      if (!v.id) continue
      if (barId && v.bar_id !== barId) continue
      const link = vendaLinkedPedidoKey(v)
      if (link && linkedPedidos.has(link)) continue
      const vDate = (v.data || v.data_venda || '').slice(0, 10)
      if (start && vDate < start) continue
      if (end && vDate > end) continue
      addEntrega({ ...mapVendaEntrega(v, barMap), kind: 'venda' })
    }
  }

  if (faturasMes.length > 0) {
    for (const f of faturasMes) {
      const start = (f.periodo_inicio || f.data_emissao || '').slice(0, 10)
      const end = (f.periodo_fim || f.data_vencimento || start).slice(0, 10)
      collectForPeriod(start, end, f.bar_id)
    }
  }

  if (entregas.length === 0) {
    linkedPedidos.clear()
    for (const p of pedidos) {
      if (!['entregue', 'confirmado'].includes(p.status)) continue
      if (pedidoMonthKey(p) !== m) continue
      linkedPedidos.add(String(p.id).slice(0, 8))
      addEntrega({ ...mapPedidoEntrega(p, barMap), kind: 'pedido' })
    }
    for (const v of vendas) {
      const link = vendaLinkedPedidoKey(v)
      if (link && linkedPedidos.has(link)) continue
      if (saleMonthKey(v) !== m) continue
      addEntrega({ ...mapVendaEntrega(v, barMap), kind: 'venda' })
    }
  }

  return entregas
    .map(({ kind, ...row }) => row)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)))
}

/** Faturas e compras vencidas para alertas no dashboard */
export function buildDashboardAlertas({ faturas = [], compras = [], fornecedores = [] }) {
  const today = new Date().toISOString().slice(0, 10)
  const pagMap = Object.fromEntries((fornecedores || []).map(f => [f.nome, f.pagamento]))

  const faturasAtrasadas = (faturas || [])
    .filter(f => f.status !== 'pago' && f.data_vencimento && f.data_vencimento < today && faturaOutstanding(f) > 0)
    .map(f => ({
      id: f.id,
      barNome: f.bars?.nome || 'Bar',
      valor: faturaOutstanding(f),
      vencimento: f.data_vencimento,
    }))
    .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''))

  const comprasAtrasadas = (compras || [])
    .filter(c => c.status_pagamento === 'pendente')
    .map(c => {
      const vencimento = compraDueDateServer(c, pagMap[c.fornecedor])
      const valor = +c.total_real || +c.total_pago || 0
      return { id: c.id, fornecedor: c.fornecedor || 'Fornecedor', valor, vencimento }
    })
    .filter(c => c.vencimento && c.vencimento < today && c.valor > 0)
    .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''))

  return {
    faturasAtrasadas,
    faturasAtrasadasTotal: faturasAtrasadas.reduce((a, f) => a + f.valor, 0),
    comprasAtrasadas,
    comprasAtrasadasTotal: comprasAtrasadas.reduce((a, c) => a + c.valor, 0),
  }
}
