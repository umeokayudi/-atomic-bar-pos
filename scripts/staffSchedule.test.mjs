/**
 * Staff schedule, fines and pay math: pure rules, then /api/bar-staff end to end with a fake Supabase
 * (no network): staff save only their own availability (past nights locked), staff cannot write fines and
 * read only their own, owner/manager apply and cancel fines (audit kept), the pay hub and salary board subtract fines.
 *   node scripts/staffSchedule.test.mjs
 */
import assert from 'node:assert/strict'
import {
  addDays, attendanceFor, canEditDay, cleanDays, expectedFor, mergeAvailability, myAttendance, openHourOf, scheduleBoard,
  scheduleWeeks, scheduleWindow, startMs,
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
  const mine = myAttendance({ meId: 'k', from: '2026-10-13', to: '2026-10-15', availability: AV, punches, now: at(2026, 10, 15, 15) })
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

console.log(`\n${n} tests passed`)
