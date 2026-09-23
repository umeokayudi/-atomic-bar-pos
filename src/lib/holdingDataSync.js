/**
 * Snapshot unificado dos dados do sistema para IA JBM Holding.
 */
import { filterSupplierVendas, compraDueDate, isCompraOverdue } from '../components/utils'
import { isSupplierVenda } from './supplierVenda'
import { loadCashflowSnapshot } from './purchaseCashflowAdvisor'
import { loadHoldingLocal, syncHoldingFromCloud, resolveOpportunityCostPct } from './jbmHolding'

function monthKey(d) {
  return String(d || '').slice(0, 7)
}

export async function fetchHoldingSystemSnapshot(supabase, holdingProfile = null) {
  const holding = holdingProfile || await syncHoldingFromCloud().catch(() => loadHoldingLocal())

  const [
    barsR, produtosR, vendasR, comprasR, faturasR, pedidosR,
    fornecedoresR, precosR, pagamentosR, perfisR, barPricingR,
  ] = await Promise.all([
    supabase.from('bars').select('id,nome'),
    supabase.from('produtos').select('id,nome,categoria,preco_venda,custo,ativo').eq('ativo', true),
    supabase.from('vendas').select('id,bar_id,data,total,obs,cast_id').order('data', { ascending: false }).limit(100),
    supabase.from('compras').select('id,data,fornecedor,pagamento,total_real,total_pago,status_pagamento,data_pagamento,foto_url').order('data', { ascending: false }).limit(50),
    supabase.from('faturas').select('id,bar_id,valor,total,pago,status,data_vencimento,periodo_inicio,periodo_fim').order('data_vencimento', { ascending: false }).limit(30),
    supabase.from('pedidos').select('id,bar_id,status,total_estimado,criado_em').order('criado_em', { ascending: false }).limit(20),
    supabase.from('fornecedores').select('nome,pagamento,prazo_entrega_dias,pontos_pct'),
    supabase.from('fornecedor_precos').select('produto_id,preco,fornecedores(nome)').limit(200),
    supabase.from('fatura_pagamentos').select('valor,metodo,data,confirmado').order('criado_em', { ascending: false }).limit(20),
    supabase.from('perfis').select('role,email,bar_id'),
    supabase.from('bar_pricing').select('bar_id,produto_id,drinks_por_garrafa,preco_drink'),
  ])

  const bars = barsR.data || []
  const vendas = filterSupplierVendas(vendasR.data || [])
  const compras = comprasR.data || []
  const faturas = faturasR.data || []
  const cashflow = await loadCashflowSnapshot(supabase).catch(() => ({}))

  const mes = new Date().toISOString().slice(0, 7)
  const vendasMes = vendas.filter(v => v.data?.startsWith(mes))
  const receitaMes = vendasMes.reduce((a, v) => a + (+v.total || 0), 0)
  const comprasMes = compras.filter(c => monthKey(c.data) === mes)
  const custoMes = comprasMes.reduce((a, c) => a + (+c.total_real || +c.total_pago || 0), 0)

  const faturasPendentes = faturas.filter(f => f.status !== 'pago')
  const faturasVencidas = faturasPendentes.filter(f => f.data_vencimento && f.data_vencimento < new Date().toISOString().slice(0, 10))
  const aReceber = faturasPendentes.reduce((a, f) => a + Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0)), 0)

  const comprasPendentes = compras.filter(c => c.status_pagamento === 'pendente')
  const fornMap = Object.fromEntries((fornecedoresR.data || []).map(f => [f.nome, f.pagamento]))
  let aPagarAtrasado = 0
  let aPagarFuturo = 0
  for (const c of comprasPendentes) {
    const amt = +c.total_pago || +c.total_real || 0
    const pag = fornMap[c.fornecedor]
    if (isCompraOverdue(c, pag) || !compraDueDate(c, pag)) aPagarAtrasado += amt
    else aPagarFuturo += amt
  }
  const aPagar = aPagarAtrasado + aPagarFuturo

  const pedidosAtivos = (pedidosR.data || []).filter(p => p.status === 'pendente' || p.status === 'confirmado')

  const atomicBar = bars.find(b => /atomic/i.test(b.nome))
  const bpAtomic = atomicBar
    ? (barPricingR.data || []).filter(b => b.bar_id === atomicBar.id).length
    : 0

  const opportunityCostPct = resolveOpportunityCostPct(holding, {
    capitalTight: (cashflow.projectedCash ?? 0) < (holding.custoOportunidadeBasePct || 500000),
  })

  const checks = []
  checks.push({ ok: bars.length > 0, label: 'Bars cadastrados', detail: `${bars.length}` })
  checks.push({ ok: (produtosR.data || []).length > 0, label: 'Produtos ativos', detail: `${(produtosR.data || []).length}` })
  checks.push({ ok: (vendasR.data || []).filter(v => !isSupplierVenda(v)).length === 0, label: 'Vendas POS separadas', detail: `${(vendasR.data || []).filter(v => !isSupplierVenda(v)).length} POS` })
  checks.push({ ok: faturas.length > 0, label: 'Faturas Atomic', detail: `${faturas.length}` })
  checks.push({ ok: bpAtomic >= 10, label: 'Preços POS Atomic', detail: `${bpAtomic}` })
  checks.push({ ok: aReceber >= 0, label: 'A receber bars', detail: `¥${Math.round(aReceber).toLocaleString('ja-JP')}` })
  checks.push({ ok: (cashflow.netCash ?? 0) > -500000, label: 'Caixa líquido', detail: `¥${Math.round(cashflow.netCash || 0).toLocaleString('ja-JP')}` })

  return {
    geradoEm: new Date().toISOString(),
    holding,
    opportunityCostPct,
    bars: bars.map(b => ({ nome: b.nome, id: b.id })),
    financeiro: {
      receitaMes,
      custoMes,
      lucroMes: receitaMes - custoMes,
      caixaLiquido: cashflow.netCash ?? 0,
      projetado30d: (cashflow.netCash ?? 0) + (cashflow.pendingIn30 ?? 0) - (cashflow.pendingOut30 ?? 0),
      aReceber,
      aPagar,
      aPagarAtrasado,
      aPagarFuturo,
      faturasVencidas: faturasVencidas.length,
      entradas30d: cashflow.pendingIn30 ?? 0,
      saidas30d: cashflow.pendingOut30 ?? 0,
    },
    operacao: {
      entregasMes: vendasMes.length,
      pedidosAtivos: pedidosAtivos.length,
      produtosAtivos: (produtosR.data || []).length,
      fornecedores: (fornecedoresR.data || []).length,
      precosFornecedor: (precosR.data || []).length,
      precosPosAtomic: bpAtomic,
    },
    recentes: {
      vendas: vendas.slice(0, 10).map(v => ({ data: v.data, total: v.total, bar: bars.find(b => b.id === v.bar_id)?.nome })),
      compras: compras.slice(0, 8).map(c => ({ data: c.data, fornecedor: c.fornecedor, total: c.total_real || c.total_pago, pagamento: c.pagamento })),
      faturas: faturas.slice(0, 8).map(f => ({
        status: f.status,
        valor: f.valor || f.total,
        vencimento: f.data_vencimento,
        bar: bars.find(b => b.id === f.bar_id)?.nome,
      })),
      pagamentosCliente: (pagamentosR.data || []).slice(0, 5),
    },
    usuarios: {
      admins: (perfisR.data || []).filter(p => p.role === 'admin').length,
      clientes: (perfisR.data || []).filter(p => p.role === 'cliente').length,
    },
    checks,
    checksOk: checks.filter(c => c.ok).length,
    checksTotal: checks.length,
  }
}

