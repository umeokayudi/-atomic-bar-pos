/**
 * Advisor de fluxo de caixa — pagar à vista vs a prazo, com JBM Holding e custo de oportunidade.
 */

import {
  describeForsakenAlternatives,
  resolveOpportunityCostPct,
  opportunityCostPayNow,
} from './jbmHolding'

export const DEFAULTS = {
  costOfCapitalPct: 28,
  cashDiscountPct: 2,
  cardFeePct: 1.8,
  pointsValuePct: 1,
  daysToSell: 21,
  daysToCollectBar: 25,
  minCashBuffer: 500000,
}

const CATEGORY_DAYS = {
  Champagne: 14, Beer: 7, Juice: 10, Soda: 10, Water: 7,
  'Energy Drink': 10, Whisky: 28, 'Japanese Whisky': 35,
  Vodka: 21, Gin: 21, Tequila: 21, Spirits: 21, Shochu: 21, Wine: 21, Others: 21,
}

export function parsePaymentTerms(pagamento = '') {
  const p = String(pagamento).toLowerCase()
  const dayOfMonth = p.match(/dia\s*(\d{1,2})/i) || p.match(/day\s*(\d{1,2})/i) || p.match(/every\s*(\d{1,2})/i)
  if (dayOfMonth) {
    const n = +dayOfMonth[1]
    return { mode: 'deferred', days: 30, paymentDay: n, label: `Dia ${n} do mês` }
  }
  if (/60/.test(p)) return { mode: 'deferred', days: 60, paymentDay: 60, label: 'Fatura 60 dias' }
  if (/30|invoice|fatura/.test(p)) return { mode: 'deferred', days: 30, paymentDay: 30, label: 'Fatura 30 dias' }
  if (/transfer|bank|transferência/.test(p)) return { mode: 'deferred', days: 7, label: 'Transferência (~7d)' }
  if (/card|cartão|credit|debit/.test(p)) return { mode: 'immediate', days: 0, label: 'Cartão (imediato)' }
  if (/cash|dinheiro|à vista|avista/.test(p)) return { mode: 'immediate', days: 0, label: 'À vista' }
  return { mode: 'immediate', days: 0, label: pagamento || 'Imediato' }
}

export function daysToSellForCategory(categoria) {
  return CATEGORY_DAYS[categoria] || DEFAULTS.daysToSell
}

function financingCost(amount, days, annualPct) {
  if (!days || !amount) return 0
  return Math.round(amount * (annualPct / 100) * (days / 365))
}

function pointsBenefit(amount, pointsPct, pointsValuePct) {
  return Math.round(amount * (pointsPct / 100) * (pointsValuePct / 100))
}

