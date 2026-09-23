import { supabase } from './supabase'

export async function markFaturaPaid(id, { paid, date }) {
  const { data: f, error } = await supabase
    .from('faturas')
    .select('id,total,valor,pago,status')
    .eq('id', id)
    .single()
  if (error) throw error
  const total = +f.total || +f.valor || 0
  if (paid) {
    const remaining = Math.max(0, total - (+f.pago || 0))
    if (remaining > 0) {
      const { error: payErr } = await supabase.from('fatura_pagamentos').insert({
        fatura_id: id,
        valor: remaining,
        metodo: 'Manual',
        data: date,
        confirmado: true,
        confirmado_em: new Date().toISOString(),
      })
      if (payErr) {
        /* fatura still marked paid even if history row fails */
      }
    }
    const { error: upd } = await supabase.from('faturas').update({ pago: total, status: 'pago' }).eq('id', id)
    if (upd) throw upd
    return
  }
  const { error: upd } = await supabase.from('faturas').update({ pago: 0, status: 'pendente' }).eq('id', id)
  if (upd) throw upd
}

export async function markCompraPaid(id, { paid, date }) {
  const { error } = await supabase.from('compras').update({
    status_pagamento: paid ? 'pago' : 'pendente',
    data_pagamento: paid ? (date || null) : null,
  }).eq('id', id)
  if (error) throw error
}

export async function savePaidMark(item, { paid, date }) {
  if (!item?.id || !item.type) throw new Error('Missing item')
  if (item.type === 'fatura') return markFaturaPaid(item.id, { paid, date })
  if (item.type === 'compra') return markCompraPaid(item.id, { paid, date })
  throw new Error('Unknown type')
}
