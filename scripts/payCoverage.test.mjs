import assert from 'node:assert/strict'
import { bucketAgenda, coverAgenda, dateBucket, daysBetween } from '../src/lib/payCoverage.js'

const today = '2026-10-25' // Sunday
const agenda = [
  { id: 'a', amount: 100000, date: '2026-07-31', days: -86 },
  { id: 'b', amount: 50000, date: '2026-10-25', days: 0 },
  { id: 'in', amount: 80000, date: '2026-10-27', days: 2, inflow: true },
  { id: 'c', amount: 60000, date: '2026-10-28', days: 3 },
  { id: 'd', amount: 70000, date: '2026-11-10', days: 16 },
]

// No balance typed: nothing is marked.
const blind = coverAgenda(agenda, null)
assert.equal(blind.known, false)
assert.ok(blind.rows.every(r => r.status === null))
assert.equal(blind.due, 280000)

const plan = coverAgenda(agenda, 200000)
const st = Object.fromEntries(plan.rows.map(r => [r.id, r.status]))
assert.deepEqual(st, { a: 'ok', b: 'ok', in: 'in', c: 'tight', d: 'tight' })
assert.equal(plan.rows.find(r => r.id === 'c').left, 70000)
assert.equal(plan.rows.find(r => r.id === 'd').missing, 0)
assert.equal(plan.end, 200000 + 80000 - 280000)
assert.equal(plan.status, 'tight')
assert.equal(plan.firstTight.date, '2026-10-28')

const poor = coverAgenda(agenda, 120000)
assert.equal(poor.rows.find(r => r.id === 'b').status, 'short')
assert.equal(poor.rows.find(r => r.id === 'b').missing, 30000)
assert.equal(poor.rows.find(r => r.id === 'd').missing, 70000)
assert.equal(poor.status, 'short')
assert.equal(poor.missing, 80000)

// Short today even though card money later makes the month end positive.
const dip = coverAgenda([
  { id: 'x', amount: 100000, date: today, days: 0 },
  { id: 'in', amount: 200000, date: '2026-10-26', days: 1, inflow: true },
], 60000)
assert.equal(dip.status, 'short')
assert.equal(dip.missing, 40000)
assert.equal(dip.end, 160000)
assert.equal(poor.firstShort.date, '2026-10-25')

assert.equal(coverAgenda(agenda, 500000).status, 'ok')

assert.equal(dateBucket('2026-10-20', today), 'late')
assert.equal(dateBucket('2026-10-25', today), 'today')
assert.equal(dateBucket('2026-10-26', today), 'tomorrow')
// Today is Sunday, so Mon 27 Oct starts next week.
assert.equal(dateBucket('2026-10-28', today), 'nextWeek')
assert.equal(dateBucket('2026-11-10', today), 'month:2026-11')
assert.equal(dateBucket('2026-10-23', '2026-10-21'), 'week')

const groups = bucketAgenda(plan.rows, today)
assert.deepEqual(groups.map(g => g.key), ['late', 'today', 'nextWeek', 'month:2026-11'])
assert.equal(groups.find(g => g.key === 'nextWeek').due, 60000)
assert.equal(daysBetween('2026-10-20', today), 5)

console.log('payCoverage ok')
