/** Staff app rules: GPS on clock-in, clock-out recovery, app tabs, night summary and earnings. node scripts/staffApp.test.mjs */
import assert from 'node:assert/strict'
import {
  DEFAULT_RADIUS_M, JUSTIFICATION_MIN, clampRadius, cleanPosition, evaluatePunchGeo, geoErrorKind, punchGeoFlag, venueOf,
} from '../src/lib/clockGeo.js'
import { haversineMeters } from '../src/lib/timeClock.js'
import { CLAIM_MAX_MS, STALE_OPEN_MS, punchAllowed } from '../src/lib/clockRule.js'
import {
  STAFF_APP_SELF, barBrand, bottomTabFor, elapsedLabel, initialsOf, myClockState, staffAppTabFor, staffAppTabsFor, staffMoreItemsFor, staffMoreSections, staffBackFor,
  isStaffNotif, usesStaffApp, hoursByNight, monthHoursStats,
} from '../src/lib/staffApp.js'
import { STAFF_SELF_TABS, canOpenTab, presetAreas, staffActionAreas } from '../src/lib/barAccess.js'
import { daysBetween, earningsByDay, earningsRange, myGoalStatus, myNightSummary, statementInRange } from '../src/lib/staffNight.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`) }

// Shibuya crossing and points around it.
const BAR = { lat: 35.659482, lng: 139.700553, geofence_m: 150 }
const venue = venueOf(BAR)
const north = m => ({ lat: BAR.lat + m / 111_320, lng: BAR.lng })

test('haversine: 1 km north is ~1000 m; same point is 0', () => {
  const p = north(1000)
  assert.ok(Math.abs(haversineMeters(BAR.lat, BAR.lng, p.lat, p.lng) - 1000) < 2)
  assert.equal(haversineMeters(BAR.lat, BAR.lng, BAR.lat, BAR.lng), 0)
  // Tokyo → Osaka is about 400 km.
  const d = haversineMeters(35.6812, 139.7671, 34.7025, 135.4959)
  assert.ok(d > 390_000 && d < 410_000, String(d))
})

test('venueOf: needs a real lat/lng; radius defaults to 150 m and stays within 50–500 m', () => {
  assert.equal(venueOf({}), null)
  assert.equal(venueOf({ lat: 0, lng: 0 }), null)
  assert.equal(venueOf({ lat: 'x', lng: 139 }), null)
  assert.equal(venueOf({ lat: 95, lng: 139 }), null)
  assert.deepEqual(venueOf({ lat: '35.1', lng: '139.2' }), { lat: 35.1, lng: 139.2, radius_m: DEFAULT_RADIUS_M })
  assert.equal(clampRadius(10), 50)
  assert.equal(clampRadius(9000), 500)
  assert.equal(clampRadius(null), 150)
  assert.equal(venueOf({ ...BAR, geofence_m: 300 }).radius_m, 300)
})

test('cleanPosition / geoErrorKind', () => {
  assert.equal(cleanPosition({ lat: null, lng: 1 }), null)
  assert.deepEqual(cleanPosition({ lat: '35', lng: '139', accuracy: '12.4' }), { lat: 35, lng: 139, accuracy: 12 })
  assert.equal(geoErrorKind(1), 'denied')
  assert.equal(geoErrorKind(2), 'unavailable')
  assert.equal(geoErrorKind(3), 'timeout')
  assert.equal(geoErrorKind('PERMISSION_DENIED'), 'denied')
  assert.equal(geoErrorKind(undefined), 'unavailable')
})

test('GPS rule: inside the radius is ok with no reason', () => {
  const r = evaluatePunchGeo({ venue, position: { ...north(80), accuracy: 20 } })
  assert.equal(r.ok, true)
  assert.equal(r.geo_status, 'ok')
  assert.equal(r.needsJustification, false)
  assert.ok(r.distance_m >= 79 && r.distance_m <= 81)
  assert.equal(r.justification, null)
})

test('GPS rule: phone accuracy counts in its favour, capped at 100 m', () => {
  assert.equal(evaluatePunchGeo({ venue, position: { ...north(200), accuracy: 60 } }).geo_status, 'ok')
  assert.equal(evaluatePunchGeo({ venue, position: { ...north(200), accuracy: 0 } }).geo_status, 'outside')
  assert.equal(evaluatePunchGeo({ venue, position: { ...north(400), accuracy: 3000 } }).geo_status, 'outside')
})

