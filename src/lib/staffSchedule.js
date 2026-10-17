/**
 * Staff schedule for the coming weeks, and who came late or did not come. Pure (used by the app and by
 * /api/bar-staff).
 *
 *   staff_availability  one row per person (id `${barId}:${staffId}`): days: { 'YYYY-MM-DD': { start: 'HH:MM' | '', end?: 'HH:MM' } }
 *                       written only by that person (own id from the session), until the day's opening hour.
 *                       weeks: { 'YYYY-MM-DD' (Monday): { submitted_at } } = the person sent that week as final;
 *                       reminded: { 'YYYY-MM-DD' (Monday): 'YYYY-MM-DD' (last reminder day) }.
 *   staff_schedule      one row per bar night (id `${barId}:${day}`): the owner/manager's confirmed list
 *                       people: [{ id, nome, start, end? }]. When a night has no confirmed row, the marks count as expected.
 *   bar_goals.escala_*  the owner's rules for sending next week (see scheduleRules).
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

/** One night's mark: { start } plus `end` only when set (older rows have no end). */
export function dayMark(v) {
  const start = cleanStart(v?.start)
  const end = cleanStart(v?.end)
  return end ? { start, end } : { start }
}
const sameMark = (a, b) => cleanStart(a?.start) === cleanStart(b?.start) && cleanStart(a?.end) === cleanStart(b?.end)

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
    out[day] = dayMark(typeof raw === 'object' ? raw : {})
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
    if (!inWindow || !canEditDay(day, { now, openHour })) days[day] = dayMark(v)
  }
  for (const [day, v] of Object.entries(incoming || {})) {
    if (!canEditDay(day, { now, openHour })) {
      const before = stored?.[day]
      if (!before || !sameMark(before, v)) locked.push(day)
      continue
    }
    days[day] = dayMark(v)
  }
  // A locked day missing from the request is simply kept (the app sends only the days it shows as editable).
  return { days: Object.fromEntries(Object.entries(days).sort(([a], [b]) => (a < b ? -1 : 1))), locked: locked.sort() }
}

