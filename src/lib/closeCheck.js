/**
 * Close check (conferência do fechamento): what the till recorded per payment method for one night,
 * next to what was counted in the drawer, on the card machine and in the PayPay app.
 * Read-only on sales. The counts live in the live-store table pos_close_checks (one row per bar and night).
 */

import { nightKeyOfSale, paySplitFromObs, saleGross, saleNet, saleStamp, tabPayMethod } from './nightClose.js'
import { readTicketMeta } from './nightTicket.js'
import { orderCastFromObs } from './orderMeta.js'
import { tokyoHour } from './tokyo.js'

export const CHECK_TABLE = 'pos_close_checks'
/** Methods the owner counts by hand, in screen order. "other" (on account, mixed tabs) is listed but not counted. */
export const CHECK_METHODS = ['cash', 'card', 'paypay']
export const ALL_METHODS = ['cash', 'card', 'paypay', 'other']

/** Payment method text (till, tab payment, obs) → cash | card | paypay | other. */
export function methodBucket(method) {
  const m = String(method || '').trim()
  if (!m) return 'cash'
  if (/on account|ツケ|fiado/i.test(m)) return 'other'
  if (/paypay|ペイペイ/i.test(m)) return 'paypay'
  if (/card|credit|debit|visa|master|amex|jcb|クレジット/i.test(m)) return 'card'
  if (/cash|現金/i.test(m)) return 'cash'
  return 'other'
}

/** Short ticket name for the list: tab/table name, else cast, else the till type. */
export function saleLabel(sale) {
  const meta = readTicketMeta(sale?.obs)
  const details = String(meta.details || '').split('\n')[0].trim()
  const cast = orderCastFromObs(sale?.obs)
  return [details, cast].filter(Boolean).join(' · ')
}

function hhmm(sale) {
  const stamp = saleStamp(sale)
  if (!stamp) return ''
  const minutes = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', minute: '2-digit' }).format(stamp)
  return `${String(tokyoHour(stamp)).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * How one sale splits across methods, on its net amount (after refunds).
 * Tabs paid several ways use their payments (tabPays[comanda_id]); a split counter sale uses its obs line.
 */
export function saleParts(sale, tabPays = {}) {
  const net = saleNet(sale)
  if (!net) return []
  const pays = sale?.comanda_id ? (tabPays[sale.comanda_id] || []).filter(p => !p.estornado_em) : []
  if (pays.length && /^tab$/i.test(String(sale.metodo_pagamento || '').trim())) {
    const sum = pays.reduce((a, p) => a + Math.round(+p.valor || 0), 0)
    if (sum > 0) {
      const by = {}
      for (const p of pays) {
        const b = methodBucket(p.metodo)
        by[b] = (by[b] || 0) + Math.round(+p.valor || 0)
      }
      const keys = Object.keys(by)
      let left = net
      return keys.map((b, i) => {
        const amount = i === keys.length - 1 ? left : Math.round(by[b] * net / sum)
        left -= amount
        return { method: b, amount }
      }).filter(p => p.amount)
    }
  }
  const split = paySplitFromObs(sale?.obs)
  if (split) {
    const base = split.Cash + split.other
    const cash = base > 0 ? Math.round(split.Cash * net / base) : 0
    return [{ method: 'cash', amount: cash }, { method: split.otherBucket, amount: net - cash }].filter(p => p.amount)
  }
  const tab = tabPayMethod(sale)
  const raw = String(sale?.metodo_pagamento || sale?.pay_method || '')
  if (!tab && /^tab$/i.test(raw.trim())) return [{ method: 'other', amount: net }]
  return [{ method: methodBucket(tab || raw), amount: net }]
}

/** System side of the check: per method, the total and the tickets behind it (newest first). */
export function closeCheck(sales = [], nightKey, tabPays = {}) {
  const methods = Object.fromEntries(ALL_METHODS.map(m => [m, { total: 0, rows: [] }]))
  let total = 0
  let tickets = 0
  for (const sale of sales || []) {
    if (nightKeyOfSale(sale) !== nightKey) continue
    const parts = saleParts(sale, tabPays)
    if (!parts.length) continue
    if (saleGross(sale) > 0) tickets += 1
    else if (saleGross(sale) < 0) tickets -= 1
    const time = hhmm(sale)
    const label = saleLabel(sale)
    const split = parts.length > 1
    for (const p of parts) {
      methods[p.method].total += p.amount
      methods[p.method].rows.push({
        id: `${sale.id}:${p.method}`,
        saleId: sale.id,
        time,
        label,
        amount: p.amount,
        split,
        tab: !!sale.comanda_id || /^tab$/i.test(String(sale.metodo_pagamento || '').trim()),
        void: saleGross(sale) < 0,
        refunded: saleGross(sale) > 0 && saleNet(sale) < saleGross(sale),
        at: saleStamp(sale)?.getTime() || 0,
      })
      total += p.amount
    }
  }
  for (const m of ALL_METHODS) methods[m].rows.sort((a, b) => b.at - a.at)
  return { nightKey, methods, total, tickets }
}

/** Counted − system. Null when that method was not counted yet. */
export function methodDiff(system, counted) {
  if (counted === '' || counted == null || !Number.isFinite(+counted)) return null
  return Math.round(+counted - (+system || 0))
}

/** Overall state: 'empty' (nothing counted), 'partial', 'ok' (all counted and equal) or 'off'. */
export function checkState(check, counted = {}) {
  const diffs = CHECK_METHODS.map(m => methodDiff(check.methods[m].total, counted[m]))
  const done = diffs.filter(d => d != null)
  if (!done.length) return 'empty'
  if (done.some(d => d !== 0)) return 'off'
  return done.length === CHECK_METHODS.length ? 'ok' : 'partial'
}

export function checkRowId(barId, nightKey) {
  return `${barId}:${nightKey}`
}
