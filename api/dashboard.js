import { requireStaff as checkStaff } from './_requireStaff.js'
import { createStaffUserClient } from './_supabaseAdmin.js'
import { isSupplierVenda } from './_supplierVenda.js'
import {
  monthDashboardStats,
  faturaMonthKeys,
  compraMonthKey,
  saleMonthKey,
  pedidoMonthKey,
  buildDashboardAlertas,
  entregasDetalheForMonth,
} from './_dashboardMonth.js'

function lastMonths(n = 6) {
  const out = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const auth = await checkStaff(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })

    const db = createStaffUserClient(auth.token)
    const chartMonths = lastMonths(6)

    const [{ data: compras, error: comprasErr }, { data: vendasRaw }, { data: faturas }, { data: pedidos }, { count: pedidosPendentes }, { data: fornecedores }, { data: bars }] = await Promise.all([
      db.from('compras').select('data, data_compra, data_pagamento, total_real, total_pago, status_pagamento, fornecedor, pagamento, compras_itens(nome, qtd, custo_unitario)').order('data'),
      db.from('vendas').select('id, bar_id, data, data_venda, total, obs').order('data'),
      db.from('faturas').select('id, total, valor, pago, status, periodo_inicio, periodo_fim, data_emissao, data_vencimento, obs, bar_id, bars(nome)'),
      db.from('pedidos').select('id, bar_id, data_pedido, data_entrega_prevista, criado_em, total_estimado, status, obs'),
      db.from('pedidos').select('id', { count: 'exact', head: true }).eq('status', 'pendente'),
      db.from('fornecedores').select('nome, pagamento'),
      db.from('bars').select('id, nome, cor'),
    ])

    if (comprasErr) throw new Error('compras: ' + comprasErr.message)

    const vendas = (vendasRaw || []).filter(isSupplierVenda)
    const ctx = { vendas, compras, faturas, pedidos, bars: bars || [] }

    const months = [...new Set([
      ...(compras || []).map(compraMonthKey),
      ...(compras || []).flatMap(c => [c.data, c.data_compra].map(d => String(d || '').slice(0, 7))),
      ...vendas.map(saleMonthKey),
      ...(pedidos || []).map(pedidoMonthKey),
      ...faturaMonthKeys(faturas),
    ])].filter(Boolean).sort().reverse()

    const chart = chartMonths.map(m => {
      const s = monthDashboardStats(m, ctx)
      return { month: m, receita: s.receita, faturamento: s.faturamento, compras: s.compras, lucro: s.lucroProjetado }
    })

    const byMonth = {}
    for (const m of [...new Set([...months, ...chartMonths])]) {
      const stats = monthDashboardStats(m, ctx)
      const entregasDetalhe = entregasDetalheForMonth(m, ctx)
      byMonth[m] = {
        ...stats,
        entregasDetalhe,
        vendasCount: entregasDetalhe.length || stats.vendasCount,
      }
    }

    return res.status(200).json({
      months,
      chart,
      byMonth,
      pedidosPendentes: pedidosPendentes || 0,
      alertas: buildDashboardAlertas({ faturas, compras, fornecedores }),
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
