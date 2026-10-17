/**
 * Payment log for bar invoices (faturas).
 *
 * `faturas.pago` is the amount already received. Every payment is also a row
 * in `fatura_pagamentos`; rows with confirmado=false (Stripe, or the bar said
 * it paid) do not count until someone confirms them.
 */

export function faturaTotal(f) {
  return +f?.total || +f?.valor || 0
}

export function statusForPaid(total, pago) {
  if (total > 0 && pago >= total) return 'pago'
  if (pago > 0) return 'parcial'
  return 'pendente'
}

export function daysLate(dueDate, today = new Date().toISOString().slice(0, 10)) {
  if (!dueDate || dueDate >= today) return 0
  return Math.round((Date.parse(today) - Date.parse(dueDate)) / 86400000)
}

/** Everything the screens need to show one invoice's balance. */
export function faturaSummary(f, pagamentos = [], today) {
  const total = faturaTotal(f)
  const received = Math.max(0, +f?.pago || 0)
  const own = (pagamentos || []).filter(p => p.fatura_id === f?.id)
  const confirmed = own.filter(p => p.confirmado)
  const waiting = own.filter(p => !p.confirmado)
  const recorded = confirmed.reduce((a, p) => a + (+p.valor || 0), 0)
  const remaining = Math.max(0, total - received)
  return {
    total,
    received,
    remaining,
    // Received before payments were logged one by one (no row explains it).
    unrecorded: Math.max(0, received - recorded),
    underReview: waiting.reduce((a, p) => a + (+p.valor || 0), 0),
    waiting,
    payments: own.slice().sort((a, b) =>
      String(b.data || '').localeCompare(String(a.data || '')) ||
      String(b.criado_em || '').localeCompare(String(a.criado_em || ''))),
    pct: total > 0 ? Math.min(100, Math.round(received / total * 100)) : 0,
    status: statusForPaid(total, received),
    late: remaining > 0 ? daysLate(f?.data_vencimento, today) : 0,
  }
}

async function loadFatura(supabase, id) {
  const { data, error } = await supabase
    .from('faturas')
    .select('id,total,valor,pago,status')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

async function applyDelta(supabase, faturaId, delta, date) {
  const f = await loadFatura(supabase, faturaId)
  const total = faturaTotal(f)
  const pago = Math.max(0, (+f.pago || 0) + delta)
  const status = statusForPaid(total, pago)
  const { error } = await supabase.from('faturas').update({
    pago,
    status,
    data_pagamento: status === 'pago' ? (date || new Date().toISOString().slice(0, 10)) : null,
  }).eq('id', faturaId)
  if (error) throw error
}

/** Log a payment. Confirmed payments lower the balance right away. */
export async function addFaturaPayment(supabase, faturaId, { valor, data, metodo, notas, confirmado = true }) {
  const amount = Math.round(+valor || 0)
  if (amount <= 0) throw new Error('Amount must be more than zero')
  const { error } = await supabase.from('fatura_pagamentos').insert({
    fatura_id: faturaId,
    valor: amount,
    metodo: metodo || 'Transfer',
    data: data || new Date().toISOString().slice(0, 10),
    notas: notas || null,
    confirmado,
    confirmado_em: confirmado ? new Date().toISOString() : null,
  })
  if (error) throw error
  if (confirmado) await applyDelta(supabase, faturaId, amount, data)
}

/** Money of a waiting payment arrived: count it. */
export async function confirmFaturaPayment(supabase, p) {
  if (p.confirmado) return
  const { error } = await supabase.from('fatura_pagamentos')
    .update({ confirmado: true, confirmado_em: new Date().toISOString() })
    .eq('id', p.id)
  if (error) throw error
  await applyDelta(supabase, p.fatura_id, +p.valor || 0, p.data)
}

/** Remove a payment logged by mistake; the balance goes back up. */
export async function removeFaturaPayment(supabase, p) {
  const { error } = await supabase.from('fatura_pagamentos').delete().eq('id', p.id)
  if (error) throw error
  if (p.confirmado) await applyDelta(supabase, p.fatura_id, -(+p.valor || 0), p.data)
}
