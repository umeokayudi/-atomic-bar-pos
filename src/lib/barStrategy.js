/** What already worked, plus birthday event ideas the manager can accept or drop. */

import { aggregateHourlySales } from './atomicPos.js'
import { nightKeyOfSale } from './nightClose.js'
import { orderCastFromObs } from './orderMeta.js'
import { tokyoDateKey, tokyoParts } from './tokyo.js'

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function weekday(dateKey) {
  const [y, m, d] = String(dateKey).slice(0, 10).split('-').map(Number)
  if (!y) return 0
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function addDays(dateKey, days) {
  const [y, m, d] = String(dateKey).slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function nextBirthday(aniversario, today) {
  const mmdd = String(aniversario || '').slice(5, 10)
  if (!/^\d{2}-\d{2}$/.test(mmdd)) return ''
  const year = +String(today).slice(0, 4)
  let date = `${year}-${mmdd}`
  if (date < today) date = `${year + 1}-${mmdd}`
  return date
}

function daysUntil(today, date) {
  const [y, m, d] = today.split('-').map(Number)
  const [y2, m2, d2] = date.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y, m - 1, d)) / 86400000)
}

export function whatWorked(tickets = []) {
  const byNight = new Map()
  for (const s of tickets || []) {
    const key = nightKeyOfSale(s)
    if (!key) continue
    const prev = byNight.get(key) || { date: key, sales: 0, count: 0 }
    prev.sales += +s.total || 0
    prev.count += 1
    byNight.set(key, prev)
  }
  const nights = [...byNight.values()]
  const byWeek = new Map()
  for (const n of nights) {
    const w = weekday(n.date)
    const prev = byWeek.get(w) || { weekday: w, label: WEEK[w], sales: 0, nights: 0 }
    prev.sales += n.sales
    prev.nights += 1
    byWeek.set(w, prev)
  }
  const days = [...byWeek.values()]
    .map(d => ({ ...d, avg: d.nights ? Math.round(d.sales / d.nights) : 0 }))
    .sort((a, b) => b.avg - a.avg)
  const hours = aggregateHourlySales(tickets).filter(h => h.total > 0).sort((a, b) => b.total - a.total)
  const cast = new Map()
  for (const s of tickets || []) {
    const name = orderCastFromObs(s.obs)
    if (!name) continue
    cast.set(name, (cast.get(name) || 0) + (+s.total || 0))
  }
  const topCast = [...cast.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nome, sales]) => ({ nome, sales }))
  return {
    nights: nights.length,
    bestDays: days.slice(0, 2),
    weakDay: days.length ? days[days.length - 1] : null,
    peakHours: hours.slice(0, 2),
    topCast,
  }
}

export function birthdayIdeas({ cast = [], partners = [], guests = [], worked, today = tokyoDateKey(), within = 60 }) {
  const rows = [
    ...cast.map(p => ({ ...p, origem: 'cast' })),
    ...partners.map(p => ({ ...p, origem: 'parceiro' })),
    ...guests.map(p => ({ ...p, origem: 'cliente' })),
  ]
  const best = worked?.bestDays?.[0]
  const peak = worked?.peakHours?.[0]
  const castName = worked?.topCast?.[0]?.nome
  return rows.flatMap(p => {
    const data = nextBirthday(p.aniversario, today)
    if (!data) return []
    const dist = daysUntil(today, data)
    if (dist < 0 || dist > within) return []
    const falls = WEEK[weekday(data)]
    const strong = best && WEEK[weekday(data)] === best.label
    let move = data
    if (best && !strong) {
      for (let delta = 1; delta <= 3; delta += 1) {
        const before = addDays(data, -delta)
        const after = addDays(data, delta)
        if (WEEK[weekday(before)] === best.label && daysUntil(today, before) >= 0) { move = before; break }
        if (WEEK[weekday(after)] === best.label) { move = after; break }
      }
    }
    const bits = []
    if (best) bits.push(`${best.label} is the day that sold the most (average ¥${best.avg.toLocaleString('ja-JP')}).`)
    if (peak) bits.push(`The peak was ${peak.label}.`)
    if (castName) bits.push(`Top bottle seller: ${castName}.`)
    if (move !== data) bits.push(`The birthday falls on ${falls}. Better to move the event to ${move} (${best.label}).`)
    else if (strong) bits.push(`The birthday already falls on a strong day (${falls}).`)
    return [{
      id: `bday-${p.origem}-${p.id}`,
      titulo: `${p.nome}'s birthday`,
      data: move,
      aniversario: data,
      origem: p.origem,
      pessoa_id: p.id,
      pessoa_nome: p.nome,
      nota: bits.join(' '),
    }]
  }).sort((a, b) => a.data.localeCompare(b.data))
}

export function strategyText(worked, ideas = []) {
  if (!worked?.nights) return 'Not enough sales yet to say what worked.'
  const days = (worked.bestDays || []).map(d => `${d.label} ¥${d.avg.toLocaleString('ja-JP')}`).join(', ')
  const hours = (worked.peakHours || []).map(h => h.label).join(', ')
  const cast = (worked.topCast || []).map(c => c.nome).join(', ')
  const next = ideas.slice(0, 3).map(i => `${i.pessoa_nome} (${i.data})`).join(', ')
  return [
    `Nights reviewed: ${worked.nights}.`,
    days && `Days that worked: ${days}.`,
    hours && `Hours that worked: ${hours}.`,
    cast && `Cast that worked: ${cast}.`,
    next && `Upcoming birthdays for the manager to decide: ${next}.`,
  ].filter(Boolean).join(' ')
}

export function upcomingBirthdays(rows, today = tokyoDateKey()) {
  const p = tokyoParts(new Date(`${today}T12:00:00+09:00`))
  return birthdayIdeas({
    cast: rows.filter(r => r.origem === 'cast'),
    partners: rows.filter(r => r.origem === 'parceiro'),
    guests: rows.filter(r => r.origem === 'cliente'),
    today,
    within: 366,
  }).map(r => ({ ...r, month: +r.aniversario.slice(5, 7) === p.month }))
}
