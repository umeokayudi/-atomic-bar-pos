/** Pure HQ filter helpers. Never writes ledgers. Never mixes the four books. */

export function monthKeyOf(value) {
  const m = String(value || '').match(/(\d{4}-\d{2})/)
  return m ? m[1] : ''
}

export function compactYen(n) {
  const v = Math.round(+n || 0)
  if (v >= 10000000) return `¥${Math.round(v / 1000000)}M`
  if (v >= 1000000) return `¥${(v / 1000000).toFixed(1)}M`
  if (v >= 10000) return `¥${Math.round(v / 1000)}k`
  return `¥${v.toLocaleString('ja-JP')}`
}

export function sumMonth(rows, datePick, amountPick, monthKey) {
  return (rows || [])
    .filter(r => monthKeyOf(datePick(r)) === monthKey)
    .reduce((a, r) => a + (+amountPick(r) || 0), 0)
}

export function countMonth(rows, datePick, monthKey) {
  return (rows || []).filter(r => monthKeyOf(datePick(r)) === monthKey).length
}

/** JBM bill = supplier note date. Orders saved later are not the bill. */
export function explainJbmGap({ noteCount = 0, noteAmount = 0, orderCount = 0, orderAmount = 0, monthKey }) {
  if (noteCount > 0) {
    return { kind: 'notes', noteCount, noteAmount, orderCount, orderAmount, monthKey }
  }
  if (orderCount > 0) {
    return {
      kind: 'orders-other-date',
      noteCount: 0,
      noteAmount: 0,
      orderCount,
      orderAmount,
      monthKey,
    }
  }
  return { kind: 'empty', noteCount: 0, noteAmount: 0, orderCount: 0, orderAmount: 0, monthKey }
}

export function monthChipHint({ pos = 0, jbm = 0, pedidos = 0 }) {
  if (jbm > 0) return { kind: 'jbm', amount: jbm }
  if (pos > 0) return { kind: 'pos', amount: pos }
  if (pedidos > 0) return { kind: 'orders', amount: 0, pedidos }
  return { kind: 'empty', amount: 0 }
}

export function invoiceOverlapsMonth(f, monthKey) {
  if (!monthKey) return false
  const fields = [f?.periodo_inicio, f?.periodo_fim, f?.data_vencimento, f?.data_emissao, f?.vencimento, f?.periodo]
  return fields.some(v => monthKeyOf(v) === monthKey)
}

export function invoiceIsOverdue(f, now = new Date()) {
  const venc = f?.vencimento || f?.data_vencimento || f?.periodo_fim
  return f?.status !== 'pago' && !!venc && new Date(venc) < now
}

export function matchInvoiceStatus(f, status, monthKey, now = new Date()) {
  if (status === 'month') return invoiceOverlapsMonth(f, monthKey)
  if (status === 'pending') return f?.status !== 'pago'
  if (status === 'overdue') return invoiceIsOverdue(f, now)
  return true
}

/** public.estoque does not exist — stock is regras + movimentos. */
export function lowStockFromLedger({ regras = [], movimentos = [], produtos = [] } = {}) {
  const map = {}
  for (const m of movimentos || []) {
    if (!m.produto_id) continue
    map[m.produto_id] = (map[m.produto_id] || 0) + (m.tipo === 'entrada' ? +m.qtd || 0 : -(+m.qtd || 0))
  }
  const names = Object.fromEntries((produtos || []).map(p => [p.id, p.nome]))
  return (regras || [])
    .filter(r => r.produto_id && +r.minimo > 0)
    .map(r => ({
      id: r.produto_id,
      nome: names[r.produto_id] || '',
      qtd: Math.max(0, Math.round((map[r.produto_id] || 0) * 100) / 100),
      minimo: +r.minimo,
    }))
    .filter(p => p.qtd <= p.minimo)
    .sort((a, b) => a.qtd - b.qtd)
}

export function matchHqSearch(row, q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return true
  const hay = [row?.obs, row?.status, row?.note, row?.nome, row?.criado, row?.data, row?.vencimento, String(row?.total || ''), String(row?.amount || '')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(s)
}

export function buildMonthSeries({ keys, vendas, posRows, pedidos, rentRows }) {
  return (keys || []).map(key => {
    const jbmRows = (vendas || []).filter(v => monthKeyOf(v.data || v.data_venda) === key)
    const pos = (posRows || []).filter(s => monthKeyOf(s.data) === key)
    const peds = (pedidos || []).filter(p => monthKeyOf(p.criado_em || p.data_pedido) === key)
    const rent = (rentRows || []).find(r => r.kind === 'rent' && r.month_key === key)
    return {
      key,
      pos: pos.reduce((a, s) => a + (+s.total || 0), 0),
      posCount: pos.length,
      jbm: jbmRows.reduce((a, v) => a + (+v.total || 0), 0),
      jbmCount: jbmRows.length,
      pedidos: peds.length,
      pedidosTotal: peds.reduce((a, p) => a + (+p.total_estimado || +p.total || 0), 0),
      rent: Math.round(+rent?.amount || 0),
    }
  })
}
