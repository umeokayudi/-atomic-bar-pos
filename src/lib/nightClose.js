/** 締め — one night of POS till. Never writes JBM vendas/faturas. */

import { cardFee } from './posFloor.js'
import { tokyoDateKey, tokyoHour, tokyoNightKey, tokyoWallToUtcMs } from './tokyo.js'

export { tokyoNightKey }

function pad2(n) {
  return String(n).padStart(2, '0')
}

export function nextTokyoDateKey(dateKey) {
  const [y, m, d] = String(dateKey).slice(0, 10).split('-').map(Number)
  const next = new Date(tokyoWallToUtcMs(y, m, d, 12) + 86400000)
  return tokyoDateKey(next)
}

export function prevTokyoDateKey(dateKey) {
  const [y, m, d] = String(dateKey).slice(0, 10).split('-').map(Number)
  const prev = new Date(tokyoWallToUtcMs(y, m, d, 12) - 86400000)
  return tokyoDateKey(prev)
}

/** Split tender packed into ticket obs. Cash stays cash; Card/PayPay stay record-only. */
export function paySplitFromObs(obs) {
  const m = String(obs || '').match(/Pay:\s*Cash\s+(\d+)\s*\+\s*(Card|PayPay|Credit card)\s+(\d+)/i)
  if (!m) return null
  return {
    Cash: +m[1],
    other: +m[3],
    otherBucket: /paypay/i.test(m[2]) ? 'paypay' : 'card',
  }
}

/** Seeded sample ticket. Not guest money. */
export function isDemoTill(sale) {
  return /^Demo POS\b/i.test(String(sale?.obs || '').trim())
}

/** Real sale instant. A date-only string is not an hour. */
export function saleStamp(sale) {
  const ts = sale?.criado_em || sale?.created_at
  if (!ts || /^\d{4}-\d{2}-\d{2}$/.test(String(ts).trim())) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/** Inclusive ISO bounds: 06:00 JST on nightKey → 05:59:59.999 next calendar day. */
export function nightWindow(nightKey) {
  const [y, m, d] = String(nightKey || tokyoNightKey()).slice(0, 10).split('-').map(Number)
  const from = new Date(tokyoWallToUtcMs(y, m, d, 6, 0, 0, 0)).toISOString()
  const nextKey = nextTokyoDateKey(`${y}-${pad2(m)}-${pad2(d)}`)
  const [ny, nm, nd] = nextKey.split('-').map(Number)
  const to = new Date(tokyoWallToUtcMs(ny, nm, nd, 5, 59, 59, 999)).toISOString()
  return { from, to, nightKey: `${y}-${pad2(m)}-${pad2(d)}`, nextKey }
}

/** Nightlife day of the sale, from the Tokyo hour it was rung. 05:00 belongs to the night that started the day before. */
export function nightKeyOfSale(sale) {
  if (!sale || isDemoTill(sale)) return ''
  const stamp = saleStamp(sale)
  if (stamp) return tokyoNightKey(stamp)
  return String(sale?.data || '').slice(0, 10)
}

/** Tokyo hour 0–23 of the sale. Null when the ticket has no clock time. */
export function hourOfSale(sale) {
  if (!sale || isDemoTill(sale)) return null
  const stamp = saleStamp(sale)
  if (!stamp) return null
  return tokyoHour(stamp)
}

/** Most recent nightlife day before tonight that still has till tickets. */
export function lastBusyNight(sales = [], nightKey = tokyoNightKey()) {
  const sums = {}
  for (const s of sales || []) {
    const key = nightKeyOfSale(s)
    if (!key || key >= nightKey) continue
    sums[key] = (sums[key] || 0) + saleNet(s)
  }
  const date = Object.keys(sums).filter(k => sums[k] > 0).sort().pop() || ''
  return { date, total: date ? sums[date] : 0, ticketCount: date ? (sales || []).filter(s => nightKeyOfSale(s) === date).length : 0 }
}

export function saleOnNight(sale, nightKey) {
  const key = nightKeyOfSale(sale)
  return !!key && key === nightKey
}

export function saleGross(sale) {
  return Math.round(+sale?.total || 0)
}

export function saleRefund(sale) {
  return Math.min(saleGross(sale), Math.max(0, Math.round(+sale?.refunded || 0)))
}

export function saleNet(sale) {
  return saleGross(sale) - saleRefund(sale)
}

/** Fee still on the books after reversals. Cash and other pay no fee. */
export function saleCardFee(sale) {
  const method = String(sale?.metodo_pagamento || sale?.pay_method || '')
  const gross = saleGross(sale)
  const net = saleNet(sale)
  if (sale?.card_fee != null && sale.card_fee !== '') {
    const stored = Math.round(+sale.card_fee || 0)
    if (sale.card_fee_reversed != null && sale.card_fee_reversed !== '') {
      return Math.max(0, stored - Math.round(+sale.card_fee_reversed || 0))
    }
    return gross > 0 ? Math.round(stored * net / gross) : 0
  }
  if (method !== 'card' && method !== 'credit') return 0
  return cardFee(net, 'card')
}

const POS_CASH_TYPES = new Set(['pos_venda', 'taxa_cartao', 'pos_void', 'taxa_cartao_estorno'])

/** Till night of a cash row. The stored operational_day wins. A real timestamp uses 06:00 JST. A date-only value is already a label and is not shifted. */
export function movementOperationalDay(move) {
  if (move?.operational_day) return String(move.operational_day).slice(0, 10)
  const stamp = move?.data || move?.created_at
  if (!stamp) return ''
  const text = String(stamp).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 10)
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return ''
  return tokyoNightKey(parsed)
}