export function buildPaymentScenarios({
  amount,
  supplierPayment = 'Cash',
  pointsPct = 0,
  settings = {},
  opportunityCostPct = 28,
  daysCapitalLocked = 0,
}) {
  const s = { ...DEFAULTS, ...settings }
  const oppPct = opportunityCostPct || s.costOfCapitalPct
  const base = +amount || 0
  if (!base) return []

  const terms = parsePaymentTerms(supplierPayment)
  const deferredDays = terms.mode === 'deferred' ? terms.days : 30
  const oppCostNow = opportunityCostPayNow(base, daysCapitalLocked, oppPct)

  const scenarios = [
    {
      id: 'cash_now',
      label: 'Pagar à vista — dinheiro',
      paymentDay: 0,
      grossOut: base,
      cashDiscount: Math.round(base * s.cashDiscountPct / 100),
      opportunityCost: oppCostNow,
      effectiveCost: Math.round(base * (1 - s.cashDiscountPct / 100) + oppCostNow),
      pointsValue: 0,
      financingCost: 0,
      notes: `Desconto ${s.cashDiscountPct}% + custo oportunidade ${oppPct}% (${daysCapitalLocked}d capital preso)`,
    },
    {
      id: 'card_now',
      label: 'Pagar à vista — cartão',
      paymentDay: 0,
      grossOut: base,
      cashDiscount: 0,
      opportunityCost: oppCostNow,
      effectiveCost: Math.round(
        base * (1 + s.cardFeePct / 100)
        - pointsBenefit(base, pointsPct, s.pointsValuePct)
        + oppCostNow * 0.5
      ),
      pointsValue: pointsBenefit(base, pointsPct, s.pointsValuePct),
      financingCost: Math.round(base * s.cardFeePct / 100),
      notes: `Taxa cartão ${s.cardFeePct}% + metade do custo de oportunidade`,
    },
    {
      id: 'terms',
      label: `Pagar a prazo — ${terms.label}`,
      paymentDay: deferredDays,
      grossOut: base,
      cashDiscount: 0,
      opportunityCost: 0,
      effectiveCost: base + financingCost(base, deferredDays, oppPct) - pointsBenefit(base, pointsPct, s.pointsValuePct),
      pointsValue: pointsBenefit(base, pointsPct, s.pointsValuePct),
      financingCost: financingCost(base, deferredDays, oppPct),
      notes: `Custo do dinheiro ${oppPct}%/ano × ${deferredDays}d — libera caixa agora`,
    },
  ]

  if (terms.mode === 'deferred') {
    scenarios.push({
      id: 'supplier_default',
      label: `Padrão do fornecedor — ${supplierPayment}`,
      paymentDay: terms.days,
      grossOut: base,
      opportunityCost: 0,
      effectiveCost: base + financingCost(base, terms.days, oppPct) - pointsBenefit(base, pointsPct, s.pointsValuePct),
      pointsValue: pointsBenefit(base, pointsPct, s.pointsValuePct),
      financingCost: financingCost(base, terms.days, oppPct),
      notes: 'Condição cadastrada no fornecedor',
      isSupplierDefault: true,
    })
  }

  return scenarios.map(sc => ({
    ...sc,
    savingsVsWorst: 0,
    cashPressure: sc.paymentDay === 0 ? 'alta' : sc.paymentDay <= 7 ? 'média' : 'baixa',
  }))
}

