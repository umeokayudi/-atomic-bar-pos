/**
 * Staff schedule, fines and pay math: pure rules, then /api/bar-staff end to end with a fake Supabase
 * (no network): staff save only their own availability (past nights locked), staff cannot write fines and
 * read only their own, owner/manager apply and cancel fines (audit kept), the pay hub and salary board subtract fines.
 *   node scripts/staffSchedule.test.mjs
 */
import assert from 'node:assert/strict'
import {
  addDays, attendanceFor, canEditDay, cleanDays, cleanScheduleRules, deadlineMs, endMs, expectedFor, mergeAvailability, myAttendance,
  nextWeekOf, openHourOf, scheduleBoard, scheduleRules, scheduleWeeks, scheduleWindow, shiftCountdown, spanLabel, startMs,
  submissionStatus, validWeeks, weekCheck, timePresets, nightHours, copyWeekMarks, dayMark, shiftOf,
} from '../src/lib/staffSchedule.js'
import {
  canWriteFines, cleanFine, cleanPayout, fineSettings, finesByStaff, finesTotal, finesVisibleTo, payNet, paymentHistory, suggestFine,
} from '../src/lib/staffFines.js'
import { salaryBoard } from '../src/lib/barClose.js'
import { staffActionAreas } from '../src/lib/barAccess.js'
import { tokyoNightKey, tokyoWallToUtcMs } from '../src/lib/tokyo.js'

let n = 0
const test = async (name, fn) => { await fn(); n++; console.log(`ok ${n} - ${name}`) }
const at = (y, m, d, h, min = 0) => new Date(tokyoWallToUtcMs(y, m, d, h, min))

// ── Pure: window and availability rules ─────────────────────────────────────
await test('schedule window: Monday of this week, 4 weeks; weeks start on Monday', () => {
  const w = scheduleWindow('2026-10-15') // Thursday
  assert.deepEqual(w, { from: '2026-10-12', to: '2026-11-08' })
  const weeks = scheduleWeeks(w.from, w.to)
  assert.equal(weeks.length, 4)
  assert.ok(weeks.every(wk => wk.length === 7))
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(openHourOf({}), 20)
  assert.equal(openHourOf({ abre: 18 }), 18)
  assert.equal(openHourOf({ abre: 0 }), 0)
})

await test('canEditDay: future yes; tonight only before opening; past and after-midnight never', () => {
  const afternoon = at(2026, 10, 15, 15)
  assert.equal(canEditDay('2026-10-16', { now: afternoon }), true)
  assert.equal(canEditDay('2026-10-15', { now: afternoon, openHour: 20 }), true)
  assert.equal(canEditDay('2026-10-15', { now: at(2026, 10, 15, 20, 1), openHour: 20 }), false)
  assert.equal(canEditDay('2026-10-14', { now: afternoon }), false)
  // 02:00 on the 16th is still the night of the 15th: locked.
  assert.equal(canEditDay('2026-10-15', { now: at(2026, 10, 16, 2) }), false)
  assert.equal(canEditDay('bad', { now: afternoon }), false)
})

await test('mergeAvailability: past/locked nights keep stored value, editable nights take the request', () => {
  const now = at(2026, 10, 15, 15)
  const win = scheduleWindow('2026-10-15')
  const stored = { '2026-10-13': { start: '20:00' }, '2026-10-16': { start: '21:00' }, '2026-09-01': { start: '19:00' } }
  const incoming = cleanDays({ '2026-10-13': { start: '' }, '2026-10-12': {}, '2026-10-17': { start: '22:00' }, '2026-10-15': { start: '25:00' }, '2027-01-01': {} }, win)
  assert.ok(!('2027-01-01' in incoming), 'outside the window is dropped')
  assert.equal(incoming['2026-10-15'].start, '', 'bad time cleaned')
  const r = mergeAvailability(stored, incoming, { ...win, now, openHour: 20 })
  assert.deepEqual(r.days['2026-10-13'], { start: '20:00' }, 'past night unchanged')
  assert.ok(!('2026-10-12' in r.days), 'cannot add a past night')
  assert.ok(!('2026-10-16' in r.days), 'editable night removed when not sent')
  assert.deepEqual(r.days['2026-10-17'], { start: '22:00' })
  assert.deepEqual(r.days['2026-10-15'], { start: '' }, 'tonight before opening can be added')
  assert.deepEqual(r.days['2026-09-01'], { start: '19:00' }, 'history outside the window kept')
  assert.deepEqual(r.locked, ['2026-10-12', '2026-10-13'])
})

