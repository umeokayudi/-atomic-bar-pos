/**
 * One definition of money for every HQ screen (Dashboard, Cash flow, Invoices, Report, Holding).
 *
 * A bar's payment on an invoice is one of three kinds:
 *  - received:  money that reached JBM and was confirmed (transfer, cash, card after confirmation)
 *  - review:    logged but not confirmed yet (Stripe, "the bar says it paid"); never counted as received
 *  - direct:    the bar paid one of JBM's suppliers itself. It lowers what the bar owes on the invoice,
 *               but it is not JBM cash in, and the matching purchase is not JBM cash out.
 *
 * Pure functions: the API (api/_dashboardMonth.js) and the screens import the same file.
 */
import { BAR_PAID_CREDITS } from './barCredits.js'

export const DIRECT_METHOD = 'Bar → supplier'

const DIRECT_RE = /bar\s*(→|->|to)\s*supplier|direct|direto|pago pelo bar|paid by (the )?bar/i

export function isDirectMethod(metodo) {
  return DIRECT_RE.test(String(metodo || ''))
}

/** 'received' | 'review' | 'direct' */
export function paymentKind(p) {
  if (isDirectMethod(p?.metodo)) return 'direct'
  return p?.confirmado ? 'received' : 'review'
}

export function invoiceTotal(f) {
  return +f?.total || +f?.valor || 0
}

/** Same period label everywhere: the invoice covers periodo_inicio → periodo_fim (issue/due only as fallback). */
export function invoicePeriod(f) {
  const start = String(f?.periodo_inicio || f?.data_emissao || '').slice(0, 10)
  const end = String(f?.periodo_fim || f?.periodo_inicio || f?.data_emissao || '').slice(0, 10)
  return { start, end }
}

/** Direct payments known from before the log had a "direct" method (src/lib/barCredits.js). */
function legacyDirectFor(f) {
  const { start, end } = invoicePeriod(f)
  let sum = 0
  for (const [month, list] of Object.entries(BAR_PAID_CREDITS)) {
    if (!(start.slice(0, 7) <= month && month <= end.slice(0, 7))) continue
    for (const c of list) if (c.barId === f?.bar_id) sum += +c.valor || 0
  }
  return sum
}

/**
 * One invoice's money. `paid` (faturas.pago) is what the bar no longer owes; it is split into
 * cash received and direct payments, so the two are never added together as "received".
 */
export function invoiceMoney(f, pagamentos = []) {
  const total = invoiceTotal(f)
  const own = (pagamentos || []).filter(p => p.fatura_id === f?.id)
  let received = 0
  let direct = 0
  let review = 0
  for (const p of own) {
    const v = +p.valor || 0
    const kind = paymentKind(p)
    if (kind === 'review') review += v
    else if (kind === 'direct') { if (p.confirmado !== false) direct += v; else review += v }
    else received += v
  }
  const paid = Math.max(0, +f?.pago || 0)
  // Part of `pago` with no payment row behind it (set before payments were logged one by one).
  let unrecorded = Math.max(0, paid - received - direct)
  const legacyDirect = Math.min(unrecorded, Math.max(0, legacyDirectFor(f) - direct))
  direct += legacyDirect
  unrecorded -= legacyDirect
  received += unrecorded
  return {
    total,
    paid,
    received,
    direct,
    review,
    unrecorded,
    remaining: Math.max(0, total - paid),
  }
}

/** Totals over many invoices. received never includes review or direct. */
export function ledgerTotals(faturas = [], pagamentos = []) {
  const out = { billed: 0, received: 0, direct: 0, review: 0, remaining: 0, unrecorded: 0 }
  for (const f of faturas || []) {
    const m = invoiceMoney(f, pagamentos)
    out.billed += m.total
    out.received += m.received
    out.direct += m.direct
    out.review += m.review
    out.remaining += m.remaining
    out.unrecorded += m.unrecorded
  }
  return out
}

/** Confirmed cash payments only (for "money in by date" charts). */
export function receivedPayments(pagamentos = []) {
  return (pagamentos || []).filter(p => paymentKind(p) === 'received')
}

export function purchaseAmount(c) {
  const real = +c?.total_real || 0
  if (real) return real
  const pago = +c?.total_pago || 0
  if (pago) return pago
  return (c?.compras_itens || []).reduce((a, it) => a + (+it.qtd || 0) * (+it.custo_unitario || 0), 0)
}