test('GPS rule: outside the radius needs a justification (server answers 400 without it)', () => {
  const r = evaluatePunchGeo({ venue, position: { ...north(600), accuracy: 10 } })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'justification_required')
  assert.equal(r.geo_status, 'outside')
  assert.match(r.error, /m from the bar/)
  const short = evaluatePunchGeo({ venue, position: north(600), justification: '  ok  ' })
  assert.equal(short.ok, false, 'fewer than 5 characters is refused')
  const good = evaluatePunchGeo({ venue, position: north(600), justification: 'Buying ice for the bar' })
  assert.equal(good.ok, true)
  assert.equal(good.geo_status, 'outside')
  assert.equal(good.justification, 'Buying ice for the bar')
  assert.ok(good.distance_m > 590)
})

test('GPS rule: denied / unavailable / timeout each need a justification', () => {
  for (const [err, status, kind] of [['denied', 'denied', 'denied'], ['unavailable', 'unavailable', 'unavailable'], ['timeout', 'unavailable', 'timeout'], [undefined, 'unavailable', 'unavailable']]) {
    const r = evaluatePunchGeo({ venue, position: null, geoError: err })
    assert.equal(r.ok, false, String(err))
    assert.equal(r.geo_status, status)
    assert.equal(r.geo_error, kind)
    const ok = evaluatePunchGeo({ venue, position: { lat: null }, geoError: err, justification: 'GPS off on my phone' })
    assert.equal(ok.ok, true)
    assert.equal(ok.geo_status, status)
  }
  assert.equal(JUSTIFICATION_MIN, 5)
})

test('GPS rule: no bar location set → punch allowed as no_venue, no reason needed', () => {
  const r = evaluatePunchGeo({ venue: null, position: null, geoError: 'denied' })
  assert.deepEqual([r.ok, r.geo_status, r.needsJustification], [true, 'no_venue', false])
  const r2 = evaluatePunchGeo({ venue: venueOf({}), position: north(5000) })
  assert.equal(r2.geo_status, 'no_venue')
})

test('punchGeoFlag: owner badge only for outside / no GPS, with the reason', () => {
  assert.equal(punchGeoFlag({ geo_status: 'ok' }), null)
  assert.equal(punchGeoFlag({ geo_status: 'no_venue' }), null)
  assert.equal(punchGeoFlag({}), null)
  assert.deepEqual(punchGeoFlag({ geo_status: 'outside', distance_m: 612.4, justification: 'Ice run' }), { status: 'outside', distance: 612, error: null, justification: 'Ice run' })
  assert.equal(punchGeoFlag({ geo_status: 'denied', geo_error: 'denied' }).distance, null)
})

test('clock-out: allowed when the server sees the open clock-in', () => {
  const now = Date.parse('2026-10-14T15:00:00Z')
  const r = punchAllowed({ tipo: 'out', last: { id: 'p1', tipo: 'in', punched_at: '2026-10-14T11:00:00Z' }, now })
  assert.deepEqual([r.ok, r.inPunchId], [true, 'p1'])
})

test('clock-out BUG: server copy is behind (no clock-in seen) → the phone\'s open clock-in closes it', () => {
  const now = Date.parse('2026-10-14T15:00:00Z')
  // Before the fix this was "Not clocked in" and the clock-out was never saved.
  const r = punchAllowed({ tipo: 'out', last: null, claim: { id: 'p9', at: '2026-10-14T11:00:00Z' }, now })
  assert.deepEqual([r.ok, r.inPunchId, r.recovered], [true, 'p9', true])
  const behind = punchAllowed({ tipo: 'out', last: { tipo: 'out', punched_at: '2026-10-13T20:00:00Z' }, claim: { id: 'p9', at: '2026-10-14T11:00:00Z' }, now })
  assert.equal(behind.ok, true)
})