/** Expected people of one night: the confirmed list when the owner confirmed it, else everyone who marked it. */
export function expectedFor(day, { availability = [], schedules = [] } = {}) {
  const confirmed = (schedules || []).find(s => s && s.day === day)
  if (confirmed && Array.isArray(confirmed.people)) {
    return { confirmed: true, people: confirmed.people.map(p => ({ id: String(p.id), nome: p.nome || '', ...dayMark(p) })) }
  }
  const people = []
  for (const row of availability || []) {
    const mark = row?.days?.[day]
    if (!mark) continue
    people.push({ id: String(row.staff_id), nome: row.staff_nome || '', ...dayMark(mark) })
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

/** UTC ms of a scheduled end: after the start (an end at or before the start is the next morning). */
export function endMs(day, start, end) {
  const e = cleanStart(end)
  if (!e || !isDayKey(day)) return null
  const [h, m] = e.split(':').map(Number)
  const [y, mo, d] = day.split('-').map(Number)
  let ms = tokyoWallToUtcMs(y, mo, d + (h < 6 ? 1 : 0), h, m)
  const begin = startMs(day, start)
  if (begin != null && ms <= begin) ms += 24 * 3600e3
  return ms
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

// ── Sending next week: the owner's rules, the deadline and the reminder ─────

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const DEFAULT_RULES = Object.freeze({ required: true, deadlineDay: 4, deadlineHour: 18, remindDays: 2, minNights: 0, needEnd: true })

const intIn = (v, lo, hi, dflt) => {
  if (v == null || v === '') return dflt
  const n = Math.round(+v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}

/**
 * The bar's rules for next week's schedule (on bar_goals):
 *   escala_obrigatoria   staff must send next week before using the app (default on)
 *   escala_prazo_dia     deadline weekday of the week before, 0 = Monday … 6 = Sunday (default Friday)
 *   escala_prazo_hora    deadline hour, Tokyo (default 18)
 *   escala_lembrete_dias days before the deadline the reminder starts (default 2; 0 = only on the day)
 *   escala_min_noites    least nights per week (default 0 = "I can't work next week" is a valid answer)
 *   escala_exigir_fim    every night needs an end time too (default on)
 */
export function scheduleRules(goals = {}) {
  const g = goals || {}
  return {
    required: g.escala_obrigatoria == null ? DEFAULT_RULES.required : g.escala_obrigatoria !== false,
    deadlineDay: intIn(g.escala_prazo_dia, 0, 6, DEFAULT_RULES.deadlineDay),
    deadlineHour: intIn(g.escala_prazo_hora, 0, 23, DEFAULT_RULES.deadlineHour),
    remindDays: intIn(g.escala_lembrete_dias, 0, 6, DEFAULT_RULES.remindDays),
    minNights: intIn(g.escala_min_noites, 0, 7, DEFAULT_RULES.minNights),
    needEnd: g.escala_exigir_fim == null ? DEFAULT_RULES.needEnd : g.escala_exigir_fim !== false,
  }
}

/** Patch for bar_goals from what the owner sends (only the fields present). */
export function cleanScheduleRules(body = {}) {
  const b = body || {}
  const out = {}
  if (b.required != null) out.escala_obrigatoria = !!b.required
  if (b.deadlineDay != null) out.escala_prazo_dia = intIn(b.deadlineDay, 0, 6, DEFAULT_RULES.deadlineDay)
  if (b.deadlineHour != null) out.escala_prazo_hora = intIn(b.deadlineHour, 0, 23, DEFAULT_RULES.deadlineHour)
  if (b.remindDays != null) out.escala_lembrete_dias = intIn(b.remindDays, 0, 6, DEFAULT_RULES.remindDays)
  if (b.minNights != null) out.escala_min_noites = intIn(b.minNights, 0, 7, DEFAULT_RULES.minNights)
  if (b.needEnd != null) out.escala_exigir_fim = !!b.needEnd
  return out
}

/** Next week (Monday → Sunday) seen from a bar night. */
export function nextWeekOf(today = tokyoNightKey()) {
  const from = addDays(today, 7 - weekdayMon(today))
  return { from, to: addDays(from, 6) }
}

/** UTC ms of the deadline to send the week starting `weekFrom` (a weekday + hour of the week before). */
export function deadlineMs(weekFrom, rules = DEFAULT_RULES) {
  const day = addDays(weekFrom, -7 + rules.deadlineDay)
  const [y, m, d] = day.split('-').map(Number)
  return tokyoWallToUtcMs(y, m, d, rules.deadlineHour, 0)
}

/** Does one week of marks follow the rules? { ok, nights, noStart: [days], noEnd: [days], tooFew } */
export function weekCheck(days = {}, { from, to, rules = DEFAULT_RULES } = {}) {
  const noStart = []
  const noEnd = []
  let nights = 0
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const mark = days?.[d]
    if (!mark) continue
    nights++
    if (!cleanStart(mark.start)) noStart.push(d)
    if (rules.needEnd && !cleanStart(mark.end)) noEnd.push(d)
  }
  const tooFew = nights < rules.minNights
  return { ok: !noStart.length && !noEnd.length && !tooFew, nights, noStart, noEnd, tooFew }
}

/**
 * Where a person stands with next week: sent or not, the deadline, and whether to remind them now.
 *   row: their staff_availability row ({ days, weeks }) or null
 */
export function submissionStatus({ row = null, rules = DEFAULT_RULES, today = tokyoNightKey(), now = new Date() } = {}) {
  const week = nextWeekOf(today)
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now)
  const deadline = deadlineMs(week.from, rules)
  const remindFrom = deadline - rules.remindDays * 24 * 3600e3
  const sent = row?.weeks?.[week.from]?.submitted_at || null
  const check = weekCheck(row?.days || {}, { ...week, rules })
  const submitted = !!sent && check.ok
  return {
    week,
    required: rules.required,
    submitted,
    submittedAt: submitted ? sent : null,
    nights: check.nights,
    deadline: new Date(deadline).toISOString(),
    msLeft: deadline - nowMs,
    overdue: !submitted && nowMs > deadline,
    remind: !submitted && nowMs >= remindFrom,
    mustSend: rules.required && !submitted,
  }
}

/** Keep only the week marks that still follow the rules (an edit after sending can undo the "sent"). */
export function validWeeks(weeks = {}, days = {}, rules = DEFAULT_RULES) {
  const out = {}
  for (const [from, v] of Object.entries(weeks || {})) {
    if (!isDayKey(from) || !v?.submitted_at) continue
    if (weekCheck(days, { from, to: addDays(from, 6), rules }).ok) out[from] = { submitted_at: v.submitted_at }
  }
  return out
}

/**
 * My shift tonight against the clock, for the countdown card.
 *   phase: 'before' (msToStart) · 'late' (not in yet, lateMinutes) · 'on' (msToEnd, lateMinutes when in late)
 *          'over' (end passed while on shift: msOver) · 'done' (clocked out) · null (nothing confirmed)
 */
export function shiftCountdown({ day, start, end, inAt = null, outAt = null, toleranceMin = DEFAULT_TOLERANCE_MIN, now = new Date() }) {
  const begin = startMs(day, start)
  if (begin == null) return null
  const finish = endMs(day, start, end)
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now)
  const tol = Math.max(0, Math.round(+toleranceMin || 0)) * 60000
  const base = { begin, finish, lateMinutes: 0 }
  if (inAt) {
    const at = Date.parse(inAt)
    const lateMinutes = at > begin + tol ? Math.round((at - begin) / 60000) : 0
    if (outAt && Date.parse(outAt) >= at) return { ...base, phase: 'done', lateMinutes }
    if (finish != null && nowMs > finish) return { ...base, phase: 'over', lateMinutes, msOver: nowMs - finish }
    const total = finish != null ? finish - Math.min(at, begin) : 0
    const pct = finish != null && total > 0 ? Math.max(0, Math.min(100, Math.round(((nowMs - Math.min(at, begin)) / total) * 100))) : null
    return { ...base, phase: 'on', lateMinutes, msToEnd: finish != null ? finish - nowMs : null, pct }
  }
  if (nowMs < begin) return { ...base, phase: 'before', msToStart: begin - nowMs }
  if (finish != null && nowMs > finish) return { ...base, phase: 'missed' }
  return { ...base, phase: nowMs > begin + tol ? 'late' : 'due', lateMinutes: Math.max(0, Math.round((nowMs - begin) / 60000)) }
}

/** "2h 05m" / "12m" / "45s" for countdowns. */
export function spanLabel(ms) {
  const s = Math.max(0, Math.floor((+ms || 0) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m`
  return `${s % 60}s`
}

const pad2 = n => String(n).padStart(2, '0')

/** One-tap hour presets for a night, from the bar's opening hour (20 → 20–01, 20–03, 20–05, 21–03). */
export function timePresets(openHour = DEFAULT_OPEN_HOUR) {
  const h = Math.max(16, Math.min(23, Number(openHour) || DEFAULT_OPEN_HOUR))
  const s = `${pad2(h)}:00`
  const s1 = `${pad2((h + 1) % 24)}:00`
  return [
    { start: s, end: '01:00' },
    { start: s, end: '03:00' },
    { start: s, end: '05:00' },
    { start: s1, end: '03:00' },
  ].filter((p, i, all) => all.findIndex(q => q.start === p.start && q.end === p.end) === i)
}

/** Length of a night in hours, across midnight ("20:00"–"03:00" → 7); null without both times. */
export function nightHours(start, end) {
  if (!cleanStart(start) || !cleanStart(end)) return null
  const m = v => { const [h, mm] = v.split(':').map(Number); return h * 60 + mm }
  let len = m(end) - m(start)
  if (len <= 0) len += 24 * 60
  return Math.round(len / 6) / 10
}

/** "Copy last week": the marks of `prevWeek` moved onto `week` day by day, only on nights still editable. */
export function copyWeekMarks(days = {}, prevWeek = [], week = [], editable = new Set()) {
  const out = {}
  week.forEach((d, i) => { if (editable.has(d)) out[d] = days[prevWeek[i]] || null })
  return out
}
