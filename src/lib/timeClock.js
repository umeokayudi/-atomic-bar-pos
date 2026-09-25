/** Ponto eletrônico + cálculo direto de horas e salário. */

import { tokyoHour } from './tokyo.js'

export { monthRange } from './tokyo.js'

/** Labor Standards Act art. 37 — 25% from 22:00 to 05:00 (Tokyo). */
export const LATE_NIGHT_PREMIUM = 0.25
export const LATE_NIGHT_START_HOUR = 22
export const LATE_NIGHT_END_HOUR = 5

const EARTH_M = 6371000

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = d => (+d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function isInsideGeofence({ lat, lng, barLat, barLng, radiusM = 150, accuracyM = 0 }) {
  if (barLat == null || barLng == null || lat == null || lng == null) {
    return { ok: false, distance: null, reason: 'no_location' }
  }
  const distance = haversineMeters(lat, lng, barLat, barLng)
  const radius = Math.max(50, +radiusM || 150)
  if (accuracyM > 250) return { ok: false, distance, reason: 'accuracy' }
  if (distance > radius) return { ok: false, distance, reason: 'outside' }
  return { ok: true, distance, reason: null }
}

export function hoursBetween(startIso, endIso) {
  const a = new Date(startIso).getTime()
  const b = new Date(endIso).getTime()
  if (!a || !b || b <= a) return 0
  return Math.round(((b - a) / 3600000) * 100) / 100
}

export function calcPay(hours, salarioHora) {
  const h = Math.max(0, +hours || 0)
  const rate = Math.max(0, +salarioHora || 0)
  return Math.round(h * rate)
}

export function isLateNightHour(hour) {
  const h = ((+hour % 24) + 24) % 24
  return h >= LATE_NIGHT_START_HOUR || h < LATE_NIGHT_END_HOUR
}

/** Minutes in 22:00–05:00 JST, rounded to 0.01h. */
export function lateNightHoursBetween(startIso, endIso) {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  if (!start || !end || end <= start) return 0
  const step = 60 * 1000
  let lateMs = 0
  for (let t = start; t < end; t += step) {
    if (isLateNightHour(tokyoHour(new Date(t)))) lateMs += step
  }
  return Math.round((lateMs / 3600000) * 100) / 100
}

export function calcPayWithLateNight(hours, lateNightHours, salarioHora, nightPremium = true) {
  if (!nightPremium) return calcPay(hours, salarioHora)
  const total = Math.max(0, +hours || 0)
  const late = Math.min(total, Math.max(0, +lateNightHours || 0))
  const regular = Math.max(0, Math.round((total - late) * 100) / 100)
  const rate = Math.max(0, +salarioHora || 0)
  return Math.round(regular * rate + late * rate * (1 + LATE_NIGHT_PREMIUM))
}

/** Desk calculator for HQ. Always wages — never mixed into POS or JBM. */
export function localHoursPay({ hours = 0, lateHours = 0, rate = 0, nightPremium = true } = {}) {
  const h = Math.max(0, +hours || 0)
  const late = Math.min(h, Math.max(0, +lateHours || 0))
  const salario = Math.max(0, +rate || 0)
  return {
    hours: h,
    lateHours: late,
    rate: salario,
    pay: calcPayWithLateNight(h, late, salario, nightPremium),
    book: 'wages',
  }
}

/** Emparelha IN/OUT em ordem. Ponto aberto fica sem saída. */
export function pairPunches(punches = []) {
  const sorted = [...punches].sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at))
  const shifts = []
  const openByStaff = {}

  for (const p of sorted) {
    const sid = p.staff_id
    if (p.tipo === 'in') {
      if (openByStaff[sid]) {
        shifts.push({ ...openByStaff[sid], open: true, hours: 0, pay: 0 })
      }
      openByStaff[sid] = { staff_id: sid, clockIn: p, clockOut: null, open: true }
    } else if (p.tipo === 'out') {
      const open = openByStaff[sid]
      if (!open) continue
      const hours = hoursBetween(open.clockIn.punched_at, p.punched_at)
      const lateHours = lateNightHoursBetween(open.clockIn.punched_at, p.punched_at)
      shifts.push({
        staff_id: sid,
        clockIn: open.clockIn,
        clockOut: p,
        open: false,
        hours,
        lateHours,
        pay: 0,
      })
      delete openByStaff[sid]
    }
  }

  for (const open of Object.values(openByStaff)) {
    shifts.push({ ...open, hours: 0, pay: 0 })
  }

  return shifts
}

export function payrollFromPunches(punches, staffList = [], { from, to } = {}, { nightPremium = true } = {}) {
  const filtered = (punches || []).filter(p => {
    const t = p.punched_at
    if (from && t < from) return false
    if (to && t > to) return false
    return true
  })
  const shifts = pairPunches(filtered)
  const byStaff = {}
  for (const s of staffList) {
    byStaff[s.id] = {
      staff_id: s.id,
      nome: s.nome,
      cargo: s.cargo || '',
      salario_hora: +s.salario_hora || 0,
      salario_mes: +s.salario_mes || 0,
      hours: 0,
      lateHours: 0,
      pay: 0,
      open: false,
      shifts: [],
    }
  }
  for (const sh of shifts) {
    const row = byStaff[sh.staff_id] || (byStaff[sh.staff_id] = {
      staff_id: sh.staff_id, nome: '—', cargo: '', salario_hora: 0, hours: 0, lateHours: 0, pay: 0, open: false, shifts: [],
    })
    const pay = calcPayWithLateNight(sh.hours, sh.lateHours || 0, row.salario_hora, nightPremium)
    sh.pay = pay
    row.hours = Math.round((row.hours + sh.hours) * 100) / 100
    row.lateHours = Math.round(((row.lateHours || 0) + (sh.lateHours || 0)) * 100) / 100
    row.pay += pay
    if (sh.open) row.open = true
    row.shifts.push(sh)
  }
  return Object.values(byStaff).sort((a, b) => b.hours - a.hours)
}
