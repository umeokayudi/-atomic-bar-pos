import {
  faturaEmissao,
  faturaPago,
  faturaPeriodoFim,
  faturaVencimento,
} from './barPortal.js'
import { invoiceMoney, paymentKind } from './money.js'

/** Pagamentos confirmados elegíveis para emissão de 領収書. */
export function receiptableItems(faturas = [], pagamentos = []) {
  const items = []
  for (const f of faturas) {
    // A payment the bar made straight to a supplier is not money JBM received: no JBM receipt for it.
    const confirmed = pagamentos.filter(p => p.fatura_id === f.id && paymentKind(p) === 'received')
    for (const p of confirmed) {
      items.push({
        key: `p-${p.id}`,
        valor: +p.valor || 0,
        data: p.data,
        metodo: p.metodo,
        notas: p.notas,
        fatura: f,
      })
    }
    // Older balance with no payment row (paid before the log existed), minus known direct payments.
    const older = invoiceMoney(f, pagamentos).unrecorded
    void faturaPago
    if (older > 0.5) {
      items.push({
        key: `f-${f.id}-saldo`,
        valor: older,
        data: f.data_pagamento || faturaEmissao(f) || faturaVencimento(f),
        metodo: 'Pagamento confirmado',
        notas: f.obs || '',
        fatura: f,
      })
    }
  }
  return items
    .filter(i => i.valor > 0)
    .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')))
}
