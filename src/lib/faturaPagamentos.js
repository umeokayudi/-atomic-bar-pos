import { isDirectMethod } from './money.js'

/** Pagamento online (Stripe etc.) em análise enquanto confirmado=false */
export function pagamentoEmAnalise(p) {
  return /stripe|cart/i.test(p?.metodo || '')
}

/** Rótulo de status para pagamentos de fatura (confirmado vs em análise vs pago direto ao fornecedor). */
export function pagamentoStatus(p) {
  if (isDirectMethod(p?.metodo)) return { label: 'Paid to supplier by the bar', tone: 'navy' }
  if (p?.confirmado) return { label: 'Confirmed', tone: 'green' }
  if (pagamentoEmAnalise(p)) return { label: 'Under review', tone: 'amber' }
  return { label: 'Waiting for confirmation', tone: 'amber' }
}

export function pagamentosPendentes(pagamentos, faturaId) {
  return (pagamentos || []).filter(p => p.fatura_id === faturaId && !p.confirmado)
}

export function totalPagamentosPendentes(pagamentos, faturaId) {
  return pagamentosPendentes(pagamentos, faturaId).reduce((a, p) => a + (+p.valor || 0), 0)
}
