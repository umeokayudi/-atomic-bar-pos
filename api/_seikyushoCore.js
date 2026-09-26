import { geminiGenerate } from './_gemini.js'
import { drinksAdminClient } from './_supabaseAdmin.js'
import { ATOMIC_BAR_ID } from './_atomicJuneFix.js'
import {
  matchBar,
  matchProduct,
  calcItemMargin,
  updateSupplierPrices,
  syncPedidosEntregues,
} from './_deliveryMargin.js'
import { buildPurchaseCostIndex, unitCostAtDate } from './_marginCost.js'

const SEIKYUSHO_SYSTEM = `You read 請求書 (seikyusho) — the SUPPLIER invoice that JBM Drinks pays (purchase cost).
The bar client (e.g. Atomic) already placed orders in the portal; delivery may go straight to the bar.
Write every text field in English.

Return ONLY valid JSON:
{
  "fornecedor": "supplier name",
  "cliente_bar": "Atomic",
  "entrega_direta": true,
  "numero_fatura": "",
  "data": "YYYY-MM-DD",
  "periodo_inicio": "YYYY-MM-DD",
  "periodo_fim": "YYYY-MM-DD",
  "data_vencimento": null,
  "pagamento": "Transfer",
  "subtotal": 0,
  "total": 0,
  "itens_custo": [{"nome": "product", "qtd": 1, "custo_unitario": 0}],
  "observacoes": "",
  "plano": {
    "resumo": "Short English summary of what you understood from the invoice",
    "acoes": ["Clear list of what the system will do when confirmed"],
    "alertas": ["Questions or mismatches, if any"],
    "pergunta": "Ask the user if this is correct to save in the system"
  }
}

Rules:
- itens_custo = what JBM PAID the supplier (JBM cost, not the bar selling price).
- periodo_inicio/fim = the invoice period or the delivery period.
- entrega_direta=true when the goods went to the bar; the client orders already exist in the system.
- Do NOT invent the bar selling price — that comes from the client orders.
- Amounts in yen (integers).
- The USER COMMENT wins over the image when they conflict.
- In plano.acoes, list concrete steps: record the purchase, update supplier prices, mark delivered orders, and so on.
- In plano.pergunta, ask explicitly whether it may be saved in the system.`

function leVinDueDate(compraDate) {
  if (!compraDate) return null
  const d = new Date(String(compraDate).slice(0, 10) + 'T12:00:00')
  d.setMonth(d.getMonth() + 1)
  d.setDate(10)
  return d.toISOString().slice(0, 10)
}

function resolveCompraPayment(extracted, fornecedores) {
  const nome = String(extracted.fornecedor || '').toLowerCase()
  const forn = (fornecedores || []).find(f => String(f.nome || '').toLowerCase() === nome)
  const pagamento = forn?.pagamento || extracted.pagamento || 'Transfer'
  const compraDate = extracted.periodo_inicio || extracted.periodo_fim || extracted.data || new Date().toISOString().slice(0, 10)
  let data_pagamento = extracted.data_vencimento || null
  if (/le vin/i.test(extracted.fornecedor || '') || /dia\s*10/i.test(pagamento)) {
    data_pagamento = leVinDueDate(compraDate)
    return { pagamento: 'Dia 10', data_pagamento, status_pagamento: 'pendente' }
  }
  return {
    pagamento,
    data_pagamento,
    status_pagamento: data_pagamento ? 'pendente' : 'pago',
  }
}

function adminClient() {
  return drinksAdminClient()
}

function extractText(data) {
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    throw new Error(`AI did not return valid JSON: ${cleaned.slice(0, 120)}…`)
  }
}

function buildAnalyzePrompt({ context, comentario, previous }) {
  const parts = []
  if (comentario?.trim()) {
    parts.push(`USER COMMENT (highest priority):\n${comentario.trim()}`)
  }
  if (previous) {
    parts.push(`PREVIOUS READING (adjust it to the correction comment):\n${JSON.stringify(previous, null, 2)}`)
  }
  if (context) {
    parts.push(`Contexto do sistema:\n${context}`)
  }
  parts.push('Read this 請求書 (JBM cost). Build the action plan and ask if it is correct before saving.')
  return parts.join('\n\n')
}