export function analyzePurchaseCashflow({
  purchaseAmount,
  supplierPayment = 'Cash',
  deliveryDays = 1,
  pointsPct = 0,
  jbmSellPrice = 0,
  posProjectedRevenue = 0,
  qtd = 1,
  categoria = 'Others',
  cashflow = {},
  settings = {},
  holding = null,
}) {
  const s = { ...DEFAULTS, ...settings }
  const amount = +purchaseAmount || 0
  const sellDays = daysToSellForCategory(categoria)
  const revenue = posProjectedRevenue > 0 ? posProjectedRevenue : (jbmSellPrice > 0 ? jbmSellPrice * qtd : 0)
  const margin = revenue > 0 ? revenue - amount : 0
  const marginPct = revenue > 0 ? Math.round(margin / revenue * 100) : null

  const deliveryDay = deliveryDays
  const revenueDay = deliveryDay + sellDays
  const collectDay = revenueDay + s.daysToCollectBar

  const netCash = cashflow.netCash ?? 0
  const pendingOut30 = cashflow.pendingOut30 ?? 0
  const pendingIn30 = cashflow.pendingIn30 ?? 0
  const projectedCash = netCash + pendingIn30 - pendingOut30
  const capitalTight = projectedCash < s.minCashBuffer

  const opportunityCostPct = resolveOpportunityCostPct(holding, { capitalTight })
  const forsaken = describeForsakenAlternatives(holding, amount)

  const scenarios = buildPaymentScenarios({
    amount,
    supplierPayment,
    pointsPct,
    settings: s,
    opportunityCostPct,
    daysCapitalLocked: collectDay,
  })

  const worst = Math.max(...scenarios.map(x => x.effectiveCost), 1)
  scenarios.forEach(sc => { sc.savingsVsWorst = worst - sc.effectiveCost })

  const payNow = scenarios.find(x => x.id === 'cash_now')
  const payTerms = scenarios.find(x => x.id === 'terms' || x.id === 'supplier_default') || scenarios.find(x => x.paymentDay > 0)
  const best = [...scenarios].sort((a, b) => a.effectiveCost - b.effectiveCost)[0]

  const cashNowAffordable = projectedCash - (payNow?.effectiveCost || amount) >= -s.minCashBuffer
  const recoverBeforePay = payTerms ? collectDay <= payTerms.paymentDay : false
  const workingCapitalGap = payTerms ? Math.max(0, payTerms.paymentDay - collectDay) : 0

  let verdict = 'neutral'
  let headline = ''
  const reasons = []

  if (!amount) {
    return {
      verdict: 'incomplete',
      headline: 'Informe o valor da compra para analisar',
      scenarios: [],
      reasons: [],
      opportunityCostPct,
      forsaken,
      holding,
    }
  }

  reasons.push(`Custo de oportunidade JBM Holding: ${opportunityCostPct}%/ano (não é só 12% — inclui outros negócios)`)

  if (payNow?.opportunityCost > 0) {
    reasons.push(
      `Pagar à vista prende ¥${Math.round(amount).toLocaleString('ja-JP')} por ~${collectDay} dias até cobrar o bar → custo oportunidade +${fmt(payNow.opportunityCost)}`
    )
  }

  forsaken.slice(0, 2).forEach(f => reasons.push(f.mensagem))

  if (holding?.regraCapital) {
    reasons.push(holding.regraCapital)
  }

  if (payNow && payTerms) {
    const savingNow = payTerms.effectiveCost - payNow.effectiveCost
    if (payNow.opportunityCost > savingNow + 500 && payTerms.paymentDay > 0) {
      verdict = 'pay_later'
      headline = `A prazo — custo de oportunidade maior que o desconto à vista`
      reasons.push(`À vista economiza ${fmt(savingNow)} no preço, mas oportunidade custa ${fmt(payNow.opportunityCost)}`)
    } else if (!cashNowAffordable && payTerms.paymentDay > 0) {
      verdict = 'pay_later'
      headline = `A prazo — protege o caixa da holding`
      reasons.push(`Caixa projetado 30d: ${fmt(projectedCash)} — pagar agora aperta a operação`)
    } else if (recoverBeforePay && margin > 0) {
      verdict = 'pay_later'
      headline = `A prazo — você cobra o bar antes de pagar o fornecedor`
      reasons.push(`Cobrança do bar ~dia ${collectDay} vs vencimento fornecedor dia ${payTerms.paymentDay}`)
    } else if (workingCapitalGap > 0) {
      verdict = 'caution'
      headline = `Atenção: ${workingCapitalGap} dias pagando antes de receber`
      reasons.push(`Precisa de capital de giro de ${fmt(amount)} por ${workingCapitalGap} dias`)
    } else if (savingNow > 1000 && cashNowAffordable && payNow.opportunityCost < savingNow) {
      verdict = 'pay_now'
      headline = `À vista — desconto supera custo de oportunidade`
    } else if (savingNow <= 0) {
      verdict = 'pay_later'
      headline = `A prazo — sem vantagem em pagar cedo`
    } else {
      verdict = capitalTight ? 'pay_later' : 'pay_now'
      headline = capitalTight ? `A prazo — holding com capital apertado` : `À vista — menor custo efetivo`
    }
  }

  if (marginPct !== null && marginPct < 30) {
    reasons.push(`Margem de revenda baixa (${marginPct}%) — preserve caixa para a holding`)
  }
  if (revenue > 0) {
    reasons.push(`Revenda projetada ${fmt(revenue)} → margem ${fmt(margin)}`)
  }

  return {
    verdict,
    headline,
    reasons,
    bestScenario: best,
    scenarios: scenarios.sort((a, b) => a.effectiveCost - b.effectiveCost),
    timeline: { deliveryDay, revenueDay, collectDay, recoverBeforePay, workingCapitalGap },
    cashflow: { netCash, projectedCash, cashNowAffordable, minBuffer: s.minCashBuffer, capitalTight },
    margin: { revenue, margin, marginPct },
    settings: s,
    opportunityCostPct,
    forsaken,
    holding,
  }
}

