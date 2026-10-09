import { isSupplierVenda } from './_supplierVenda.js'

function compraDueDate(c, fornecedorPagamento) {
  const explicit = c?.data_pagamento ? String(c.data_pagamento).slice(0, 10) : ''
  if (explicit) return explicit
  const base = c?.data ? String(c.data).slice(0, 10) : ''
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

function splitPendingCompras(compras, fornecedores, today) {
  const map = {}
  for (const f of fornecedores || []) map[f.nome] = f.pagamento
  const pending = compras.filter(c => c.status_pagamento === 'pendente')
  let overdueTotal = 0
  let futureTotal = 0
  for (const c of pending) {
    const amount = +c.total_pago || +c.total_real || 0
    const due = compraDueDate(c, map[c.fornecedor])
    if (!due || due < today) overdueTotal += amount
    else futureTotal += amount
  }
  return { overdueTotal, futureTotal, aPagar: overdueTotal + futureTotal }
}

/** Build live cashflow snapshot from Drinks Supabase (service role). */
export async function buildLiveSnapshot(sb) {
  const today = new Date().toISOString().slice(0, 10)
  const mes = today.slice(0, 7)
  const in30 = new Date()
  in30.setDate(in30.getDate() + 30)
  const end30 = in30.toISOString().slice(0, 10)

  const [barsR, vendasR, comprasR, faturasR, fornR] = await Promise.all([
    sb.from('bars').select('id,nome'),
    sb.from('vendas').select('bar_id,data,total,obs,cast_id').order('data', { ascending: false }).limit(100),
    sb.from('compras').select('data,total_real,total_pago,status_pagamento,data_pagamento,fornecedor,pagamento').order('data', { ascending: false }),
    sb.from('faturas').select('bar_id,valor,total,pago,status,data_vencimento').order('data_vencimento', { ascending: false }),
    sb.from('fornecedores').select('nome,pagamento'),
  ])

  const bars = barsR.data || []
  const vendas = (vendasR.data || []).filter(isSupplierVenda)
  const compras = comprasR.data || []
  const faturas = faturasR.data || []

  const receitaMes = vendas.filter(v => v.data?.startsWith(mes)).reduce((a, v) => a + (+v.total || 0), 0)
  const custoMes = compras.filter(c => String(c.data || '').slice(0, 7) === mes).reduce((a, c) => a + (+c.total_real || +c.total_pago || 0), 0)

  const paidIn = faturas.reduce((a, f) => a + (+f.pago || 0), 0)
  const paidOut = compras.filter(c => c.status_pagamento === 'pago').reduce((a, c) => a + (+c.total_real || +c.total_pago || 0), 0)

  const faturasPendentes = faturas.filter(f => f.status !== 'pago')
  const aReceber = faturasPendentes.reduce((a, f) => a + Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0)), 0)
  const faturasVencidas = faturasPendentes.filter(f => f.data_vencimento && f.data_vencimento < today)

  const comprasPendentes = compras.filter(c => c.status_pagamento === 'pendente')
  const { overdueTotal, futureTotal, aPagar } = splitPendingCompras(compras, fornR.data, today)

  const pendingIn30 = faturasPendentes
    .filter(f => f.data_vencimento >= today && f.data_vencimento <= end30)
    .reduce((a, f) => a + Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0)), 0)

  const pendingOut30 = comprasPendentes
    .filter(c => {
      const d = compraDueDate(c, (fornR.data || []).find(f => f.nome === c.fornecedor)?.pagamento)
      return d >= today && d <= end30
    })
    .reduce((a, c) => a + (+c.total_pago || +c.total_real || 0), 0)

  const caixaLiquido = paidIn - paidOut

  return {
    geradoEm: new Date().toISOString(),
    fonte: 'bebidas-control-live',
    financeiro: {
      receitaMes,
      custoMes,
      lucroMes: receitaMes - custoMes,
      caixaLiquido,
      projetado30d: caixaLiquido + pendingIn30 - pendingOut30,
      aReceber,
      aPagar,
      aPagarAtrasado: overdueTotal,
      aPagarFuturo: futureTotal,
      faturasVencidas: faturasVencidas.length,
      entradas30d: pendingIn30,
      saidas30d: pendingOut30,
    },
    recentes: {
      vendas: vendas.slice(0, 5).map(v => ({ data: v.data, total: v.total, bar: bars.find(b => b.id === v.bar_id)?.nome })),
      compras: compras.slice(0, 5).map(c => ({ data: c.data, fornecedor: c.fornecedor, total: c.total_real || c.total_pago })),
      faturas: faturas.slice(0, 5).map(f => ({
        status: f.status,
        valor: f.valor || f.total,
        vencimento: f.data_vencimento,
        bar: bars.find(b => b.id === f.bar_id)?.nome,
      })),
    },
  }
}