export async function analyzeSeikyusho(body) {
  const { image, context, comentario, previous } = body || {}
  if (!image?.data) throw new Error('image is required')

  const parts = [
    { inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data } },
    { text: buildAnalyzePrompt({ context, comentario, previous }) },
  ]

  const data = await geminiGenerate({
    contents: [{ role: 'user', parts }],
    systemInstruction: { parts: [{ text: SEIKYUSHO_SYSTEM }] },
    generationConfig: { temperature: 0.15, maxOutputTokens: 4096 },
  })

  const parsed = parseJson(extractText(data))
  const { plano, ...extracted } = parsed
  return { extracted, plano: plano || defaultPlano(extracted) }
}

function defaultPlano(extracted) {
  const acoes = ['Registrar compra com custo JBM']
  if (extracted.entrega_direta !== false) {
    acoes.push(`Sincronizar pedidos de ${extracted.cliente_bar || 'Atomic'} como entregues (${extracted.periodo_inicio || extracted.data} – ${extracted.periodo_fim || extracted.data})`)
  }
  acoes.push('Update supplier prices')
  return {
    resumo: `Invoice ${extracted.fornecedor || '?'} — total ${extracted.total || 0} yen`,
    acoes,
    alertas: [],
    pergunta: 'Is this correct? May I save this in the system?',
  }
}

