/** 締め — one night of POS till. Never writes JBM vendas/faturas. */

import { tokyoDateKey, tokyoNightKey, tokyoWallToUtcMs } from './tokyo.js'

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

/** Inclusive ISO bounds: 06:00 JST on nightKey → 05:59:59.999 next calendar day. */
export function nightWindow(nightKey) {
  const [y, m, d] = String(nightKey || tokyoNightKey()).slice(0, 10).split('-').map(Number)
  const from = new Date(tokyoWallToUtcMs(y, m, d, 6, 0, 0, 0)).toISOString()
  const nextKey = nextTokyoDateKey(`${y}-${pad2(m)}-${pad2(d)}`)
  const [ny, nm, nd] = nextKey.split('-').map(Number)
  const to = new Date(tokyoWallToUtcMs(ny, nm, nd, 5, 59, 59, 999)).toISOString()
  return { from, to, nightKey: `${y}-${pad2(m)}-${pad2(d)}`, nextKey }
}

export function nightKeyOfSale(sale) {
  const ts = sale?.criado_em || sale?.created_at
  if (ts) {
    const d = new Date(ts)
    if (!Number.isNaN(d.getTime())) return tokyoNightKey(d)
  }
  return String(sale?.data || '').slice(0, 10)
}

/** Most recent nightlife day before tonight that still has till tickets. */
export function lastBusyNight(sales = [], nightKey = tokyoNightKey()) {
  const sums = {}
  for (const s of sales || []) {
    const key = nightKeyOfSale(s)
    if (!key || key >= nightKey) continue
    sums[key] = (sums[key] || 0) + (+s.total || 0)
  }
  const date = Object.keys(sums).filter(k => sums[k] > 0).sort().pop() || ''
  return { date, total: date ? sums[date] : 0, ticketCount: date ? (sales || []).filter(s => nightKeyOfSale(s) === date).length : 0 }
}

export function saleOnNight(sale, nightKey) {
  const win = nightWindow(nightKey)
  const ts = sale?.criado_em || sale?.created_at
  if (ts) {
    const iso = new Date(ts).toISOString()
    return iso >= win.from && iso <= win.to
  }
  const day = String(sale?.data || '').slice(0, 10)
  return day === win.nightKey || day === win.nextKey
}

export function summarizeNight(sales = [], nightKey = tokyoNightKey()) {
  const rows = (sales || []).filter(s => saleOnNight(s, nightKey))
  const pay = { Cash: 0, card: 0, paypay: 0, other: 0 }
  for (const s of rows) {
    const split = paySplitFromObs(s.obs)
    if (split) {
      pay.Cash += split.Cash
      pay[split.otherBucket] += split.other
      continue
    }
    const method = String(s.metodo_pagamento || s.pay_method || 'Cash')
    const total = +s.total || 0
    if (/\+/.test(method)) {
      if (/paypay|ペイペイ/i.test(method)) pay.paypay += total
      else if (/card|credit|debit|visa|クレジット/i.test(method)) pay.card += total
      else pay.other += total
      continue
    }
    if (/cash|現金/i.test(method)) pay.Cash += total
    else if (/paypay|ペイペイ/i.test(method)) pay.paypay += total
    else if (/card|credit|debit|visa|クレジット/i.test(method)) pay.card += total
    else pay.other += total
  }
  const ticketCount = rows.length
  const drinksTotal = rows.reduce((a, s) => a + (+s.total || 0), 0)
  return {
    nightKey,
    ticketCount,
    drinksTotal,
    cashTotal: pay.Cash,
    cardTotal: pay.card,
    paypayTotal: pay.paypay,
    otherTotal: pay.other,
    expectedCash: pay.Cash,
  }
}

export function closeVariance(expectedCash, countedCash) {
  return Math.round((+countedCash || 0) - (+expectedCash || 0))
}

export function pourKeep(keep, pct) {
  const remaining = Math.max(0, Math.min(100, Math.round((+keep?.remaining_pct || 0) - (+pct || 0))))
  return {
    ...keep,
    remaining_pct: remaining,
    ativo: remaining > 0,
  }
}