test('clock-out: still refused with no open clock-in, an old claim, or a claim older than the last out', () => {
  const now = Date.parse('2026-10-14T15:00:00Z')
  assert.equal(punchAllowed({ tipo: 'out', last: null, now }).ok, false)
  assert.equal(punchAllowed({ tipo: 'out', last: null, claim: { at: new Date(now - CLAIM_MAX_MS - 1000).toISOString() }, now }).ok, false)
  assert.equal(punchAllowed({ tipo: 'out', last: { tipo: 'out', punched_at: '2026-10-14T12:00:00Z' }, claim: { at: '2026-10-14T11:00:00Z' }, now }).ok, false)
  assert.equal(punchAllowed({ tipo: 'out', last: null, claim: { at: 'not a date' }, now }).error, 'Not clocked in')
})

test('clock-in: refused while on shift; a shift open for 20h+ counts as forgotten', () => {
  const now = Date.parse('2026-10-14T15:00:00Z')
  assert.equal(punchAllowed({ tipo: 'in', last: { tipo: 'in', punched_at: '2026-10-14T11:00:00Z' }, now }).error, 'Already clocked in')
  assert.equal(punchAllowed({ tipo: 'in', last: { tipo: 'in', punched_at: new Date(now - STALE_OPEN_MS - 1).toISOString() }, now }).ok, true)
  assert.equal(punchAllowed({ tipo: 'in', last: { tipo: 'out', punched_at: '2026-10-14T11:00:00Z' }, now }).ok, true)
  assert.equal(punchAllowed({ tipo: 'in', last: null, now }).ok, true)
})

test('staff app: who gets it', () => {
  assert.equal(usesStaffApp({ role: 'bar_staff' }), true)
  assert.equal(usesStaffApp({ role: 'bar_staff', acessos: ['till', 'floor', 'clock'] }), true)
  assert.equal(usesStaffApp({ role: 'cliente', acessos: ['clock'] }), false, 'the owner never')
  assert.equal(usesStaffApp({ role: 'gerente' }, null), false)
  assert.equal(usesStaffApp({ role: 'gerente' }, presetAreas('staffOnly')), true, 'a manager login set to Staff only')
  assert.equal(usesStaffApp({ role: 'gerente' }, presetAreas('manager')), false)
  assert.equal(usesStaffApp(null), false)
})

test('staff app: bottom tabs Home · Performance · POS · Clock · More; POS/Clock follow the areas', () => {
  assert.deepEqual(staffAppTabsFor().map(t => t.id), ['hoje', 'performance', 'pos', 'ponto', 'more'])
  const staffOnly = { role: 'bar_staff', acessos: presetAreas('staffOnly') }
  const open = id => canOpenTab(staffOnly, id)
  assert.deepEqual(staffAppTabsFor(open).map(t => t.id), ['hoje', 'performance', 'ponto', 'more'])
  const more = staffMoreItemsFor(open).map(t => t.id)
  assert.ok(!more.includes('mesas') && !more.includes('pedidos'), 'no floor/supply for Staff only')
  for (const id of ['shifts', 'salary', 'reports', 'profile', 'occurrences', 'settings']) assert.ok(more.includes(id), id)
  for (const id of STAFF_APP_SELF) assert.ok(STAFF_SELF_TABS.includes(id), `${id} is a self tab`)
  for (const id of STAFF_APP_SELF) assert.equal(canOpenTab(staffOnly, id), true, id)
})

test('staff app: old pages fold into the new screens; More lights for menu screens', () => {
  assert.deepEqual(['goals', 'result', 'points', 'rewards'].map(staffAppTabFor), ['performance', 'performance', 'performance', 'performance'])
  assert.equal(staffAppTabFor('clock'), 'ponto')
  assert.equal(staffAppTabFor('pos'), 'pos')
  assert.equal(staffAppTabFor('custos'), 'hoje', 'owner screens fall back to Home')
  assert.equal(staffAppTabFor('usuarios'), 'hoje')
  assert.equal(bottomTabFor('salary'), 'more')
  assert.equal(bottomTabFor('ponto'), 'ponto')
})