export async function registerSeikyusho(body) {
  const extracted = body.extracted
  if (!extracted?.fornecedor && !extracted?.total) {
    throw new Error('Extracted data is invalid — confirm the reading first')
  }

  const sb = adminClient()
  const userNote = body.comentario?.trim()
  const report = {
    compra: null,
    precosAtualizados: null,
    pedidos: null,
    receita: 0,
    custo: 0,
    lucro: 0,
    margemPct: 0,
  }

  const [{ data: produtos }, { data: bars }, { data: fornecedores }] = await Promise.all([
    sb.from('produtos').select('id,nome,custo,preco_venda,categoria').eq('ativo', true),
    sb.from('bars').select('id,nome'),
    sb.from('fornecedores').select('id,nome'),
  ])

  const prods = produtos || []
  const barList = bars || []
  const obsExtra = [extracted.observacoes, userNote].filter(Boolean).join(' — ')

  const itensCusto = extracted.itens_custo?.length ? extracted.itens_custo : []
  const totalCusto = itensCusto.length
    ? itensCusto.reduce((a, it) => a + (it.qtd || 1) * (it.custo_unitario || 0), 0)
    : (+extracted.total || +extracted.subtotal || 0)

  if (totalCusto > 0) {
    const compraDate = extracted.periodo_inicio || extracted.periodo_fim || extracted.data || new Date().toISOString().slice(0, 10)
    const pay = resolveCompraPayment(extracted, fornecedores)
    const { data: compra, error } = await sb.from('compras').insert({
      data: compraDate,
      fornecedor: extracted.fornecedor || 'Fornecedor',
      pagamento: pay.pagamento,
      subtotal: +extracted.subtotal || totalCusto,
      desconto_pontos: 0,
      total_pago: +extracted.total || totalCusto,
      total_real: totalCusto,
      data_pagamento: pay.data_pagamento,
      status_pagamento: pay.status_pagamento,
      obs: `Seikyusho ${extracted.numero_fatura || ''} — ${obsExtra}`.trim(),
    }).select().single()

    if (error) throw new Error(`compra: ${error.message}`)
    report.compra = compra.id

    if (itensCusto.length) {
      await sb.from('compras_itens').insert(
        itensCusto.map(it => ({
          compra_id: compra.id,
          nome: it.nome,
          qtd: it.qtd || 1,
          custo_unitario: it.custo_unitario || 0,
        }))
      )
    }
    report.custo = totalCusto
  }

  report.precosAtualizados = await updateSupplierPrices(sb, {
    fornecedorNome: extracted.fornecedor,
    itensCusto,
    produtos: prods,
    fornecedores: fornecedores || [],
  })

  const bar = matchBar(extracted.cliente_bar, barList) || barList.find(b => b.id === ATOMIC_BAR_ID)
  const entregaDireta = extracted.entrega_direta !== false

  if (bar && entregaDireta) {
    const dateFrom = extracted.periodo_inicio || extracted.data
    const dateTo = extracted.periodo_fim || extracted.data

    report.pedidos = await syncPedidosEntregues(sb, {
      barId: bar.id,
      dateFrom,
      dateTo,
      prods,
      statusIn: ['pendente', 'confirmado'],
    })

    report.receita = report.pedidos.receita
    report.custo = report.pedidos.custo || report.custo
    report.lucro = report.receita - report.custo
    report.margemPct = report.receita > 0 ? Math.round((report.lucro / report.receita) * 100) : 0
  } else if (extracted.entregas?.length || extracted.itens_venda?.length) {
    const { data: comprasHist } = await sb.from('compras')
      .select('data, compras_itens(nome,qtd,custo_unitario)')
      .order('data')
    const costIndex = buildPurchaseCostIndex(comprasHist || [], prods)

    const entregas = [
      ...(extracted.entregas || []),
      ...(extracted.itens_venda?.length ? [{
        bar_nome: extracted.cliente_bar,
        data: extracted.data,
        itens: extracted.itens_venda,
      }] : []),
    ]

    for (const ent of entregas) {
      const b = matchBar(ent.bar_nome || extracted.cliente_bar, barList)
      if (!b) continue
      const mapped = (ent.itens || []).map(it => ({ prod: matchProduct(it.nome, prods), it })).filter(x => x.prod)
      if (!mapped.length) continue

      let receita = 0
      let custo = 0
      for (const { prod, it } of mapped) {
        const preco = it.preco_unitario || prod.preco_venda || 0
        const saleDate = ent.data || extracted.data
        const custoUnit = unitCostAtDate(costIndex, prod.id, saleDate, prod.custo)
        const m = calcItemMargin(it.qtd, preco, custoUnit)
        receita += m.receita
        custo += m.custo
      }

      const { data: venda, error: vErr } = await sb.from('vendas').insert({
        data: ent.data || extracted.data,
        bar_id: b.id,
        total: receita,
        obs: `Seikyusho ${extracted.numero_fatura || ''} — entrega ${b.nome}`,
      }).select().single()

      if (vErr) throw new Error(`venda: ${vErr.message}`)

      await sb.from('vendas_itens').insert(
        mapped.map(({ prod, it }) => ({
          venda_id: venda.id,
          produto_id: prod.id,
          qtd: it.qtd || 1,
          preco_unitario: it.preco_unitario || prod.preco_venda || 0,
        }))
      )

      report.receita += receita
      report.custo += custo
    }
    report.lucro = report.receita - report.custo
    report.margemPct = report.receita > 0 ? Math.round((report.lucro / report.receita) * 100) : 0
  }

  return report
}

export async function handleSeikyushoRequest(res, body) {
  try {
    const action = body.action || 'analyze'

    if (action === 'analyze') {
      const { extracted, plano } = await analyzeSeikyusho(body)
      return res.status(200).json({ ok: true, extracted, plano })
    }

    if (action === 'register') {
      if (!body.confirmed) {
        return res.status(400).json({ error: 'Confirm the data is correct before saving' })
      }
      const result = await registerSeikyusho(body)
      return res.status(200).json({ ok: true, ...result })
    }

    if (action === 'syncPedidos') {
      const sb = adminClient()
      const sync = await syncPedidosEntregues(sb, {
        barId: body.barId || ATOMIC_BAR_ID,
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
      })
      return res.status(200).json({ ok: true, ...sync })
    }

    return res.status(400).json({ error: 'action must be analyze, register or syncPedidos' })
  } catch (e) {
    console.error('handleSeikyushoRequest', e)
    return res.status(500).json({ error: e.message || 'Erro ao processar 請求書' })
  }
}
