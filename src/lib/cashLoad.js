/**
 * Loads the rows behind the one reconciled cash number (src/lib/money.js reconciledCash) with any Supabase
 * client, so Cash flow, the Holding page, the Holding AI and the server snapshots show the same "Net cash".
 */
import { reconciledCash } from './money.js'

export async function loadReconciledCash(sb, { openingBalance = 0 } = {}) {
  const [f, p, c] = await Promise.all([
    sb.from('faturas').select('id,bar_id,total,valor,pago,notas,periodo_inicio,periodo_fim,data_emissao'),
    sb.from('fatura_pagamentos').select('fatura_id,valor,confirmado,metodo'),
    sb.from('compras').select('fornecedor,total_real,total_pago,status_pagamento,metodo_pagamento_real,pagamento,data,data_compra'),
  ])
  const err = f.error || p.error || c.error
  if (err) throw new Error(err.message)
  return reconciledCash({ faturas: f.data || [], pagamentos: p.data || [], compras: c.data || [], openingBalance })
}
