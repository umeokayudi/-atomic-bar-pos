/** Daily work report per employee for one bar night (06:00 → 05:59 JST). Pure: no fetch, no writes. */

import { calcPayWithLateNight, lateNightHoursBetween, pairPunches } from './timeClock.js'
import { nightWindow, nightKeyOfSale, saleNet } from './nightClose.js'
import { readTicketMeta } from './nightTicket.js'
import { orderCastFromObs, orderCastIdFromObs } from './orderMeta.js'

const TOKYO_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false })

export function tokyoClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : TOKYO_TIME.format(d)
}

function round2(n) {
  return Math.round((+n || 0) * 100) / 100
}

function inWindow(iso, win) {
  return !!iso && iso >= win.from && iso <= win.to
}

function ticketOwner(sale, person) {
  const id = orderCastIdFromObs(sale?.obs) || sale?.drink_back_agent_id || ''
  if (id) return id === person.id
  const name = orderCastFromObs(sale?.obs).trim().toLowerCase()
  return !!name && name === String(person.nome || '').trim().toLowerCase()
}

/**
 * One row per person on the roster (plus anyone who punched in without being on it).
 * status: working (clocked in, not out) · done (in and out) · absent (marked) · off (no punch).
 * late: marked late on the night sheet.
 */
export function staffDayReport({ night, punches = [], staff = [], tickets = [], sheet = null, nightPremium = true, now = new Date() } = {}) {
  const win = nightWindow(night)
  const nightPunches = (punches || []).filter(p => inWindow(p.punched_at, win))
  const shifts = pairPunches(nightPunches)
  const nightTickets = (tickets || []).filter(s => nightKeyOfSale(s) === win.nightKey)
  const lateIds = new Set((sheet?.late || []).map(p => p?.id).filter(Boolean))
  const absentIds = new Set((sheet?.absent || []).map(p => p?.id).filter(Boolean))

  const roster = new Map()
  for (const s of staff || []) {
    if (!s?.id || s.ativo === false) continue
    roster.set(s.id, { id: s.id, nome: String(s.nome || s.email || '—').trim(), cargo: s.cargo || '', rate: +s.salario_hora || 0 })
  }
  for (const sh of shifts) {
    if (!roster.has(sh.staff_id)) roster.set(sh.staff_id, { id: sh.staff_id, nome: '—', cargo: '', rate: 0 })
  }

  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString()
  const rows = [...roster.values()].map(person => {
    const mine = shifts.filter(sh => sh.staff_id === person.id)
    let hours = 0
    let lateHours = 0
    let open = false
    const blocks = mine.map(sh => {
      const inAt = sh.clockIn?.punched_at || ''
      const outAt = sh.clockOut?.punched_at || ''
      let h = +sh.hours || 0
      let lh = +sh.lateHours || 0
      if (sh.open && inAt) {
        open = true
        const until = nowIso < win.to ? nowIso : win.to
        h = Math.max(0, (new Date(until) - new Date(inAt)) / 3600000)
        lh = until > inAt ? lateNightHoursBetween(inAt, until) : 0
      }
      hours += h
      lateHours += lh
      return { in: tokyoClock(inAt), out: tokyoClock(outAt), open: !!sh.open, hours: round2(h) }
    })
    const sales = nightTickets.filter(s => ticketOwner(s, person))
    const salesTotal = sales.reduce((a, s) => a + saleNet(s), 0)
    const commission = sales.reduce((a, s) => a + (readTicketMeta(s.obs).commission || 0), 0)
    const pay = Math.round(calcPayWithLateNight(round2(hours), round2(lateHours), person.rate, nightPremium) || 0)
    let status = 'off'
    if (absentIds.has(person.id)) status = 'absent'
    else if (open) status = 'working'
    else if (mine.length) status = 'done'
    return {
      ...person,
      status,
      late: lateIds.has(person.id),
      firstIn: blocks[0]?.in || '',
      lastOut: open ? '' : (blocks[blocks.length - 1]?.out || ''),
      blocks,
      hours: round2(hours),
      lateHours: round2(lateHours),
      pay,
      tickets: sales.length,
      sales: salesTotal,
      commission,
    }
  })

  const order = { working: 0, done: 1, absent: 2, off: 3 }
  rows.sort((a, b) => (order[a.status] - order[b.status]) || b.hours - a.hours || a.nome.localeCompare(b.nome))

  const worked = rows.filter(r => r.status === 'working' || r.status === 'done')
  return {
    night: win.nightKey,
    rows,
    totals: {
      people: worked.length,
      working: rows.filter(r => r.status === 'working').length,
      late: rows.filter(r => r.late).length,
      absent: rows.filter(r => r.status === 'absent').length,
      hours: round2(worked.reduce((a, r) => a + r.hours, 0)),
      pay: worked.reduce((a, r) => a + r.pay, 0),
      sales: rows.reduce((a, r) => a + r.sales, 0),
      tickets: nightTickets.length,
      unassigned: nightTickets.filter(s => !orderCastFromObs(s.obs) && !orderCastIdFromObs(s.obs) && !s.drink_back_agent_id).length,
    },
  }
}

/** CSV for the owner's records (one line per person). */
export function staffDayCsv(report, labels) {
  const head = labels || ['Night', 'Name', 'Role', 'Status', 'Late', 'In', 'Out', 'Hours', 'Late-night hours', 'Pay', 'Tickets', 'Sales', 'Commission']
  const esc = v => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [head.map(esc).join(',')]
  for (const r of report?.rows || []) {
    lines.push([report.night, r.nome, r.cargo, r.status, r.late ? 'yes' : '', r.firstIn, r.lastOut, r.hours, r.lateHours, r.pay, r.tickets, r.sales, r.commission].map(esc).join(','))
  }
  return lines.join('\n')
}