function fmt(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

export function buildAIAdvisorPrompt(analysis, context = {}) {
  const holding = context.holding || {}
  const negocios = (holding.negocios || [])
    .map(n => `- ${n.nome} (${n.tipo}): custo oportunidade ${n.custoOportunidadePct}%/ano, prioridade ${n.prioridade}. ${n.notas || ''}`)
    .join('\n')

  return {
    system: `Você é o advisor financeiro da JBM Holding (grupo que inclui JBM Drinks e outros negócios).
Responda SEMPRE em português do Brasil, direto e sem enrolação — o usuário está cansado de texto em inglês.
Explique se vale pagar à vista ou a prazo considerando:
- Custo de oportunidade REAL (muito acima de 12% quando capital poderia ir para contratar gente em outro negócio)
- Fluxo de caixa sustentável da holding
- Prazo para vender no bar e cobrar o Atomic
- Regra de alocação de capital entre negócios
2-3 parágrafos + recomendação final em bullet. Sem headers markdown.`,
    messages: [{
      role: 'user',
      content: `Decisão de compra JBM Drinks (dentro da JBM Holding):

FORNECEDOR: ${context.supplierName || '?'}
PRODUTO: ${context.productName || '?'} (${context.categoria || '?'})
VALOR: ¥${context.purchaseAmount || 0}
PAGAMENTO FORNECEDOR: ${context.supplierPayment || '?'}
ENTREGA: ${context.deliveryDays ?? 1} dias | Pontos: ${context.pointsPct ?? 0}%

JBM HOLDING — perfil sincronizado:
Nome: ${holding.nome || 'JBM Holding'}
Custo oportunidade efetivo: ${analysis.opportunityCostPct}%/ano
Regra de capital: ${holding.regraCapital || '—'}
Negócios:
${negocios || '—'}

O que deixa de fazer se pagar à vista em bebidas:
${(analysis.forsaken || []).map(f => f.mensagem).join('\n') || '—'}

REVENDA AO BAR: ¥${analysis.margin?.revenue || 0} (margem ${analysis.margin?.marginPct ?? '?'}%)
LINHA DO TEMPO: entrega dia ${analysis.timeline.deliveryDay}, venda dia ${analysis.timeline.revenueDay}, cobrança bar dia ${analysis.timeline.collectDay}

CAIXA: líquido ¥${analysis.cashflow.netCash}, projetado 30d ¥${analysis.cashflow.projectedCash}
Capital apertado: ${analysis.cashflow.capitalTight ? 'SIM' : 'NÃO'}
Cobre antes de pagar fornecedor: ${analysis.timeline.recoverBeforePay ? 'SIM' : 'NÃO'}
Gap capital de giro: ${analysis.timeline.workingCapitalGap} dias

CENÁRIOS (custo efetivo):
${analysis.scenarios.map(s => `- ${s.label}: ${fmt(s.effectiveCost)} (paga dia ${s.paymentDay})${s.opportunityCost ? ` [oportunidade +${fmt(s.opportunityCost)}]` : ''}`).join('\n')}

Veredito sistema: ${analysis.verdict} — ${analysis.headline}

Pagar à vista ou a prazo para operação SUSTENTÁVEL da holding?`,
    }],
  }
}

export async function loadCashflowSnapshot(supabase) {
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(); in30.setDate(in30.getDate() + 30)
  const end30 = in30.toISOString().slice(0, 10)

  const [fR, cR] = await Promise.all([
    supabase.from('faturas').select('valor,total,pago,status,data_vencimento'),
    supabase.from('compras').select('total_pago,total_real,status_pagamento,data,data_pagamento'),
  ])

  const faturas = fR.data || []
  const compras = cR.data || []

  const paidIn = faturas.filter(f => f.status === 'pago').reduce((a, f) => a + (+f.valor || +f.total || 0), 0)
  const paidOut = compras
    .filter(c => c.status_pagamento === 'pago' || !c.status_pagamento)
    .reduce((a, c) => a + (+c.total_real || +c.total_pago || 0), 0)

  const pendingIn30 = faturas
    .filter(f => f.status !== 'pago' && f.data_vencimento >= today && f.data_vencimento <= end30)
    .reduce((a, f) => a + Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0)), 0)

  const pendingOut30 = compras
    .filter(c => c.status_pagamento === 'pendente')
    .filter(c => {
      const d = c.data_pagamento || c.data
      return d >= today && d <= end30
    })
    .reduce((a, c) => a + (+c.total_pago || +c.total_real || 0), 0)

  return { netCash: paidIn - paidOut, pendingIn30, pendingOut30, paidIn, paidOut }
}