// ── Pure: expected staff, late and absent ───────────────────────────────────
const AV = [
  { staff_id: 'a', staff_nome: 'Aiko', days: { '2026-10-14': { start: '20:00' }, '2026-10-15': { start: '20:00' } } },
  { staff_id: 'k', staff_nome: 'Ken', days: { '2026-10-14': { start: '21:00' } } },
  { staff_id: 'l', staff_nome: 'Lucia', days: { '2026-10-14': { start: '' } } },
]
await test('expected staff: the confirmed list wins over the marks', () => {
  assert.deepEqual(expectedFor('2026-10-14', { availability: AV }).people.map(p => p.id), ['a', 'k', 'l'])
  const sched = [{ day: '2026-10-14', people: [{ id: 'a', nome: 'Aiko', start: '19:30' }] }]
  const e = expectedFor('2026-10-14', { availability: AV, schedules: sched })
  assert.equal(e.confirmed, true)
  assert.deepEqual(e.people, [{ id: 'a', nome: 'Aiko', start: '19:30' }])
  const board = scheduleBoard({ from: '2026-10-14', to: '2026-10-15', availability: AV, schedules: sched })
  assert.equal(board[0].count, 1)
  assert.equal(board[0].marked.length, 3)
  assert.equal(board[1].count, 1)
  assert.equal(board[1].confirmed, false)
})

await test('attendance: late after start + tolerance, absent when the night is over, missing tonight', () => {
  const punches = [
    { staff_id: 'a', tipo: 'in', punched_at: at(2026, 10, 14, 20, 8).toISOString() }, // 8 min: within 10
    { staff_id: 'k', tipo: 'in', punched_at: at(2026, 10, 14, 21, 25).toISOString() }, // 25 min late
  ]
  const expected = expectedFor('2026-10-14', { availability: AV }).people
  const rows = attendanceFor({ day: '2026-10-14', expected, punches, toleranceMin: 10, now: at(2026, 10, 15, 15) })
  const by = Object.fromEntries(rows.map(r => [r.id, r]))
  assert.equal(by.a.status, 'ok')
  assert.equal(by.k.status, 'late')
  assert.equal(by.k.lateMinutes, 25)
  assert.equal(by.l.status, 'absent')
  // Same night while it is still going: no clock-in yet = missing (Ken), not absent.
  const live = attendanceFor({ day: '2026-10-14', expected, punches: [punches[0]], toleranceMin: 10, now: at(2026, 10, 14, 21, 30) })
  assert.equal(live.find(r => r.id === 'k').status, 'missing')
  assert.equal(live.find(r => r.id === 'l').status, 'pending')
  // A start at 01:00 is on the next calendar day.
  assert.equal(startMs('2026-10-14', '01:00'), tokyoWallToUtcMs(2026, 10, 15, 1, 0))
  // Tolerance 30: Ken is on time.
  assert.equal(attendanceFor({ day: '2026-10-14', expected, punches, toleranceMin: 30, now: at(2026, 10, 15, 15) }).find(r => r.id === 'k').status, 'ok')
  // My attendance counts only nights the owner confirmed: a night I only marked is not work.
  assert.deepEqual(myAttendance({ meId: 'k', from: '2026-10-13', to: '2026-10-15', availability: AV, punches, now: at(2026, 10, 15, 15) }), {})
  const schedules = [{ day: '2026-10-14', people: [{ id: 'k', nome: 'Ken', start: '21:00' }] }]
  const mine = myAttendance({ meId: 'k', from: '2026-10-13', to: '2026-10-15', schedules, punches, now: at(2026, 10, 15, 15) })
  assert.deepEqual(Object.keys(mine), ['2026-10-14'])
  assert.equal(mine['2026-10-14'].status, 'late')
})

