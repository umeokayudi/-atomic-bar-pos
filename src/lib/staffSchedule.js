/**
 * Staff schedule for the coming weeks, and who came late or did not come. Pure (used by the app and by
 * /api/bar-staff).
 *
 *   staff_availability  one row per person (id `${barId}:${staffId}`): days: { 'YYYY-MM-DD': { start: 'HH:MM' | '' } }
 *                       written only by that person (own id from the session), until the day's opening hour.
 *   staff_schedule      one row per bar night (id `${barId}:${day}`): the owner/manager's confirmed list
 *                       people: [{ id, nome, start }]. When a night has no confirmed row, the marks count as expected.
 *
 * A "day" here is the bar night (tokyoNightKey): a clock-in at 02:00 belongs to the night before.
 */

import { tokyoNightKey, tokyoParts, tokyoWallToUtcMs } from './tokyo.js'

export const SCHEDULE_WEEKS = 4
export const DEFAULT_TOLERANCE_MIN = 10
export const DEFAULT_OPEN_HOUR = 20

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export const isDayKey = v => DAY_RE.test(String(v || ''))
export const cleanStart = v => (TIME_RE.test(String(v || '').trim()) ? String(v).trim() : '')

export function addDays(key, n) {
  const [y, m, d] = String(key).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayMon(key) {
  const [y, m, d] = String(key).split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/** The weeks the staff can mark: from Monday of this week, `weeks` weeks long. */
export function scheduleWindow(today = tokyoNightKey(), weeks = SCHEDULE_WEEKS) {
  const from = addDays(today, -weekdayMon(today))
  return { from, to: addDays(from, weeks * 7 - 1) }
}

/** Every day key from `from` to `to`, grouped by week (Monday first). */
export function scheduleWeeks(from, to) {
  const weeks = []
  for (let k = from; k <= to; k = addDays(k, 1)) {
    if (!weeks.length || weekdayMon(k) === 0) weeks.push([])
    weeks[weeks.length - 1].push(k)
    if (weeks.length > 60) break
  }
  return weeks
}

/** Opening hour of the bar (bar_goals.abre), 20:00 when unset. */
export function openHourOf(goals) {
  const h = Math.round(+goals?.abre)
  return Number.isFinite(h) && goals?.abre != null && goals?.abre !== '' ? ((h % 24) + 24) % 24 : DEFAULT_OPEN_HOUR
}

/**
 * May the person still change this day? Future nights yes; tonight only before the bar opens; past nights never.
 * `now` is a Date (Tokyo wall clock is read from it).
 */
export function canEditDay(day, { now = new Date(), openHour = DEFAULT_OPEN_HOUR } = {}) {
  if (!isDayKey(day)) return false
  const tonight = tokyoNightKey(now)
  if (day > tonight) return true
  if (day < tonight) return false
  const p = tokyoParts(now)
  // Between midnight and 06:00 the night key is yesterday's night: already open.
  if (p.hour < 6) return false
  return p.hour < openHour
}

/** Clean the days a person sends: only valid keys inside the window, one entry per day. */
export function cleanDays(input, { from, to } = {}) {
  const out = {}
  const list = Array.isArray(input) ? input : Object.entries(input || {}).map(([day, v]) => ({ day, ...(v && typeof v === 'object' ? v : {}) }))
  for (const raw of list.slice(0, 120)) {
    const day = typeof raw === 'string' ? raw : raw?.day
    if (!isDayKey(day)) continue
    if (from && day < from) continue
    if (to && day > to) continue
    out[day] = { start: cleanStart(typeof raw === 'object' ? raw.start : '') }
  }
  return out
}

/**
 * New `days` for a person's availability row: days that can no longer change keep what was stored;
 * days that can change take what was sent (absent from the list = not coming).
 * Returns { days, locked: [days the person tried to change but could not] }.
 */
export function mergeAvailability(stored = {}, incoming = {}, { from, to, now = new Date(), openHour = DEFAULT_OPEN_HOUR } = {}) {
  const days = {}
  const locked = []
  for (const [day, v] of Object.entries(stored || {})) {
    if (!isDayKey(day)) continue
    const inWindow = (!from || day >= from) && (!to || day <= to)
    if (!inWindow || !canEditDay(day, { now, openHour })) days[day] = { start: cleanStart(v?.start) }
  }
  for (const [day, v] of Object.entries(incoming || {})) {
    if (!canEditDay(day, { now, openHour })) {
      const before = stored?.[day]
      if (!before || cleanStart(before.start) !== cleanStart(v?.start)) locked.push(day)
      continue
    }
    days[day] = { start: cleanStart(v?.start) }
  }
  // A locked day missing from the request is simply kept (the app sends only the days it shows as editable).
  return { days: Object.fromEntries(Object.entries(days).sort(([a], [b]) => (a < b ? -1 : 1))), locked: locked.sort() }
}

/** Expected people of one night: the confirmed list when the owner confirmed it, else everyone who marked it. */
export function expectedFor(day, { availability = [], schedules = [] } = {}) {
  const confirmed = (schedules || []).find(s => s && s.day === day)
  if (confirmed && Array.isArray(confirmed.people)) {
    return { confirmed: true, people: confirmed.people.map(p => ({ id: String(p.id), nome: p.nome || '', start: cleanStart(p.start) })) }
  }
  const people = []
  for (const row of availability || []) {
    const mark = row?.days?.[day]
    if (!mark) continue
    people.push({ id: String(row.staff_id), nome: row.staff_nome || '', start: cleanStart(mark.start) })
  }
  people.sort((a, b) => (a.start || '99').localeCompare(b.start || '99') || a.nome.localeCompare(b.nome))
  return { confirmed: false, people }
}

/** One row per day of the window for the owner's board. */
export function scheduleBoard({ from, to, availability = [], schedules = [] }) {
  const rows = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const marked = expectedFor(day, { availability, schedules: [] }).people
    const exp = expectedFor(day, { availability, schedules })
    rows.push({ day, marked, expected: exp.people, confirmed: exp.confirmed, count: exp.people.length })
    if (rows.length > 120) break
  }
  return rows
}

/** UTC ms of a scheduled start on a bar night: hours before 06:00 are on the next calendar day. */
export function startMs(day, start) {
  const s = cleanStart(start)
  if (!s || !isDayKey(day)) return null
  const [h, m] = s.split(':').map(Number)
  const [y, mo, d] = day.split('-').map(Number)
  return tokyoWallToUtcMs(y, mo, d + (h < 6 ? 1 : 0), h, m)
}

/** First clock-in of each person per night: { 'staffId|day': punch }. */
export function firstInByNight(punches = []) {
  const out = {}
  for (const p of punches || []) {
    if (!p || p.tipo !== 'in' || !p.punched_at) continue
    const day = tokyoNightKey(new Date(p.punched_at))
    const key = `${p.staff_id}|${day}`
    if (!out[key] || Date.parse(p.punched_at) < Date.parse(out[key].punched_at)) out[key] = p
  }
  return out
}

/**
 * Attendance of the expected people of one night against the clock.
 *   ok      clocked in on time (or no start time set)
 *   late    clocked in after start + tolerance (lateMinutes counted from the start)
 *   absent  expected, the night is over, no clock-in
 *   missing tonight, past start + tolerance, no clock-in yet
 *   pending tonight / future, nothing to say yet
 */
export function attendanceFor({ day, expected = [], punches = [], toleranceMin = DEFAULT_TOLERANCE_MIN, now = new Date() }) {
  const firsts = firstInByNight(punches)
  const tonight = tokyoNightKey(now)
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now)
  const tol = Math.max(0, Math.round(+toleranceMin || 0))
  return (expected || []).map(person => {
    const inPunch = firsts[`${person.id}|${day}`] || null
    const begin = startMs(day, person.start)
    let status = 'pending'
    let lateMinutes = 0
    if (inPunch) {
      const at = Date.parse(inPunch.punched_at)
      if (begin != null && at > begin + tol * 60000) {
        status = 'late'
        lateMinutes = Math.round((at - begin) / 60000)
      } else status = 'ok'
    } else if (day < tonight) status = 'absent'
    else if (day === tonight && begin != null && nowMs > begin + tol * 60000) status = 'missing'
    return { ...person, day, status, lateMinutes, inAt: inPunch?.punched_at || null }
  })
}

/** Attendance for one person over many nights: { day: { status, lateMinutes } } (only nights they were expected). */
export function myAttendance({ meId, from, to, availability = [], schedules = [], punches = [], toleranceMin, now = new Date() }) {
  const out = {}
  const mine = (punches || []).filter(p => p && p.staff_id === meId)
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const exp = expectedFor(day, { availability, schedules }).people.filter(p => p.id === String(meId))
    if (!exp.length) continue
    const [row] = attendanceFor({ day, expected: exp, punches: mine, toleranceMin, now })
    out[day] = { status: row.status, lateMinutes: row.lateMinutes, start: row.start }
  }
  return out
}
