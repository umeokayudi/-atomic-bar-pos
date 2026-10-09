import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  adjustmentAfterClose,
  comparePlan,
  employeeCanSee,
  groupByBar,
  hoursFromPunches,
  proposeLines,
  statementTotals,
  transitionPeriod,
  visibleLines,
} from '../src/lib/payrollCore.js'
import { shellTabIds } from '../src/lib/legacyScope.js'

const me = 'emp-1'
const other = 'emp-2'
const periodId = 'period-1'

const september = proposeLines({
  employeeId: me,
  barId: 'bar-a',
  periodId,
  baseSalary: 350000,
  hourlyRate: 2000,
  workedHours: 176,
  overtimeHours: 8,
  nightHours: 3,
  rule: {},
  commissions: [{
    amount: 42000,
    description: 'Drink back September',
    source: 'drink_back',
    source_id: 'sale-9',
    bar_id: 'bar-a',
  }],
  rewards: [{
    id: 'reward-1',
    status: 'approved',
    amount: 10000,
    title: 'Monthly goal',
    source: 'goal',
    source_id: 'goal-9',
  }],
  advances: [{ id: 'adv-1', status: 'approved', amount: 50000 }],
  deductions: [{ id: 'ded-1', status: 'draft', amount: 8000, reason: 'Not approved' }],
  occurrences: [{ id: 'occ-1', note: 'Late once' }],
  pointPenalties: [{ points: -2, reason: 'points only' }],
})

assert.equal(september.some(row => row.type === 'overtime'), false)
assert.equal(september.some(row => row.type === 'night_premium'), false)
assert.equal(september.some(row => row.type === 'deduction'), false)
assert.equal(september.some(row => row.type === 'regular_hours'), false)
const commission = september.find(row => row.type === 'commission')
assert.equal(commission.source, 'drink_back')
assert.equal(commission.source_id, 'sale-9')
assert.equal(commission.employee_id, me)
const reward = september.find(row => row.type === 'reward')
assert.equal(reward.source_id, 'reward-1')
assert.equal(reward.amount, 10000)
const totals = statementTotals(september)
assert.equal(totals.base, 350000)
assert.equal(totals.commissions, 42000)
assert.equal(totals.rewards, 10000)
assert.equal(totals.gross, 402000)
assert.equal(totals.advances, 50000)
assert.equal(totals.deductions, 0)
assert.equal(totals.net, 352000)

const paidOvertime = proposeLines({
  employeeId: me,
  periodId,
  hourlyRate: 1000,
  workedHours: 8,
  overtimeHours: 2,
  nightHours: 1,
  rule: { payHourly: true, payOvertime: true, overtimeMultiplier: 1.25, nightPremiumRate: 0.25 },
})
assert.equal(paidOvertime.find(row => row.type === 'regular_hours').amount, 8000)
assert.equal(paidOvertime.find(row => row.type === 'overtime').amount, 2500)
assert.equal(paidOvertime.find(row => row.type === 'night_premium').amount, 250)

const punches = [
  { staff_id: me, tipo: 'in', punched_at: '2026-09-01T00:00:00Z', bar_id: 'bar-a' },
  { staff_id: me, tipo: 'out', punched_at: '2026-09-01T08:00:00Z', bar_id: 'bar-a' },
  { staff_id: me, tipo: 'in', punched_at: '2026-09-02T00:00:00Z', bar_id: 'bar-b' },
  { staff_id: me, tipo: 'out', punched_at: '2026-09-02T04:00:00Z', bar_id: 'bar-b' },
]
const hours = hoursFromPunches(punches, me)
assert.equal(hours.workedHours, 12)
assert.equal(hours.byBar.length, 2)

const compared = comparePlan([
  { starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-09-01T08:00:00Z', bar_id: 'bar-a' },
  { starts_at: '2026-09-03T00:00:00Z', ends_at: '2026-09-03T08:00:00Z', bar_id: 'bar-a' },
], punches, me)
assert.equal(compared.plannedHours, 16)
assert.equal(compared.absent, 1)
assert.equal(compared.lateMinutes, 0)
assert.ok(compared.overtimeHours >= 0)

const own = visibleLines(me, [
  { employee_id: me, amount: 1 },
  { employee_id: other, amount: 99 },
])
assert.equal(own.length, 1)
assert.equal(employeeCanSee(me, { employee_id: other }), false)
assert.equal(visibleLines(me, [{ employee_id: other, amount: 99 }]).length, 0)

const bars = groupByBar([
  { employee_id: me, bar_id: 'bar-a', type: 'commission', amount: 1000 },
  { employee_id: me, bar_id: 'bar-b', type: 'commission', amount: 2000 },
])
assert.equal(bars.length, 2)
assert.equal(bars.find(b => b.barId === 'bar-b').totals.commissions, 2000)

let status = 'draft'
status = transitionPeriod(status, 'calculated')
status = transitionPeriod(status, 'approved')
status = transitionPeriod(status, 'paid')
assert.throws(() => transitionPeriod(status, 'calculated'))
const original = { id: 'line-1', employee_id: me, type: 'base_salary', amount: 350000 }
const fix = adjustmentAfterClose(
  { id: periodId, status: 'paid' },
  { employeeId: me, barId: 'bar-a', amount: -1000, description: 'Correction', createdBy: 'hq' },
)
assert.equal(original.amount, 350000)
assert.equal(fix.line.type, 'adjustment')
assert.equal(fix.line.amount, -1000)
assert.equal(fix.period.status, 'paid')
assert.equal(fix.audit.action, 'adjustment')
assert.throws(() => adjustmentAfterClose({ id: periodId, status: 'cancelled' }, { employeeId: me, amount: 1 }))

assert.ok(shellTabIds('funcionario').includes('salary'))
assert.ok(!shellTabIds('funcionario').includes('payroll'))
assert.ok(!shellTabIds('staff').includes('salary'))
assert.ok(shellTabIds('admin').includes('payroll'))
assert.ok(shellTabIds('jbm').includes('payroll'))

const sql = readFileSync('sql/payroll.sql', 'utf8')
assert.match(sql, /SET search_path = public/)
assert.match(sql, /auth\.uid\(\)/)
assert.match(sql, /employee_id = me/)
assert.match(sql, /p\.role IN \('admin', 'jbm'\)/)
assert.match(sql, /payroll_lines_read/)
assert.doesNotMatch(sql, /DELETE FROM public\.payroll_lines/)
assert.doesNotMatch(sql, /procurement_tasks/)
assert.match(sql, /period is locked/)
assert.match(sql, /'adjustment', COALESCE/)

const desk = readFileSync('src/components/EmployeeDesk.jsx', 'utf8')
assert.match(desk, /payroll_my_pack/)
assert.doesNotMatch(desk, /payroll_post_lines|payroll_adjust|payroll_transition/)

const app = readFileSync('src/App.jsx', 'utf8')
const employee = app.slice(app.indexOf('const EMPLOYEE_TABS'), app.indexOf('const STAFF_TABS'))
assert.match(employee, /procurement/)
assert.doesNotMatch(employee, /purchases/)

console.log('payroll tests passed')