// ── Pure: fines and pay math ────────────────────────────────────────────────
await test('fine permissions: only owner/manager write; staff see only their own rows', () => {
  assert.equal(canWriteFines({ role: 'cliente' }), true)
  assert.equal(canWriteFines({ role: 'gerente' }), true)
  assert.equal(canWriteFines({ role: 'bar_staff' }), false)
  assert.equal(canWriteFines({ role: 'caixa' }), false)
  const rows = [{ staff_id: 'a', bar_id: 'b1' }, { staff_id: 'k', bar_id: 'b1' }]
  assert.deepEqual(finesVisibleTo({ id: 'a', role: 'bar_staff' }, rows).map(r => r.staff_id), ['a'])
  assert.equal(finesVisibleTo({ id: 'm', role: 'gerente', bar_id: 'b1' }, rows).length, 2)
  for (const a of ['saveFine', 'cancelFine', 'saveFineSettings', 'markSalaryPaid']) assert.deepEqual(staffActionAreas('POST', { action: a }), ['payroll'], a)
  assert.deepEqual(staffActionAreas('POST', { action: 'scheduleBoard' }), ['team|clock'])
})

await test('fine settings and suggestion: absent ¥X, late once or per N minutes, 0 = off', () => {
  const off = fineSettings({})
  assert.deepEqual(off, { absent: 0, late: 0, lateEvery: 0, tolerance: 10 })
  assert.equal(suggestFine({ status: 'absent' }, off), 0)
  const s = fineSettings({ multa_falta: 5000, multa_atraso: 1000, multa_atraso_min: 15, tolerancia_min: 5 })
  assert.equal(suggestFine({ status: 'absent' }, s), 5000)
  assert.equal(suggestFine({ status: 'late', lateMinutes: 25 }, s), 2000)
  assert.equal(suggestFine({ status: 'late', lateMinutes: 10 }, s), 1000)
  assert.equal(suggestFine({ status: 'late', lateMinutes: 25 }, { ...s, lateEvery: 0 }), 1000)
  assert.equal(suggestFine({ status: 'ok' }, s), 0)
  assert.ok(cleanFine({ staff_id: 'a', day: '2026-10-14', amount: 0 }).error)
  assert.ok(cleanFine({ staff_id: 'a', day: '2026-10-20', amount: 100 }, { today: '2026-10-15' }).error, 'no future fines')
  assert.equal(cleanFine({ staff_id: 'a', day: '2026-10-14', amount: '1500', type: 'weird' }).fine.type, 'other')
})

await test('pay math: net = gross − fines − advances (cancelled fines ignored)', () => {
  const fines = [
    { staff_id: 'a', day: '2026-10-03', amount: 2000 },
    { staff_id: 'a', day: '2026-10-09', amount: 1000, status: 'cancelled' },
    { staff_id: 'k', day: '2026-10-09', amount: 500 },
    { staff_id: 'a', day: '2026-09-30', amount: 700 },
  ]
  assert.equal(finesTotal(fines, { staffId: 'a', from: '2026-10-01', to: '2026-10-31' }), 2000)
  assert.deepEqual(finesByStaff(fines, { from: '2026-10-01', to: '2026-10-31' }), { a: 2000, k: 500 })
  assert.deepEqual(payNet({ hoursPay: 50000, commission: 8000, rewards: 2000, fines: 2000, advances: 10000 }), { gross: 60000, taken: 12000, fines: 2000, advances: 10000, deductions: 0, net: 48000 })
  // Salary board: fines of the month only, advances per person.
  const board = salaryBoard({
    payroll: [{ staff_id: 'a', nome: 'Aiko', pay: 50000, hours: 30 }, { staff_id: 'k', nome: 'Ken', pay: 20000, hours: 15 }],
    tickets: [], monthKey: '2026-10', fines, advances: { a: 10000 },
    payouts: [{ staff_id: 'k', month: '2026-10', net: 19500, paid_at: '2026-10-25T10:00:00Z' }],
  })
  const by = Object.fromEntries(board.rows.map(r => [r.id, r]))
  assert.equal(by.a.gross, 50000)
  assert.equal(by.a.fines, 2000)
  assert.equal(by.a.net, 38000)
  assert.equal(by.k.net, 19500)
  assert.ok(by.k.paid && !by.a.paid)
  assert.equal(board.net, 57500)
  assert.equal(board.fines, 2500)
  assert.equal(board.total, 70000, 'hours pay total unchanged')
  const p = cleanPayout({ month: '2026-10', staff_id: 'a', pay: 50000, comm: 1000, fines: 2000, advances: 3000 })
  assert.equal(p.payout.net, 46000)
  assert.ok(cleanPayout({ month: 'x', staff_id: 'a' }).error)
})

