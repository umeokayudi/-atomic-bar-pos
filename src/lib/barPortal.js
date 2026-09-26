/** Helpers do portal do bar — faturas JBM Drinks (exclui KuriPuro/limpeza). */

export function faturaText(f) {
  return [f?.obs, f?.notes, f?.descricao, f?.client_name, f?.tipo]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Fatura de limpeza / KuriPuro — não deve aparecer no portal de bebidas. */
export function isKuriPuroFatura(f) {
  const text = faturaText(f)
  if (!text) return false
  if (/kuripuro|kuri\s*puro/.test(text)) return true
  if (/limpeza|cleaning|deep\s*clean/.test(text) && !/fornecimento/.test(text)) return true
  return false
}

export function filterJbmDrinksFaturas(faturas) {
  return (faturas || []).filter(f => !isKuriPuroFatura(f))
}

export function faturaValor(f) {
  return +f?.valor || +f?.total || 0
}

export function faturaPago(f) {
  return +f?.pago || 0
}

export function faturaVencimento(f) {
  return f?.data_vencimento || f?.vencimento || f?.due_date || ''
}

export function faturaEmissao(f) {
  return f?.data_emissao || f?.issue_date || f?.periodo_inicio || ''
}

export function faturaPeriodoFim(f) {
  return f?.periodo_fim || faturaVencimento(f)
}

export function faturaRemaining(f) {
  return Math.max(0, faturaValor(f) - faturaPago(f))
}

/** Aging buckets for JBM AR — never POS till. daysOverdue < 0 is not yet due. */
export function arAging(faturas = [], todayIso = '') {
  const today = String(todayIso || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0 }
  const overdue = []
  for (const f of faturas || []) {
    if (f.status === 'pago') continue
    const remain = faturaRemaining(f)
    if (remain <= 0) continue
    const venc = String(faturaVencimento(f) || '').slice(0, 10)
    const days = venc ? Math.floor((Date.parse(`${today}T12:00:00+09:00`) - Date.parse(`${venc}T12:00:00+09:00`)) / 86400000) : 0
    if (days <= 0) buckets.current += remain
    else if (days <= 30) buckets.d30 += remain
    else if (days <= 60) buckets.d60 += remain
    else buckets.d90 += remain
    if (days > 0) overdue.push({ ...f, daysOverdue: days, remain })
  }
  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue)
  return {
    ...buckets,
    total: buckets.current + buckets.d30 + buckets.d60 + buckets.d90,
    overdue,
  }
}

export function faturaStatusLabel(status) {
  if (status === 'pago') return 'Pago'
  if (status === 'pendente') return 'Pendente'
  return status || 'Pendente'
}