/** The bar paid this purchase straight to the supplier: it is not JBM cash out. */
export function purchasePaidByBar(c) {
  if (isDirectMethod(c?.metodo_pagamento_real) || isDirectMethod(c?.pagamento)) return true
  const month = String(c?.data_compra || c?.data || '').slice(0, 7)
  const sup = String(c?.fornecedor || '').trim().toLowerCase()
  return (BAR_PAID_CREDITS[month] || []).some(x =>
    String(x.fornecedor || '').trim().toLowerCase() === sup && Math.abs((+x.valor || 0) - purchaseAmount(c)) < 1)
}

/** JBM cash out: purchases marked paid, minus the ones the bar paid directly. */
export function purchasesPaidOut(compras = []) {
  return (compras || []).filter(c => c.status_pagamento === 'pago' && !purchasePaidByBar(c))
}

/**
 * The one reconciled cash figure: opening balance (Holding) + cash received − cash paid out.
 * Direct payments and payments under review are shown next to it, never inside it.
 */
export function reconciledCash({ faturas = [], pagamentos = [], compras = [], openingBalance = 0 } = {}) {
  const t = ledgerTotals(faturas, pagamentos)
  const paidOut = purchasesPaidOut(compras).reduce((a, c) => a + purchaseAmount(c), 0)
  const opening = +openingBalance || 0
  return {
    opening,
    received: t.received,
    paidOut,
    cash: opening + t.received - paidOut,
    review: t.review,
    direct: t.direct,
    remaining: t.remaining,
    billed: t.billed,
  }
}

function inPeriod(d, start, end) {
  const k = String(d || '').slice(0, 10)
  if (!k) return false
  if (start && k < start) return false
  if (end && k > end) return false
  return true
}

function pedidoDeliveryDate(p) {
  return String(p?.data_entrega_prevista || p?.data_pedido || p?.criado_em || '').slice(0, 10)
}

function vendaLinkedPedido(v) {
  const m = String(v?.obs || '').match(/order\s+([a-f0-9]{8})/i)
  return m ? m[1] : null
}

/**
 * Deliveries an invoice covers: delivered orders of the bar in the period, plus manual sales that are
 * not the automatic copy of one of those orders ("Auto: order xxxxxxxx").
 */
export function invoiceDeliveries(f, { pedidos = [], vendas = [] } = {}) {
  const { start, end } = invoicePeriod(f)
  const rows = []
  const linked = new Set()
  for (const p of pedidos || []) {
    if (p.bar_id !== f?.bar_id) continue
    if (!['entregue', 'confirmado'].includes(p.status)) continue
    const d = pedidoDeliveryDate(p)
    if (!inPeriod(d, start, end)) continue
    linked.add(String(p.id).slice(0, 8))
    rows.push({ kind: 'pedido', id: p.id, data: d, valor: +p.total_estimado || 0 })
  }
  for (const v of vendas || []) {
    if (v.bar_id !== f?.bar_id) continue
    const link = vendaLinkedPedido(v)
    if (link && linked.has(link)) continue
    const d = String(v.data || v.data_venda || '').slice(0, 10)
    if (!inPeriod(d, start, end)) continue
    rows.push({ kind: 'venda', id: v.id, data: d, valor: +v.total || 0 })
  }
  rows.sort((a, b) => a.data.localeCompare(b.data))
  return { rows, total: rows.reduce((a, r) => a + r.valor, 0) }
}

/**
 * Invoice lock: total = linked deliveries ± an explicit adjustment with a reason.
 * `ajuste` is signed (a discount is negative).
 */
export function invoiceCheck(f, deliveriesTotal) {
  const total = invoiceTotal(f)
  const ajuste = +f?.ajuste || 0
  const motivo = String(f?.ajuste_motivo || '').trim()
  const expected = Math.round((+deliveriesTotal || 0) + ajuste)
  const diff = Math.round(total - expected)
  return {
    total,
    deliveries: Math.round(+deliveriesTotal || 0),
    ajuste,
    motivo,
    diff,
    ok: Math.abs(diff) < 1 && (ajuste === 0 || !!motivo),
    needsReason: ajuste !== 0 && !motivo,
  }
}

/** Error text when an invoice would be issued with a total that the deliveries and adjustment do not explain. */
export function invoiceLockError({ total, deliveries, ajuste = 0, motivo = '' }) {
  const diff = Math.round((+total || 0) - (+deliveries || 0) - (+ajuste || 0))
  if (Math.abs(diff) >= 1) return { code: 'diff', diff }
  if ((+ajuste || 0) !== 0 && !String(motivo || '').trim()) return { code: 'reason' }
  return null
}

/** Mean of the weeks that had any value; no data → null (screens show "—", never ¥1). */
export function averageOfActive(values = []) {
  const active = (values || []).filter(v => (+v || 0) > 0)
  if (!active.length) return null
  return Math.round(active.reduce((a, v) => a + (+v || 0), 0) / active.length)
}