await test('payment history: bar payouts first, HQ approved/paid periods fill the gaps, last N oldest first', () => {
  const h = paymentHistory({
    payouts: [{ month: '2026-09', gross: 100, fines: 10, advances: 0, net: 90, paid_at: '2026-09-25' }, { month: '2026-08', net: 1, status: 'cancelled' }],
    periods: [{ month: '2026-09', status: 'paid', gross: 999, net: 999 }, { month: '2026-08', status: 'paid', gross: 200, taken: 20, net: 180 }, { month: '2026-07', status: 'draft', net: 5 }],
    limit: 12,
  })
  assert.deepEqual(h.map(r => [r.month, r.net, r.source]), [['2026-08', 180, 'hq'], ['2026-09', 90, 'bar']])
  assert.equal(paymentHistory({ payouts: Array.from({ length: 20 }, (_, i) => ({ month: `2025-${String((i % 12) + 1).padStart(2, '0')}`, net: i })), limit: 6 }).length, 6)
})

// ── Pure: end times, next week's rules, deadline, reminder, countdown ───────
await test('end time: kept only when set; an end before the start is the next morning', () => {
  const d = cleanDays({ '2026-10-20': { start: '20:00', end: '02:00' }, '2026-10-21': { start: '21:00', end: 'x' } }, { from: '2026-10-19', to: '2026-10-25' })
  assert.deepEqual(d['2026-10-20'], { start: '20:00', end: '02:00' })
  assert.deepEqual(d['2026-10-21'], { start: '21:00' })
  assert.equal(endMs('2026-10-20', '20:00', '02:00') - startMs('2026-10-20', '20:00'), 6 * 3600e3)
  assert.equal(endMs('2026-10-20', '18:00', '23:30') - startMs('2026-10-20', '18:00'), 5.5 * 3600e3)
  const r = mergeAvailability({ '2026-10-20': { start: '20:00' } }, { '2026-10-20': { start: '20:00', end: '03:00' } }, { now: at(2026, 10, 25, 15) })
  assert.deepEqual(r.locked, ['2026-10-20'], 'changing only the end of a locked night is refused too')
})

await test('rules: defaults, owner patch clamped; next week and its deadline', () => {
  assert.deepEqual(scheduleRules({}), { required: true, deadlineDay: 4, deadlineHour: 18, remindDays: 2, minNights: 0, needEnd: true })
  const patch = cleanScheduleRules({ required: false, deadlineDay: 9, deadlineHour: 21, remindDays: 3, minNights: 2, needEnd: false })
  assert.deepEqual(patch, { escala_obrigatoria: false, escala_prazo_dia: 6, escala_prazo_hora: 21, escala_lembrete_dias: 3, escala_min_noites: 2, escala_exigir_fim: false })
  assert.equal(scheduleRules(patch).required, false)
  assert.deepEqual(nextWeekOf('2026-10-15'), { from: '2026-10-19', to: '2026-10-25' })
  assert.deepEqual(nextWeekOf('2026-10-19'), { from: '2026-10-26', to: '2026-11-01' }, 'on Monday, next week is the following one')
  // Default: Friday 18:00 of the week before.
  assert.equal(deadlineMs('2026-10-19', scheduleRules({})), tokyoWallToUtcMs(2026, 10, 16, 18, 0))
})

