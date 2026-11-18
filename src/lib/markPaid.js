import { supabase } from './supabase'
import { addFaturaPayment, faturaTotal } from './faturaLedger'

/**
 * "Mark invoice paid" = log one confirmed payment for what is still open, through the same ledger as every
 * other payment (so there is always a payment row with a date behind the paid amount; if the row cannot be
 * saved, nothing is marked). Undoing is done payment by payment in the invoice's payment list, never by
 * zeroing the invoice.
 */
export async function markFaturaPaid(id, { paid, date }) {
  if (!paid) throw new Error('To undo, open the invoice payments and remove the payment that was logged by mistake.')
  if (!date) throw new Error('Payment date is required')
  const { data: f, error } = await supabase
    .from('faturas')
    .select('id,total,valor,pago,status')
    .eq('id', id)
    .single()
  if (error) throw error
  const remaining = Math.max(0, faturaTotal(f) - (+f.pago || 0))
  if (remaining <= 0) return
  await addFaturaPayment(supabase, id, { valor: remaining, data: date, metodo: 'Manual', confirmado: true })
}

export async function markCompraPaid(id, { paid, date, metodo }) {
  // Every paid purchase keeps its payment date (and how it was paid).
  if (paid && !date) throw new Error('Payment date is required')
  const patch = {
    status_pagamento: paid ? 'pago' : 'pendente',
    data_pagamento: paid ? date : null,
  }
  if (paid && metodo) patch.metodo_pagamento_real = metodo
  const { error } = await supabase.from('compras').update(patch).eq('id', id)
  if (error) throw error
}

export async function savePaidMark(item, { paid, date, metodo }) {
  if (!item?.id || !item.type) throw new Error('Missing item')
  if (item.type === 'fatura') return markFaturaPaid(item.id, { paid, date })
  if (item.type === 'compra') return markCompraPaid(item.id, { paid, date, metodo })
  throw new Error('Unknown type')
}