export function buildHoldingFullAuditPrompt(snapshot, userQuestion = '') {
  const s = snapshot || {}
  return {
    system: `Você é o CFO-IA da JBM Holding — grupo que inclui JBM Drinks (fornecedor de bebidas no Japão, cliente Atomic Bar) e outros negócios.

REGRAS:
- Responda SEMPRE em português do Brasil, direto, sem enrolação.
- Use os dados REAIS do snapshot abaixo — não invente números.
- Avalie sustentabilidade: caixa, custo de oportunidade entre negócios, cobranças, pagamentos a fornecedores.
- Diga o que está OK, o que está em risco, e 3 ações prioritárias.
- Se perguntarem sobre compra à vista vs prazo, use custo de oportunidade da holding (não 12% fixo).

ESTRUTURA da resposta:
1. Resumo executivo (2 linhas)
2. Saúde financeira (caixa, a receber, a pagar)
3. Operação JBM Drinks
4. Alocação de capital vs outros negócios da holding
5. Riscos e pendências
6. Ações recomendadas (bullets numerados)`,
    messages: [{
      role: 'user',
      content: `${userQuestion || 'Faça uma checagem completa do sistema JBM Holding e JBM Drinks. Está tudo sustentável? O que precisa de atenção urgente?'}

DADOS DO SISTEMA (snapshot ${s.criadoEm || s.geradoEm || 'agora'}):

JBM HOLDING:
${JSON.stringify(s.holding, null, 2)}

CUSTO OPORTUNIDADE EFETIVO: ${s.opportunityCostPct}%/ano

FINANCEIRO:
${JSON.stringify(s.financeiro, null, 2)}

OPERAÇÃO:
${JSON.stringify(s.operacao, null, 2)}

CHECKS AUTOMÁTICOS (${s.checksOk}/${s.checksTotal} OK):
${(s.checks || []).map(c => `${c.ok ? '✅' : '❌'} ${c.label}: ${c.detail}`).join('\n')}

RECENTES:
Vendas: ${JSON.stringify(s.recentes?.vendas)}
Compras: ${JSON.stringify(s.recentes?.compras)}
Faturas: ${JSON.stringify(s.recentes?.faturas)}

USUÁRIOS: ${JSON.stringify(s.usuarios)}`,
    }],
  }
}

export function buildHoldingChatSystem(snapshot) {
  const s = snapshot || {}
  return `Você é o assistente da JBM Holding com acesso aos dados reais do sistema JBM Drinks.
Responda em português do Brasil. Seja conciso e prático.

Snapshot financeiro:
- Caixa líquido: ¥${s.financeiro?.caixaLiquido ?? 0}
- Projetado 30d: ¥${s.financeiro?.projetado30d ?? 0}
- A receber bars: ¥${s.financeiro?.aReceber ?? 0}
- A pagar fornecedores: ¥${s.financeiro?.aPagar ?? 0} (atrasado ¥${s.financeiro?.aPagarAtrasado ?? 0}, futuro ¥${s.financeiro?.aPagarFuturo ?? 0})
- Receita mês: ¥${s.financeiro?.receitaMes ?? 0}
- Custo compras mês: ¥${s.financeiro?.custoMes ?? 0}

Holding: ${JSON.stringify(s.holding?.negocios?.map(n => ({ nome: n.nome, custoOportunidadePct: n.custoOportunidadePct, prioridade: n.prioridade })))}
Custo oportunidade efetivo: ${s.opportunityCostPct}%/ano
Checks: ${s.checksOk}/${s.checksTotal} OK`
}