test('staff app: live timer, my clock state, initials, bar brand', () => {
  assert.equal(elapsedLabel(0), '0:00:00')
  assert.equal(elapsedLabel(2 * 3600e3 + 5 * 60e3 + 9e3), '2:05:09')
  const st = myClockState([
    { id: 'a', staff_id: 'me', tipo: 'in', punched_at: '2026-10-14T10:00:00Z' },
    { id: 'b', staff_id: 'other', tipo: 'out', punched_at: '2026-10-14T12:00:00Z' },
  ], 'me')
  assert.deepEqual([st.onShift, st.since, st.openInId, st.mine.length], [true, '2026-10-14T10:00:00Z', 'a', 1])
  assert.equal(myClockState([], 'me').onShift, false)
  assert.equal(initialsOf('Atomic Bar'), 'AB')
  assert.equal(initialsOf('Ponette'), 'PO')
  assert.equal(initialsOf(''), '?')
  // Atomic's old bars.cor (a blue from the import) does not change its look: red and black until HQ picks a colour.
  assert.deepEqual(barBrand({ nome: 'Atomic Bar', cor: '#3F7F67' }), { atomic: true, theme: 'atomic', name: 'Atomic Bar', initials: 'AB', color: '#d7191f', logo: '' })
  assert.equal(barBrand({ nome: 'Atomic Bar', marca: { cor: '#3F7F67' } }).color, '#3f7f67')
  assert.equal(barBrand({ nome: 'Kuri Bar' }).atomic, false)
  assert.equal(barBrand({ id: 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9', nome: 'X' }).atomic, true)
  assert.equal(barBrand({ nome: 'X', cor: 'red; background:url(x)' }).color, '', 'only a hex colour')
  assert.equal(barBrand({ nome: 'X', logo_url: 'javascript:alert(1)' }).logo, '')
  assert.equal(barBrand({ nome: 'X', logo_url: 'https://cdn.example.com/l.png' }).logo, 'https://cdn.example.com/l.png')
})

test('my hours: per night from in/out pairs, month total and averages', () => {
  const p = [
    { staff_id: 'me', tipo: 'in', punched_at: '2026-10-13T11:00:00Z' },
    { staff_id: 'me', tipo: 'out', punched_at: '2026-10-13T17:30:00Z' },
    { staff_id: 'x', tipo: 'in', punched_at: '2026-10-14T11:00:00Z' },
    { staff_id: 'me', tipo: 'in', punched_at: '2026-10-15T10:00:00Z' },
    { staff_id: 'me', tipo: 'out', punched_at: '2026-10-15T15:00:00Z' },
  ]
  const by = hoursByNight(p, 'me', Date.parse('2026-10-18T03:00:00Z'))
  assert.deepEqual(by, { '2026-10-13': 6.5, '2026-10-15': 5 })
  const st = monthHoursStats(by, '2026-10', '2026-10-14')
  assert.equal(st.days.length, 31)
  assert.deepEqual([st.total, st.worked, st.perDay, st.longest], [6.5, 1, 6.5, 6.5], 'nights after today are not counted')
  assert.equal(st.perWeek, 3.25)
  // An open shift counts up to now; one older than 20h is a forgotten clock-out.
  assert.deepEqual(hoursByNight([{ staff_id: 'me', tipo: 'in', punched_at: '2026-10-15T11:00:00Z' }], 'me', Date.parse('2026-10-15T13:00:00Z')), { '2026-10-15': 2 })
  assert.deepEqual(hoursByNight([{ staff_id: 'me', tipo: 'in', punched_at: '2026-10-15T11:00:00Z' }], 'me', Date.parse('2026-10-17T13:00:00Z')), {})
})

test('owner inbox and day reports need the team or clock area', () => {
  for (const a of ['listRequests', 'answerRequest', 'listDayReports']) assert.deepEqual(staffActionAreas('POST', { action: a }), ['team|clock'])
})

const ME = { id: 'st1', nome: 'Aiko' }
const SALES = [
  { id: 's1', obs: 'Cast: Aiko|st1\nComm: 1200', total: 12000, criado_em: '2026-10-14T13:00:00Z' },
  { id: 's2', obs: 'Cast: Aiko', total: 5000, criado_em: '2026-10-14T14:00:00Z' },
  { id: 's3', obs: 'Cast: Ken|st2', total: 9000, criado_em: '2026-10-14T14:00:00Z' },
  { id: 's4', obs: 'Cast: Aiko|st1', total: 3000, refunded: 1000, criado_em: '2026-10-13T14:00:00Z' },
]
const ITEMS = [
  { pos_venda_id: 's1', nome: 'Highball', qtd: 3 },
  { pos_venda_id: 's1', nome: 'Lady drink', qtd: 2, for_cast: true },
  { pos_venda_id: 's2', nome: 'Highball', qtd: 1 },
  { pos_venda_id: 's2', nome: 'Lady drink', qtd: 1, forCast: true },
  { pos_venda_id: 's3', nome: 'Wine', qtd: 4 },
]

test('night summary: my tickets by id or name, what I sold and the drink-backs I drank', () => {
  const s = myNightSummary({ sales: SALES, items: ITEMS, me: ME, night: '2026-10-14' })
  assert.deepEqual([s.tickets, s.sales, s.commission, s.drinkBackCount], [2, 17000, 1200, 3])
  assert.deepEqual(s.sold, [{ nome: 'Highball', qtd: 4 }])
  assert.deepEqual(s.drinkBacks, [{ nome: 'Lady drink', qtd: 3 }])
})

test('night summary: a sale shared by two people counts half for me (shared sale-credit rule)', () => {
  const shared = [{ id: 'x1', obs: 'Cast: Aiko|st1; Ken|st2\nComm: 1001', total: 10001, criado_em: '2026-10-14T13:00:00Z' }]
  const s = myNightSummary({ sales: shared, items: [], me: ME, night: '2026-10-14' })
  assert.deepEqual([s.tickets, s.sales, s.commission, s.shared], [1, 5001, 501, 1])
  const ken = myNightSummary({ sales: shared, items: [], me: { id: 'st2', nome: 'Ken' }, night: '2026-10-14' })
  assert.equal(ken.sales + s.sales, 10001, 'shares add up to the sale')
  // An agent linked to the staff login is the same person.
  const viaAgent = [{ id: 'x2', obs: 'Cast: Aiko|ag1', total: 4000, criado_em: '2026-10-14T13:00:00Z' }]
  assert.equal(myNightSummary({ sales: viaAgent, me: ME, night: '2026-10-14', agents: [{ id: 'ag1', staff_id: 'st1' }] }).sales, 4000)
  // Nobody marked: whoever rang it up.
  const rung = [{ id: 'x3', obs: '', criado_por: 'st1', total: 2500, criado_em: '2026-10-14T13:00:00Z' }]
  assert.equal(myNightSummary({ sales: rung, me: ME, night: '2026-10-14' }).sales, 2500)
})

test('goal status: missed only when a personal night target is set and not reached', () => {
  const goals = { pessoas: [{ id: 'st1', nome: 'Aiko', noite: 20000, semana: 90000 }] }
  assert.deepEqual(myGoalStatus({ goals, meId: 'st1', mySales: 17000 }), { target: 20000, week: 90000, reached: false, missed: true, pct: 85 })
  assert.equal(myGoalStatus({ goals, meId: 'st1', mySales: 25000 }).missed, false)
  assert.equal(myGoalStatus({ goals, meId: 'nobody', mySales: 0 }).missed, false)
  assert.equal(myGoalStatus({ goals: null, meId: 'st1' }).target, 0)
})

test('earnings: ranges, per-day hours pay with late-night premium, commission and sales', () => {
  assert.deepEqual(earningsRange('day', '2026-10-14'), { from: '2026-10-14', to: '2026-10-14' })
  assert.deepEqual(earningsRange('week', '2026-10-14'), { from: '2026-10-12', to: '2026-10-18' }, 'Monday to Sunday')
  assert.deepEqual(earningsRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(earningsRange('custom', '2026-10-14', { from: '2026-10-01', to: '2026-09-01' }), { from: '2026-10-01', to: '2026-10-01' })
  assert.equal(daysBetween('2026-10-01', '2026-10-07').length, 7)
  assert.deepEqual(daysBetween('2026-10-07', '2026-10-01'), [])
  const punches = [
    { staff_id: 'st1', tipo: 'in', punched_at: '2026-10-14T10:00:00Z' }, // 19:00 JST
    { staff_id: 'st1', tipo: 'out', punched_at: '2026-10-14T16:00:00Z' }, // 01:00 JST
    { staff_id: 'st2', tipo: 'in', punched_at: '2026-10-14T10:00:00Z' },
  ]
  const e = earningsByDay({ punches, sales: SALES, me: ME, rate: 1200, from: '2026-10-13', to: '2026-10-14' })
  const d14 = e.days.find(d => d.day === '2026-10-14')
  assert.deepEqual([d14.hours, d14.lateHours, d14.hoursPay], [6, 3, 3 * 1200 + Math.round(3 * 1200 * 1.25)])
  assert.deepEqual([d14.sales, d14.commission, d14.tickets], [17000, 1200, 2])
  const d13 = e.days.find(d => d.day === '2026-10-13')
  assert.deepEqual([d13.sales, d13.hours], [2000, 0], 'refund is taken off')
  assert.equal(e.totals.earned, d14.hoursPay + 1200)
  // The whole bar's sales while I was clocked in (everyone's tickets), not only mine.
  assert.deepEqual([d14.barSales, d13.barSales, e.totals.barSales], [26000, 0, 26000])
  const noNight = earningsByDay({ punches, sales: [], me: ME, rate: 1200, nightPremium: false, from: '2026-10-14', to: '2026-10-14' })
  assert.equal(noNight.totals.hoursPay, 6 * 1200)
})

test('statementInRange: rewards add, advances and deductions take', () => {
  const lines = [
    { type: 'reward', amount: 3000, created_at: '2026-10-05T00:00:00Z' },
    { type: 'advance', amount: -10000, created_at: '2026-10-10T00:00:00Z' },
    { type: 'deduction', amount: 500, created_at: '2026-10-11T00:00:00Z' },
    { type: 'reward', amount: 9999, created_at: '2026-09-01T00:00:00Z' },
  ]
  assert.deepEqual(statementInRange(lines, '2026-10-01', '2026-10-31'), { rewards: 3000, advances: 10000, deductions: 500 })
})

test('staff bell: only the person\'s own staff notifications, never invoice / overdue / money alarms', () => {
  const rows = [
    { id: 1, tipo: 'staff_request_answer' }, { id: 2, tipo: 'staff_schedule_confirmed' }, { id: 3, tipo: 'staff_schedule_reminder' },
    { id: 4, tipo: 'staff_fine' }, { id: 5, tipo: 'staff_payout' },
    { id: 6, tipo: 'fatura_vencida' }, { id: 7, tipo: 'pedido_novo' }, { id: 8, tipo: 'ordem' }, { id: 9, tipo: 'staff_whatever' }, { id: 10 },
  ]
  assert.deepEqual(rows.filter(isStaffNotif).map(r => r.id), [1, 2, 3, 4, 5])
  assert.equal(isStaffNotif(null), false)
})


test('staff app: More menu sections (pay, work, me) keep every item once, in order; back targets', () => {
  const all = staffMoreItemsFor()
  const secs = staffMoreSections(all)
  assert.deepEqual(secs.map(s => s.id), ['pay', 'work', 'me'])
  assert.deepEqual(secs[0].items.map(i => i.id), ['salary', 'shifts'])
  assert.deepEqual(secs[2].items.map(i => i.id), ['profile', 'occurrences', 'settings'])
  assert.equal(secs.flatMap(s => s.items).length, all.length)
  assert.equal(secs[1].labelKey, 'staffApp.more.group_work')
  const staffOnly = { role: 'bar_staff', acessos: presetAreas('staffOnly') }
  const work = staffMoreSections(staffMoreItemsFor(id => canOpenTab(staffOnly, id))).find(s => s.id === 'work')
  assert.deepEqual(work.items.map(i => i.id), ['schedule', 'reports'], 'no floor/supply for Staff only')
  assert.deepEqual(staffMoreSections([]), [])
  assert.equal(staffBackFor('settings'), 'profile')
  assert.equal(staffBackFor('occurrences'), 'profile')
  assert.equal(staffBackFor('salary'), 'hoje')
  assert.equal(staffBackFor('ponto'), 'hoje')
})
console.log(`\n${n} tests passed`)
