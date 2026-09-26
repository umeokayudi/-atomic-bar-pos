/** Events the bar calendar can open: dues, orders, deliveries, till nights. */

import { faturaPago, faturaPeriodoFim, faturaRemaining, faturaValor, faturaVencimento } from './barPortal.js'

function day(value) {
  return String(value || '').slice(0, 10)
}

export function buildBarCalendarEvents({ invoices = [], orders = [], notes = [], tickets = [] } = {}) {
  const events = []

  for (const f of invoices || []) {
    const date = day(faturaVencimento(f) || faturaPeriodoFim(f))
    if (!date) continue
    const open = faturaRemaining(f)
    const paid = faturaPago(f)
    events.push({
      id: `inv-${f.id}`,
      date,
      kind: 'pagamento',
      dir: 'out',
      label: `${day(f.periodo_inicio)} → ${day(faturaPeriodoFim(f))}`,
      amount: open > 0 ? open : faturaValor(f),
      status: paid > 0 && open > 0 ? 'partial' : (f.status || ''),
      tab: 'faturas',
    })
  }

  for (const p of orders || []) {
    const date = day(p.data_pedido || p.criado_em || p.criado)
    if (!date || p.status === 'cancelado') continue
    events.push({
      id: `ord-${p.id}`,
      date,
      kind: 'pedido',
      label: p.status || 'order',
      amount: Math.round(+p.total_estimado || +p.total || 0),
      status: p.status || '',
      tab: 'pedidos',
    })
  }

  for (const n of notes || []) {
    const date = day(n.data || n.data_venda)
    if (!date) continue
    events.push({
      id: `note-${n.id}`,
      date,
      kind: 'entrega',
      label: 'JBM',
      amount: Math.round(+n.total || 0),
      tab: 'entregas',
    })
  }

  const nights = new Map()
  for (const ticket of tickets || []) {
    const date = day(ticket.data || ticket.criado_em)
    if (!date) continue
    const cur = nights.get(date) || { amount: 0, count: 0 }
    cur.amount += +ticket.total || 0
    cur.count += 1
    nights.set(date, cur)
  }
  for (const [date, cur] of nights) {
    events.push({
      id: `till-${date}`,
      date,
      kind: 'lucro',
      label: `${cur.count}`,
      amount: Math.round(cur.amount),
      tab: 'pos',
    })
  }

  return events
}

export function monthBounds(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number)
  if (!y || !m) return { from: '', to: '' }
  const dim = new Date(y, m, 0).getDate()
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(dim).padStart(2, '0')}` }
}

export function shiftMonth(monthKey, delta) {
  const [y, m] = String(monthKey || '').split('-').map(Number)
  const d = new Date(y, (m || 1) - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Invoice period overlaps the chosen from/to. Empty bounds keep every invoice. */
export function invoiceInRange(f, from, to) {
  const start = day(f?.periodo_inicio || f?.data_emissao || faturaVencimento(f))
  const end = day(faturaPeriodoFim(f) || faturaVencimento(f) || start)
  if (from && end && end < from) return false
  if (to && start && start > to) return false
  return true
}

export function dateInRange(value, from, to) {
  const d = day(value)
  if (!d) return !from && !to
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}
