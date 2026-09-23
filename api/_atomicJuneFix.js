import { syncPedidosEntregues } from './_deliveryMargin.js'

export const ATOMIC_BAR_ID = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'

const MOVIDO_TAG = /\[movido de jun→jul 2026\]/gi

/** Faturas JBM Drinks → Atomic (bebidas). Limpeza KuriPuro fica no holding separado. */
export const ATOMIC_FATURAS = [
  {
    valor: 465000,
    total: 465000,
    pago: 0,
    data_emissao: '2026-06-30',
    data_vencimento: '2026-07-31',
    periodo_inicio: '2026-06-01',
    periodo_fim: '2026-06-30',
    obs: 'Junho/2026 — bebidas Atomic (cobrança única ¥465.000)',
  },
  {
    valor: 1757044,
    total: 1757044,
    pago: 488350,
    data_emissao: '2026-07-31',
    data_vencimento: '2026-08-31',
    periodo_inicio: '2026-07-01',
    periodo_fim: '2026-07-31',
    obs: 'Julho/2026 — faturamento ¥1.757.044 · LM pago pelo bar ¥488.350',
  },
]

function stripMovidoTag(obs) {
  return (obs || '').replace(MOVIDO_TAG, '').trim() || null
}

/** Converte timestamp jul→jun se necessário; preserva jun original */
function toJuneTimestamp(iso) {
  if (!iso) return null
  if (iso.startsWith('2026-06')) return iso
  if (iso.startsWith('2026-07')) return iso.replace('2026-07-', '2026-06-')
  return iso
}

function toJuneDate(iso) {
  const ts = toJuneTimestamp(iso)
  return ts ? ts.slice(0, 10) : '2026-06-15'
}

/** Reverte pedidos Atomic movidos erroneamente de junho para julho */
export async function revertAtomicPedidosToJune(sb) {
  const { data: pedidos, error } = await sb
    .from('pedidos')
    .select('id,criado_em,data_pedido,data_entrega_prevista,obs,total_estimado')
    .eq('bar_id', ATOMIC_BAR_ID)
    .ilike('obs', '%movido de jun%jul%')

  if (error) throw new Error(error.message)

  const report = { reverted: 0, totalEstimado: 0, ids: [] }

  for (const p of pedidos || []) {
    const juneDate = toJuneDate(p.criado_em || p.data_pedido)
    const juneTs = toJuneTimestamp(p.criado_em) || `${juneDate}T12:00:00+00:00`

    const { error: uErr } = await sb.from('pedidos').update({
      data_pedido: juneDate,
      data_entrega_prevista: juneDate,
      criado_em: juneTs,
      obs: stripMovidoTag(p.obs),
    }).eq('id', p.id)

    if (uErr) throw new Error(`pedido ${p.id}: ${uErr.message}`)
    report.reverted++
    report.totalEstimado += Number(p.total_estimado || 0)
    report.ids.push(p.id)
  }

  return report
}

export async function fixAtomicReceivables(sb) {
  const report = { deletedVendas: 0, faturaIds: [], oldVendasTotal: 0 }

  const { data: vendas, error: vErr } = await sb
    .from('vendas')
    .select('id,total')
    .eq('bar_id', ATOMIC_BAR_ID)
    .gte('data', '2026-06-01')
    .lte('data', '2026-06-30')
  if (vErr) throw new Error(vErr.message)

  const vendaIds = (vendas || []).map(v => v.id)
  report.oldVendasTotal = (vendas || []).reduce((a, v) => a + (+v.total || 0), 0)

  if (vendaIds.length) {
    await sb.from('vendas_itens').delete().in('venda_id', vendaIds)
    await sb.from('vendas').delete().in('id', vendaIds)
    report.deletedVendas = vendaIds.length
  }

  // Pedidos de junho permanecem em junho — não mover para julho

  await sb.from('faturas').delete().eq('bar_id', ATOMIC_BAR_ID).eq('status', 'pendente')

  for (const f of ATOMIC_FATURAS) {
    const pago = f.pago || 0
    const status = pago >= f.total ? 'pago' : pago > 0 ? 'parcial' : 'pendente'
    const { data, error } = await sb.from('faturas').insert({
      bar_id: ATOMIC_BAR_ID,
      pago,
      status,
      ...f,
    }).select('id').single()
    if (error) throw new Error(error.message)
    report.faturaIds.push(data.id)
  }

  report.debt = ATOMIC_FATURAS.reduce((a, f) => a + f.valor, 0)
  return report
}

/** Marca pedidos confirmados como entregue e cria vendas (evita duplicatas) */
export async function markPedidosEntregue(sb, opts = {}) {
  const {
    barId = ATOMIC_BAR_ID,
    dateFrom = '2026-06-01',
    dateTo = '2026-06-30',
    statusFrom = 'confirmado',
  } = opts

  const sync = await syncPedidosEntregues(sb, {
    barId,
    dateFrom,
    dateTo,
    statusIn: [statusFrom],
  })

  return {
    updated: sync.pedidos,
    vendas: sync.vendas,
    skipped: sync.skipped,
    totalEntregue: sync.receita,
    custo: sync.custo,
    lucro: sync.lucro,
    margemPct: sync.margemPct,
    ids: sync.ids,
  }
}

/** @deprecated */
export async function fixAtomicJuneDebt(sb, debt = 465000) {
  return fixAtomicReceivables(sb)
}
