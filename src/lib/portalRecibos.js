import {
  faturaEmissao,
  faturaPago,
  faturaPeriodoFim,
  faturaVencimento,
} from './barPortal'

/** Pagamentos confirmados elegíveis para emissão de 領収書. */
export function receiptableItems(faturas = [], pagamentos = []) {
  const items = []
  for (const f of faturas) {
    const confirmed = pagamentos.filter(p => p.fatura_id === f.id && p.confirmado)
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
    const confirmedSum = confirmed.reduce((a, p) => a + (+p.valor || 0), 0)
    const pago = faturaPago(f)
    if (pago > confirmedSum + 0.5) {
      items.push({
        key: `f-${f.id}-saldo`,
        valor: pago - confirmedSum,
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
