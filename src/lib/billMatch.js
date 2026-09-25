/** Compare JBM orders, arrived values, and the invoice for the same dates. */

import { faturaValor } from './barPortal.js'
import { lastDayOfMonth } from './tokyo.js'

const TOL = 1

function day(value) {
  return String(value || '').slice(0, 10)
}

function inRange(value, start, end) {
  const d = day(value)
  if (!d || d.length < 10) return false
  if (start && d < start) return false
  if (end && d > end) return false
  return true
}

function monthEnd(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number)
  const dim = lastDayOfMonth(y, m) || 30
  return `${monthKey}-${String(dim).padStart(2, '0')}`
}

export function orderValue(order) {
  const lines = order?.pedidos_itens || []
  const fromLines = lines.reduce((sum, it) => sum + (+it.qtd || 0) * (+it.preco_unitario || 0), 0)
  if (fromLines > 0) return Math.round(fromLines)
  return Math.round(+order?.total_estimado || +order?.total || 0)
}

function close(a, b) {
  return Math.abs(Math.round(a) - Math.round(b)) <= TOL
}

export function matchBill({ orders = [], notes = [], invoice = null, start = '', end = '' } = {}) {
  const live = (orders || []).filter(p => p && p.status !== 'cancelado' && inRange(p.data_pedido || p.criado_em, start, end))
  const arrived = (notes || []).filter(n => inRange(n.data || n.data_venda, start, end))
  const orderTotal = live.reduce((sum, p) => sum + orderValue(p), 0)
  const noteTotal = arrived.reduce((sum, n) => sum + Math.round(+n.total || 0), 0)
  const invoiceTotal = invoice ? Math.round(faturaValor(invoice)) : null
  const pairs = []
  if (orderTotal > 0 && noteTotal > 0) pairs.push(['orders', 'notes', orderTotal, noteTotal])
  if (orderTotal > 0 && invoiceTotal != null) pairs.push(['orders', 'invoice', orderTotal, invoiceTotal])
  if (noteTotal > 0 && invoiceTotal != null) pairs.push(['notes', 'invoice', noteTotal, invoiceTotal])
  const gaps = pairs.filter(([, , a, b]) => !close(a, b)).map(([left, right, a, b]) => ({
    left, right, a, b, delta: Math.round(b - a),
  }))
  let status = 'empty'
  if (!orderTotal && !noteTotal && invoiceTotal == null) status = 'empty'
  else if (!pairs.length) status = 'waiting'
  else if (!gaps.length) status = 'match'
  else status = 'off'
  const delta = gaps.reduce((best, g) => (Math.abs(g.delta) > Math.abs(best) ? g.delta : best), 0)
  return {
    status,
    orders: orderTotal,
    notes: noteTotal,
    invoice: invoiceTotal,
    orderCount: live.length,
    noteCount: arrived.length,
    delta,
    gaps,
    start,
    end,
    invoiceId: invoice?.id || null,
  }
}

export function billChecks({ orders = [], notes = [], invoices = [], monthKey = '' } = {}) {
  const open = (invoices || []).filter(f => f && f.status !== 'pago')
  const targets = open.length ? open : (invoices || []).slice(0, 1)
  const rows = targets.length
    ? targets.map(f => matchBill({
      orders,
      notes,
      invoice: f,
      start: day(f.periodo_inicio || f.data_emissao) || (monthKey ? `${monthKey}-01` : ''),
      end: day(f.periodo_fim || f.data_vencimento) || (monthKey ? monthEnd(monthKey) : ''),
    }))
    : [matchBill({
      orders,
      notes,
      invoice: null,
      start: monthKey ? `${monthKey}-01` : '',
      end: monthKey ? monthEnd(monthKey) : '',
    })]
  const headline = rows.find(r => r.status === 'off') || rows[0]
  return { rows, headline }
}