await test('weekCheck + submission: start/end on every night, least nights, sent flag, reminder window, overdue', () => {
  const rules = scheduleRules({ escala_min_noites: 2 })
  const wk = { from: '2026-10-19', to: '2026-10-25', rules }
  assert.equal(weekCheck({ '2026-10-20': { start: '20:00', end: '02:00' } }, wk).tooFew, true)
  const c = weekCheck({ '2026-10-20': { start: '20:00', end: '02:00' }, '2026-10-21': { start: '20:00' } }, wk)
  assert.deepEqual(c.noEnd, ['2026-10-21'])
  assert.equal(c.ok, false)
  const days = { '2026-10-20': { start: '20:00', end: '02:00' }, '2026-10-22': { start: '21:00', end: '03:00' } }
  assert.equal(weekCheck(days, wk).ok, true)
  // Wednesday 15:00: before the reminder window (Fri 18:00 − 2 days = Wed 18:00).
  let st = submissionStatus({ row: { days }, rules, today: '2026-10-14', now: at(2026, 10, 14, 15) })
  assert.equal(st.mustSend, true)
  assert.equal(st.remind, false)
  st = submissionStatus({ row: { days }, rules, today: '2026-10-14', now: at(2026, 10, 14, 19) })
  assert.equal(st.remind, true)
  st = submissionStatus({ row: { days }, rules, today: '2026-10-16', now: at(2026, 10, 16, 19) })
  assert.equal(st.overdue, true)
  st = submissionStatus({ row: { days, weeks: { '2026-10-19': { submitted_at: 'x' } } }, rules, today: '2026-10-16', now: at(2026, 10, 16, 19) })
  assert.equal(st.submitted, true)
  assert.equal(st.mustSend, false)
  assert.equal(st.remind, false)
  // Owner turned the rule off: nothing blocks.
  assert.equal(submissionStatus({ row: null, rules: scheduleRules({ escala_obrigatoria: false }), today: '2026-10-14' }).mustSend, false)
  // Editing a sent week into something invalid drops the "sent".
  assert.deepEqual(Object.keys(validWeeks({ '2026-10-19': { submitted_at: 'x' } }, days, rules)), ['2026-10-19'])
  assert.deepEqual(validWeeks({ '2026-10-19': { submitted_at: 'x' } }, { '2026-10-20': days['2026-10-20'] }, rules), {})
})

await test('countdown: before start, late not in, came late, time left, over, done', () => {
  const s = { day: '2026-10-20', start: '20:00', end: '02:00', toleranceMin: 10 }
  let c = shiftCountdown({ ...s, now: at(2026, 10, 20, 18, 30) })
  assert.equal(c.phase, 'before')
  assert.equal(spanLabel(c.msToStart), '1h 30m')
  assert.equal(shiftCountdown({ ...s, now: at(2026, 10, 20, 20, 5) }).phase, 'due', 'inside the tolerance')
  c = shiftCountdown({ ...s, now: at(2026, 10, 20, 20, 25) })
  assert.equal(c.phase, 'late')
  assert.equal(c.lateMinutes, 25)
  c = shiftCountdown({ ...s, inAt: at(2026, 10, 20, 20, 20).toISOString(), now: at(2026, 10, 20, 23) })
  assert.equal(c.phase, 'on')
  assert.equal(c.lateMinutes, 20)
  assert.equal(spanLabel(c.msToEnd), '3h 00m')
  assert.ok(c.pct > 40 && c.pct < 60)
  c = shiftCountdown({ ...s, inAt: at(2026, 10, 20, 19, 55).toISOString(), now: at(2026, 10, 21, 2, 30) })
  assert.equal(c.phase, 'over')
  assert.equal(c.lateMinutes, 0)
  c = shiftCountdown({ ...s, inAt: at(2026, 10, 20, 19, 55).toISOString(), outAt: at(2026, 10, 21, 2).toISOString(), now: at(2026, 10, 21, 2, 30) })
  assert.equal(c.phase, 'done')
  assert.equal(shiftCountdown({ ...s, now: at(2026, 10, 21, 3) }).phase, 'missed')
  assert.equal(shiftCountdown({ day: '2026-10-20', start: '' }), null)
})

