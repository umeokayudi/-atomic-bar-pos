import { addDays, weekdayOf } from './barClose.js'

function mondayOf(date) {
  const wd = weekdayOf(date)
  return addDays(date, wd === 0 ? -6 : 1 - wd)
}

/**
 * Walk the payment agenda in date order against the money the bar has now.
 * Each payment gets a status:
 *   ok    → paid from the money already on hand
 *   tight → only paid if the expected income (card landings) arrives first
 *   short → not enough money even with that income; `missing` says how much is lacking
 * Income rows keep status 'in'. Without a balance every status is null.
 */
export function coverAgenda(agenda = [], balance = null) {
  const known = balance != null && balance !== '' && Number.isFinite(+balance)
  let onHand = known ? Math.round(+balance) : 0
  let withIncome = onHand
  let income = 0
  let due = 0
  let firstShort = null
  let firstTight = null
  let lowest = 0
  const rows = (agenda || []).map(item => {
    const amount = Math.round(+item.amount || 0)
    if (item.inflow) {
      withIncome += amount
      income += amount
      return { ...item, status: known ? 'in' : null, left: known ? withIncome : null, missing: 0 }
    }
    due += amount
    onHand -= amount
    withIncome -= amount
    if (!known) return { ...item, status: null, left: null, missing: 0 }
    let status = 'ok'
    if (withIncome < 0) status = 'short'
    else if (onHand < 0) status = 'tight'
    const missing = status === 'short' ? Math.min(amount, -withIncome) : 0
    if (withIncome < lowest) lowest = withIncome
    if (status === 'short' && !firstShort) firstShort = { date: item.date, days: item.days }
    if (status === 'tight' && !firstTight) firstTight = { date: item.date, days: item.days }
    return { ...item, status, left: withIncome, missing }
  })
  const end = withIncome
  let status = null
  if (known) status = firstShort ? 'short' : firstTight ? 'tight' : 'ok'
  return {
    rows,
    known,
    balance: known ? Math.round(+balance) : null,
    due,
    income,
    end: known ? end : null,
    // Biggest gap at any point: money that must come from somewhere to pay everything on time.
    missing: known && lowest < 0 ? -lowest : 0,
    status,
    firstShort,
    firstTight,
  }
}

/** Friendly group for a payment date: late, today, tomorrow, this week, next week, or its month. */
export function dateBucket(date, today) {
  const d = String(date || '').slice(0, 10)
  if (d < today) return 'late'
  if (d === today) return 'today'
  if (d === addDays(today, 1)) return 'tomorrow'
  const week = mondayOf(today)
  if (d < addDays(week, 7)) return 'week'
  if (d < addDays(week, 14)) return 'nextWeek'
  return `month:${d.slice(0, 7)}`
}

/** Agenda rows grouped by dateBucket, in order. */
export function bucketAgenda(rows = [], today) {
  const groups = []
  const byKey = new Map()
  for (const row of rows) {
    const key = dateBucket(row.date, today)
    let group = byKey.get(key)
    if (!group) {
      group = { key, rows: [], due: 0 }
      byKey.set(key, group)
      groups.push(group)
    }
    group.rows.push(row)
    if (!row.inflow) group.due += Math.round(+row.amount || 0)
  }
  const order = k => (k === 'late' ? 0 : k === 'today' ? 1 : k === 'tomorrow' ? 2 : k === 'week' ? 3 : k === 'nextWeek' ? 4 : 5)
  return groups.sort((a, b) => order(a.key) - order(b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** Whole days between two YYYY-MM-DD keys. */
export function daysBetween(from, to) {
  const ms = k => {
    const [y, m, d] = String(k).slice(0, 10).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((ms(to) - ms(from)) / 86400000)
}
