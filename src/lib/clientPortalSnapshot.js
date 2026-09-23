import { getGlobalLang } from './i18n'
import { filterSupplierVendas } from '../components/utils'
import { filterJbmDrinksFaturas, faturaPago, faturaRemaining, faturaValor } from './barPortal'
import {
  analyzePurchases,
  buildPricingMap,
  monthlyAccountSummary,
  monthlySpendSeries,
} from './clientAnalytics'

export async function fetchClientPortalSnapshot(supabase, bar) {
  const [vR, pedR, iR, bpR, fR, estR] = await Promise.all([
    supabase.from('vendas').select('*').eq('bar_id', bar.id).order('data', { ascending: false }).limit(400),
    supabase.from('pedidos').select('*').eq('bar_id', bar.id).order('criado_em', { ascending: false }).limit(80),
    supabase.from('vendas_itens').select('*, produtos(nome,categoria,preco_venda,volume_ml), vendas(data,bar_id,obs)').eq('vendas.bar_id', bar.id),
    supabase.from('bar_pricing').select('produto_id,drinks_por_garrafa,preco_drink').eq('bar_id', bar.id),
    supabase.from('faturas').select('*').eq('bar_id', bar.id).order('data_vencimento', { ascending: false }).limit(24),
    supabase.from('estoque').select('*, produtos(nome,categoria)').eq('bar_id', bar.id),
  ])

  const vendas = filterSupplierVendas(vR.data || [])
  const pedidos = pedR.data || []
  const itens = (iR.data || []).filter(i => i.vendas && filterSupplierVendas([i.vendas]).length)
  const barPricing = bpR.data || []
  const faturas = filterJbmDrinksFaturas(fR.data || [])
  const estoque = estR.data || []

  const pricingMap = buildPricingMap(barPricing)
  const mes = new Date().toISOString().slice(0, 7)
  const account = monthlyAccountSummary(vendas, faturas, mes)
  const projection = analyzePurchases(itens, pricingMap, { monthKey: mes })
  const { values: monthlySpend } = monthlySpendSeries(vendas, 6)

  const pendingFaturas = faturas.filter(f => f.status !== 'pago')
  const overdue = pendingFaturas.filter(f => {
    const venc = f.data_vencimento || f.periodo_fim
    return venc && new Date(venc) < new Date()
  })

  const topProducts = projection.products.slice(0, 8).map(p => ({
    nome: p.nome,
    qtd: p.qtd,
    jbm: p.jbmTotal,
    pos: p.posTotal,
    marginPct: p.marginPct,
  }))

  const lowStock = (estoque || [])
    .filter(e => (+e.qtd || 0) <= (+e.minimo || 3))
    .slice(0, 10)
    .map(e => ({ nome: e.produtos?.nome || '?', qtd: e.qtd, minimo: e.minimo }))

  return {
    bar: { id: bar.id, nome: bar.nome },
    mes,
    comprasMes: account.contaMes,
    comprasMesAnterior: account.contaPrev,
    crescimentoPct: account.growth,
    entregasMes: account.deliveries,
    faturaPendente: account.faturaPendente,
    faturaPagaMes: account.faturaPaga,
    faturasPendentes: pendingFaturas.length,
    faturasAtraso: overdue.length,
    totalPendente: pendingFaturas.reduce((a, f) => a + faturaRemaining(f), 0),
    projecaoPosMes: projection.posTotal,
    margemMes: projection.margin,
    margemPct: projection.marginPct,
    roiPct: projection.roiPct,
    topProducts,
    pedidosRecentes: pedidos.slice(0, 5).map(p => ({
      status: p.status,
      total: p.total,
      criado: p.criado_em?.slice(0, 10),
    })),
    gastoUltimos6Meses: monthlySpend,
    estoqueBaixo: lowStock,
    faturasResumo: faturas.slice(0, 6).map(f => ({
      status: f.status,
      total: faturaValor(f),
      pago: faturaPago(f),
      vencimento: f.data_vencimento || f.periodo_fim,
    })),
  }
}

export function buildClientChatSystem(snapshot) {
  const s = snapshot || {}
  const yen = n => `¥${Math.round(n || 0).toLocaleString('ja-JP')}`
  const facts = `
CURRENT DATA (${s.mes || 'this month'}):
- JBM purchases this month: ${yen(s.comprasMes)} (${s.entregasMes || 0} deliveries)
- Growth vs last month: ${s.crescimentoPct != null ? s.crescimentoPct + '%' : 'N/A'}
- POS / counter sales (month): ${yen(s.projecaoPosMes)}
- Estimated profit: ${yen(s.margemMes)} (${s.margemPct || 0}%)
- Estimated ROI: ${s.roiPct || 0}%
- Open invoices: ${s.faturasPendentes || 0} (${yen(s.totalPendente)}) — ${s.faturasAtraso || 0} overdue
- Paid this month: ${yen(s.faturaPagaMes)}

Top products (margin): ${JSON.stringify(s.topProducts || [])}
Recent orders: ${JSON.stringify(s.pedidosRecentes || [])}
Low stock: ${JSON.stringify(s.estoqueBaixo || [])}
Recent invoices: ${JSON.stringify(s.faturasResumo || [])}
Spend last 6 months: ${JSON.stringify(s.gastoUltimos6Meses || [])}

Scope: beverage purchases, orders, deliveries, JBM invoices, POS prices, margin and bar inventory.
Do not talk about other bars or the holding. If you do not know, say what is missing (e.g. POS prices).`

  if (getGlobalLang() === 'ja') {
    return `あなたはバー「${s.bar?.nome || 'client'}」向け JBM Drinks クライアントポータルのAIです。
日本語で、短く分かりやすく答えてください。下のデータを根拠にし、数字を捏造しないでください。
${facts}`
  }

  return `You are the JBM Drinks client-portal AI for the bar "${s.bar?.nome || 'client'}".
Answer in clear English. Use the data below as the source of truth — do not invent numbers.
${facts}`
}