// ── /api/bar-staff end to end (fake Supabase, live tables in memory) ────────
process.env.VITE_SUPABASE_URL = 'http://supabase.test'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'
const BAR = '00000000-0000-4000-8000-0000000000b1'
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.pathname.startsWith('/storage/v1/')) {
    if ((init.method || 'GET') === 'GET') return json(404, { statusCode: '404', error: 'not_found', message: 'Object not found' })
    return json(200, { Key: 'ok' })
  }
  const table = url.pathname.split('/rest/v1/')[1]
  return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` })
}
const { signLanePayload } = await import('../api/_hash.js')
const { default: handler } = await import('../api/_routeBarStaff.js')
const P = {
  aiko: { id: 's-aiko', nome: 'Aiko', role: 'bar_staff', bar_id: BAR },
  ken: { id: 's-ken', nome: 'Ken', role: 'bar_staff', bar_id: BAR },
  boss: { id: 'o-boss', nome: 'Owner', role: 'cliente', bar_id: BAR },
  mgr: { id: 'g-mgr', nome: 'Manager', role: 'gerente', bar_id: BAR },
}
async function call(who, body) {
  const token = signLanePayload({ id: who.id, email: `${who.id}@x.test`, nome: who.nome, role: who.role, bar_id: who.bar_id, exp: Date.now() + 3600e3 })
  const req = { method: 'POST', body, query: {}, headers: { authorization: `Bearer ${token}` } }
  let status = 200
  let payload = null
  const res = { status(c) { status = c; return this }, json(o) { payload = o; return this }, end() { return this } }
  await handler(req, res)
  return { status, body: payload }
}
const tonight = tokyoNightKey()
const win = scheduleWindow(tonight)
const tomorrow = addDays(tonight, 1)
const yesterday = addDays(tonight, -1)

await test('API availability: staff saves only own row; a body staff_id is ignored; past nights stay locked', async () => {
  let r = await call(P.aiko, { action: 'meSaveAvailability', days: { [tomorrow]: { start: '20:00' }, [addDays(tonight, 3)]: { start: '' } }, staff_id: P.ken.id })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(Object.keys(r.body.days).sort(), [tomorrow, addDays(tonight, 3)].sort())
  r = await call(P.ken, { action: 'meAvailability' })
  assert.deepEqual(r.body.days, {}, 'Ken does not see Aiko\'s days as his')
  r = await call(P.aiko, { action: 'meAvailability' })
  assert.equal(r.body.from, win.from)
  assert.equal(r.body.days[tomorrow].start, '20:00')
  assert.ok(r.body.editable.includes(tomorrow))
  if (yesterday >= win.from) {
    r = await call(P.aiko, { action: 'meSaveAvailability', days: { [yesterday]: { start: '20:00' }, [tomorrow]: { start: '21:00' } } })
    assert.equal(r.status, 200)
    assert.ok(r.body.locked.includes(yesterday))
    assert.ok(!(yesterday in r.body.days), 'a past night cannot be added')
    assert.equal(r.body.days[tomorrow].start, '21:00')
  }
})

await test('API fines: staff cannot write or list the bar\'s fines; owner applies, staff reads only own', async () => {
  let r = await call(P.aiko, { action: 'saveFine', staff_id: P.aiko.id, day: tonight, amount: 1000, type: 'late' })
  assert.equal(r.status, 403)
  r = await call(P.aiko, { action: 'listFines' })
  assert.equal(r.status, 403)
  r = await call(P.boss, { action: 'saveFine', staff_id: P.ken.id, staff_nome: 'Ken', day: tonight, amount: 3000, type: 'absent', note: 'No show' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const kenFine = r.body.fine
  assert.equal(kenFine.created_by, P.boss.id)
  r = await call(P.mgr, { action: 'saveFine', staff_id: P.aiko.id, day: tonight, amount: 500, type: 'late', late_minutes: 15 })
  assert.equal(r.status, 200)
  r = await call(P.boss, { action: 'saveFine', staff_id: P.aiko.id, day: tomorrow, amount: 500 })
  assert.equal(r.status, 400, 'no fine for a future night')
  r = await call(P.aiko, { action: 'meEarnings', from: tonight, to: tonight })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body.fines.map(f => f.amount), [500], 'Aiko sees only her fine')
  assert.equal(r.body.finesTotal, 500)
  r = await call(P.mgr, { action: 'listFines', from: tonight, to: tonight })
  assert.equal(r.body.fines.length, 2)
  // Cancel keeps the row with who/when.
  r = await call(P.aiko, { action: 'cancelFine', id: kenFine.id })
  assert.equal(r.status, 403)
  r = await call(P.mgr, { action: 'cancelFine', id: kenFine.id, note: 'He called in sick' })
  assert.equal(r.status, 200)
  assert.equal(r.body.fine.status, 'cancelled')
  assert.equal(r.body.fine.cancelled_by, P.mgr.id)
  assert.ok(r.body.fine.cancelled_at)
  r = await call(P.ken, { action: 'meEarnings', from: tonight, to: tonight })
  assert.equal(r.body.fines.length, 1, 'still listed (audit)')
  assert.equal(r.body.fines[0].status, 'cancelled')
  assert.equal(r.body.finesTotal, 0, 'not deducted')
})

await test('API schedule board + confirm, fine settings, salary paid (fines counted on the server)', async () => {
  let r = await call(P.aiko, { action: 'confirmSchedule', day: tomorrow, people: [] })
  assert.equal(r.status, 403)
  r = await call(P.mgr, { action: 'confirmSchedule', day: tomorrow, people: [{ id: P.aiko.id, nome: 'Aiko', start: '19:30' }, { id: P.aiko.id }] })
  assert.equal(r.status, 200)
  assert.equal(r.body.schedule.people.length, 1)
  r = await call(P.boss, { action: 'scheduleBoard', from: win.from, to: win.to })
  assert.equal(r.status, 200)
  assert.ok(r.body.availability.some(a => a.staff_id === P.aiko.id))
  assert.equal(r.body.schedules[0].day, tomorrow)
  r = await call(P.aiko, { action: 'meAvailability' })
  assert.deepEqual(r.body.confirmed[tomorrow], { in: true, start: '19:30' })
  r = await call(P.aiko, { action: 'saveFineSettings', multa_falta: 9 })
  assert.equal(r.status, 403)
  r = await call(P.boss, { action: 'saveFineSettings', multa_falta: 5000, multa_atraso: 1000, tolerancia_min: 15 })
  assert.equal(r.status, 200)
  assert.equal(r.body.settings.absent, 5000)
  r = await call(P.boss, { action: 'scheduleBoard' })
  assert.equal(r.body.settings.tolerance, 15)
  const month = tonight.slice(0, 7)
  r = await call(P.aiko, { action: 'markSalaryPaid', month, staff_id: P.aiko.id, pay: 1 })
  assert.equal(r.status, 403)
  r = await call(P.boss, { action: 'markSalaryPaid', month, staff_id: P.aiko.id, staff_nome: 'Aiko', pay: 40000, comm: 2000, fines: 0, advances: 5000 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.payout.fines, 500, 'server counts the fine, not the screen\'s 0')
  assert.equal(r.body.payout.net, 40000 + 2000 - 500 - 5000)
  r = await call(P.aiko, { action: 'mePayouts' })
  assert.equal(r.body.payouts.length, 1)
  r = await call(P.ken, { action: 'mePayouts' })
  assert.equal(r.body.payouts.length, 0, 'Ken does not see Aiko\'s payment')
})

await test('API next week: send needs start+end; the status, rules and owner reminder', async () => {
  const nw = nextWeekOf(tonight)
  const d1 = nw.from
  const d2 = addDays(nw.from, 2)
  let r = await call(P.ken, { action: 'meAvailability' })
  assert.equal(r.status, 200)
  assert.equal(r.body.status.mustSend, true, 'required by default')
  assert.equal(r.body.rules.needEnd, true)
  r = await call(P.ken, { action: 'meSaveAvailability', days: { [d1]: { start: '20:00' } }, submitWeek: nw.from })
  assert.equal(r.status, 400, 'no end time')
  r = await call(P.ken, { action: 'meSaveAvailability', days: { [d1]: { start: '20:00', end: '02:00' }, [d2]: { start: '21:00', end: '03:00' } }, submitWeek: nw.from })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.ok(r.body.weeks[nw.from].submitted_at)
  assert.equal(r.body.status.submitted, true)
  r = await call(P.ken, { action: 'meAvailability' })
  assert.equal(r.body.status.mustSend, false)
  assert.deepEqual(r.body.days[d1], { start: '20:00', end: '02:00' })
  // Owner sets rules (min 3 nights): Ken's week no longer follows them, so it counts as not sent.
  r = await call(P.ken, { action: 'saveScheduleRules', minNights: 3 })
  assert.equal(r.status, 403)
  r = await call(P.boss, { action: 'saveScheduleRules', minNights: 3, deadlineDay: 3, deadlineHour: 20, remindDays: 1 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.rules.minNights, 3)
  r = await call(P.ken, { action: 'meAvailability' })
  assert.equal(r.body.status.mustSend, true)
  r = await call(P.boss, { action: 'scheduleBoard' })
  assert.equal(r.body.rules.deadlineDay, 3)
  assert.deepEqual(r.body.nextWeek, nw)
  assert.ok(r.body.availability.find(a => a.staff_id === P.ken.id).weeks[nw.from])
  r = await call(P.ken, { action: 'remindSchedule', staff_ids: [P.aiko.id] })
  assert.equal(r.status, 403)
  r = await call(P.mgr, { action: 'remindSchedule', staff_ids: [P.ken.id, P.ken.id] })
  assert.equal(r.status, 200)
  // Confirm with an end time: the staff app gets it for the countdown.
  r = await call(P.mgr, { action: 'confirmSchedule', day: d1, people: [{ id: P.ken.id, nome: 'Ken', start: '20:00', end: '02:00' }] })
  assert.equal(r.status, 200)
  r = await call(P.ken, { action: 'meAvailability' })
  if (d1 <= r.body.to) assert.deepEqual(r.body.confirmed[d1], { in: true, start: '20:00', end: '02:00' })
  assert.equal(typeof r.body.tolerance, 'number')
  await call(P.boss, { action: 'saveScheduleRules', minNights: 0 })
})

await test('schedule screen helpers: hour presets from the opening hour, night length, copy last week', () => {
  assert.deepEqual(timePresets(20), [{ start: '20:00', end: '01:00' }, { start: '20:00', end: '03:00' }, { start: '20:00', end: '05:00' }, { start: '21:00', end: '03:00' }])
  assert.equal(timePresets(19)[0].start, '19:00')
  assert.equal(timePresets(undefined)[0].start, '20:00')
  for (const p of timePresets(22)) assert.ok(weekCheck({ '2026-10-19': p }, { from: '2026-10-19', to: '2026-10-25' }).ok, 'every preset passes the start+end rule')
  assert.equal(nightHours('20:00', '03:00'), 7)
  assert.equal(nightHours('21:00', '01:30'), 4.5)
  assert.equal(nightHours('20:00', ''), null)
  const prev = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
  const week = prev.map(d => addDays(d, 7))
  const days = { '2026-10-13': { start: '20:00', end: '02:00' }, '2026-10-17': { start: '21:00', end: '03:00' }, '2026-10-21': { start: '20:00', end: '01:00' } }
  const editable = new Set(week.slice(1))
  const out = copyWeekMarks(days, prev, week, editable)
  assert.deepEqual(out['2026-10-20'], { start: '20:00', end: '02:00' })
  assert.deepEqual(out['2026-10-24'], { start: '21:00', end: '03:00' })
  assert.equal(out['2026-10-21'], null, 'a night off last week clears this week')
  assert.ok(!('2026-10-19' in out), 'locked nights are left alone')
})

console.log(`\n${n} tests passed`)

await test('day shift / night shift: the mark keeps the shift, day presets, older marks are nights', () => {
  assert.deepEqual(dayMark({ start: '10:00', end: '18:00', shift: 'day' }), { start: '10:00', end: '18:00', shift: 'day' })
  assert.deepEqual(dayMark({ start: '20:00', end: '03:00', shift: 'night' }), { start: '20:00', end: '03:00' })
  assert.deepEqual(dayMark({ start: '20:00', shift: 'evil' }), { start: '20:00' })
  assert.equal(shiftOf({ start: '20:00' }), 'night')
  assert.equal(shiftOf({ start: '10:00', shift: 'day' }), 'day')
  assert.deepEqual(timePresets(20, 'day')[0], { start: '10:00', end: '18:00' })
  assert.deepEqual(timePresets(20)[0], { start: '20:00', end: '01:00' })
  assert.equal(nightHours('10:00', '18:00'), 8)
  // A day shift that ends at midnight ends on the next calendar day.
  assert.equal(endMs('2026-10-14', '16:00', '00:00') - startMs('2026-10-14', '16:00'), 8 * 3600e3)
})

