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
    // An amount marked paid with no confirmed payment row gets NO receipt: it is pending confirmation and
    // waits for the owner's decision in the Central de Conciliação (Missão Máxima 4.3).
    void faturaPago
    void invoiceMoney
  }
  return items
    .filter(i => i.valor > 0)
    .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')))
}