export function nightSettlement(sales = []) {
  const gross_sales = (sales || []).reduce((sum, sale) => sum + saleGross(sale), 0)
  const refunds = (sales || []).reduce((sum, sale) => sum + saleRefund(sale), 0)
  const net_sales = gross_sales - refunds
  const card_fees = (sales || []).reduce((sum, sale) => sum + saleCardFee(sale), 0)
  return { gross_sales, refunds, net_sales, card_fees }
}

function addTender(pay, sale) {
  const net = saleNet(sale)
  const gross = saleGross(sale)
  const split = paySplitFromObs(sale.obs)
  if (split) {
    const base = split.Cash + split.other
    const scale = base > 0 ? net / base : 0
    pay.Cash += Math.round(split.Cash * scale)
    pay[split.otherBucket] += Math.round(split.other * scale)
    return
  }
  const method = String(sale.metodo_pagamento || sale.pay_method || 'Cash')
  const amount = gross === net ? gross : net
  if (/\+/.test(method)) {
    if (/paypay|ペイペイ/i.test(method)) pay.paypay += amount
    else if (/card|credit|debit|visa|クレジット/i.test(method)) pay.card += amount
    else pay.other += amount
    return
  }
  if (/cash|現金/i.test(method)) pay.Cash += amount
  else if (/paypay|ペイペイ/i.test(method)) pay.paypay += amount
  else if (/card|credit|debit|visa|クレジット/i.test(method)) pay.card += amount
  else pay.other += amount
}

export function summarizeNight(sales = [], nightKey = tokyoNightKey()) {
  const rows = (sales || []).filter(s => saleOnNight(s, nightKey))
  const pay = { Cash: 0, card: 0, paypay: 0, other: 0 }
  for (const sale of rows) addTender(pay, sale)
  const books = nightSettlement(rows)
  return {
    nightKey,
    ticketCount: rows.length,
    drinksTotal: books.net_sales,
    grossSales: books.gross_sales,
    refunds: books.refunds,
    netSales: books.net_sales,
    cardFees: books.card_fees,
    cashTotal: pay.Cash,
    cardTotal: pay.card,
    paypayTotal: pay.paypay,
    otherTotal: pay.other,
    expectedCash: pay.Cash,
  }
}

/**
 * Sales stay on pos_vendas.data (the operational night).
 * Cash keeps its real timestamp and is grouped by operational_day.
 * aligned is true when the till-night cash net matches net sales minus the card fee still on the books.
 */
export function reconcileNight(sales = [], movements = [], nightKey = tokyoNightKey()) {
  const books = summarizeNight(sales, nightKey)
  let cashIn = 0
  let cashOut = 0
  let feePaid = 0
  let feeReversed = 0
  for (const move of movements || []) {
    if (movementOperationalDay(move) !== nightKey) continue
    if (!POS_CASH_TYPES.has(move.referencia_tipo)) continue
    const amount = Math.round(+move.valor || 0)
    if (move.referencia_tipo === 'pos_venda' && move.tipo === 'entrada') cashIn += amount
    else if (move.referencia_tipo === 'pos_void' && move.tipo === 'saida') cashOut += amount
    else if (move.referencia_tipo === 'taxa_cartao' && move.tipo === 'saida') feePaid += amount
    else if (move.referencia_tipo === 'taxa_cartao_estorno' && move.tipo === 'entrada') feeReversed += amount
  }
  const cashNet = cashIn - cashOut - feePaid + feeReversed
  const salesAfterFees = books.netSales - books.cardFees
  return {
    ...books,
    gross_sales: books.grossSales,
    net_sales: books.netSales,
    card_fees: books.cardFees,
    cashIn,
    cashOut,
    feePaid,
    feeReversed,
    cashNet,
    salesAfterFees,
    aligned: cashNet === salesAfterFees,
  }
}

export function closeVariance(expectedCash, countedCash) {
  return Math.round((+countedCash || 0) - (+expectedCash || 0))
}

/** A blank count is not a match. The caller must show the variance. */
export function countedCashInput(counted, expectedCash) {
  if (counted == null || String(counted).trim() === '') return { error: 'counted-required' }
  const n = Number(counted)
  if (!Number.isFinite(n)) return { error: 'counted-required' }
  const countedCash = Math.round(n)
  return { countedCash, variance: closeVariance(expectedCash, countedCash) }
}

export function pourKeep(keep, pct) {
  const remaining = Math.max(0, Math.min(100, Math.round((+keep?.remaining_pct || 0) - (+pct || 0))))
  return {
    ...keep,
    remaining_pct: remaining,
    ativo: remaining > 0,
  }
}
