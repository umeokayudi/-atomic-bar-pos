/**
 * Operational payroll. Hours come from the existing punch list.
 * Overtime, night premium and deductions are posted only when a rule or an approval says so.
 * This file does not calculate tax, social insurance, vacation or 13th salary.
 */

import { hoursBetween, lateNightHoursBetween, pairPunches } from './timeClock.js'

export const LINE_TYPES = [
  'base_salary',
  'regular_hours',
  'overtime',
  'night_premium',
  'commission',
  'bonus',
  'reward',
  'advance',
  'deduction',
  'adjustment',
]

export const PERIOD_STATUSES = ['draft', 'calculated', 'approved', 'paid', 'cancelled']

const EARNINGS = new Set(['base_salary', 'regular_hours', 'overtime', 'night_premium', 'commission', 'bonus', 'reward'])

const NEXT_STATUS = {
  draft: ['calculated', 'cancelled'],
  calculated: ['approved', 'cancelled'],
  approved: ['paid'],
  paid: [],
  cancelled: [],
}

function round2(n) {
  return Math.round((+n || 0) * 100) / 100
}

function yen(n) {
  return Math.round(+n || 0)
}

function asPunches(punches, employeeId) {
  return (punches || []).map(p => ({
    staff_id: p.staff_id || p.employee_id || employeeId || 'me',
    tipo: p.tipo,
    punched_at: p.punched_at,
    bar_id: p.bar_id || null,
  }))
}

export function hoursFromPunches(punches, employeeId) {
  const pairs = pairPunches(asPunches(punches, employeeId)).filter(sh => !sh.open && sh.clockOut)
  let workedHours = 0
  let nightHours = 0
  const byBar = {}
  for (const sh of pairs) {
    const hours = hoursBetween(sh.clockIn.punched_at, sh.clockOut.punched_at)
    const night = lateNightHoursBetween(sh.clockIn.punched_at, sh.clockOut.punched_at)
    workedHours += hours
    nightHours += night
    const barId = sh.clockIn.bar_id || 'none'
    if (!byBar[barId]) byBar[barId] = { barId: sh.clockIn.bar_id || null, workedHours: 0, nightHours: 0 }
    byBar[barId].workedHours = round2(byBar[barId].workedHours + hours)
    byBar[barId].nightHours = round2(byBar[barId].nightHours + night)
  }
  return {
    workedHours: round2(workedHours),
    nightHours: round2(nightHours),
    byBar: Object.values(byBar),
  }
}

/** Planned shift versus punches. Late and absence stay indicators. */
export function comparePlan(plans = [], punches = [], employeeId) {
  const pairs = pairPunches(asPunches(punches, employeeId)).filter(sh => !sh.open && sh.clockOut)
  let plannedHours = 0
  let lateMinutes = 0
  let absent = 0
  let overtimeHours = 0
  for (const plan of plans) {
    const start = new Date(plan.starts_at).getTime()
    const end = new Date(plan.ends_at).getTime()
    if (!start || !end || end <= start) continue
    const planned = (end - start) / 3600000
    plannedHours += planned
    const overlap = pairs.filter(sh => {
      const inn = new Date(sh.clockIn.punched_at).getTime()
      const out = new Date(sh.clockOut.punched_at).getTime()
      return inn < end && out > start
    })
    if (!overlap.length) {
      absent += 1
      continue
    }
    const firstIn = Math.min(...overlap.map(sh => new Date(sh.clockIn.punched_at).getTime()))
    if (firstIn > start) lateMinutes += Math.round((firstIn - start) / 60000)
    const worked = overlap.reduce((sum, sh) => {
      const inn = Math.max(start, new Date(sh.clockIn.punched_at).getTime())
      const out = Math.min(end, new Date(sh.clockOut.punched_at).getTime())
      return sum + Math.max(0, (out - inn) / 3600000)
    }, 0)
    if (worked > planned) overtimeHours += worked - planned
  }
  const clock = hoursFromPunches(punches, employeeId)
  return {
    plannedHours: round2(plannedHours),
    workedHours: clock.workedHours,
    lateMinutes,
    absent,
    overtimeHours: round2(overtimeHours),
    nightHours: clock.nightHours,
    byBar: clock.byBar,
  }
}

function line(partial) {
  if (!LINE_TYPES.includes(partial.type)) throw new Error(`unknown payroll type ${partial.type}`)
  return {
    employee_id: partial.employee_id,
    bar_id: partial.bar_id || null,
    payroll_period_id: partial.payroll_period_id,
    type: partial.type,
    description: partial.description || '',
    quantity: partial.quantity == null ? null : round2(partial.quantity),
    unit_value: partial.unit_value == null ? null : yen(partial.unit_value),
    amount: yen(partial.amount),
    source: partial.source || null,
    source_id: partial.source_id || null,
    created_by: partial.created_by || null,
  }
}

/**
 * Build ledger lines. Does not pay overtime or night hours unless the rule names a rate.
 * Does not turn an occurrence or a point penalty into money.
 */
export function proposeLines({
  employeeId,
  barId = null,
  periodId,
  createdBy = null,
  rule = {},
  baseSalary = 0,
  hourlyRate = 0,
  workedHours = 0,
  overtimeHours = 0,
  nightHours = 0,
  commissions = [],
  bonuses = [],
  rewards = [],
  advances = [],
  deductions = [],
  occurrences = [],
  pointPenalties = [],
} = {}) {
  if (occurrences.length || pointPenalties.length) {
    /* kept on the call so a caller cannot confuse them with money inputs */
  }
  const rows = []
  const common = { employee_id: employeeId, bar_id: barId, payroll_period_id: periodId, created_by: createdBy }
  if (yen(baseSalary) > 0) {
    rows.push(line({
      ...common,
      type: 'base_salary',
      description: 'Base salary',
      quantity: 1,
      unit_value: baseSalary,
      amount: baseSalary,
      source: 'contract',
      source_id: employeeId,
    }))
  }
  if (rule.payHourly && yen(hourlyRate) > 0 && +workedHours > 0 && yen(baseSalary) <= 0) {
    rows.push(line({
      ...common,
      type: 'regular_hours',
      description: 'Regular hours',
      quantity: workedHours,
      unit_value: hourlyRate,
      amount: workedHours * hourlyRate,
      source: 'time_clock',
      source_id: `${periodId}:regular`,
    }))
  }
  if (rule.payOvertime === true && rule.overtimeMultiplier != null && +overtimeHours > 0 && yen(hourlyRate) > 0) {
    const unit = hourlyRate * +rule.overtimeMultiplier
    rows.push(line({
      ...common,
      type: 'overtime',
      description: 'Overtime approved by rule',
      quantity: overtimeHours,
      unit_value: unit,
      amount: overtimeHours * unit,
      source: 'time_clock',
      source_id: `${periodId}:overtime`,
    }))
  }
  if (rule.nightPremiumRate != null && +nightHours > 0 && yen(hourlyRate) > 0) {
    const unit = hourlyRate * +rule.nightPremiumRate
    rows.push(line({
      ...common,
      type: 'night_premium',
      description: 'Night premium from configured rate',
      quantity: nightHours,
      unit_value: unit,
      amount: nightHours * unit,
      source: 'time_clock',
      source_id: `${periodId}:night`,
    }))
  }
  for (const row of commissions) {
    rows.push(line({
      ...common,
      bar_id: row.bar_id || barId,
      type: 'commission',
      description: row.description || 'Commission',
      quantity: row.quantity == null ? 1 : row.quantity,
      unit_value: row.unit_value == null ? row.amount : row.unit_value,
      amount: row.amount,
      source: row.source || 'commission',
      source_id: row.source_id,
    }))
  }
  for (const row of bonuses) {
    rows.push(line({
      ...common,
      bar_id: row.bar_id || barId,
      type: 'bonus',
      description: row.description || 'Bonus',
      amount: row.amount,
      source: row.source || 'bonus',
      source_id: row.source_id,
    }))
  }
  for (const row of rewards) {
    if (row.status !== 'approved' && row.status !== 'posted') continue
    rows.push(line({
      ...common,
      bar_id: row.bar_id || barId,
      type: 'reward',
      description: row.title || row.description || 'Reward',
      amount: row.amount,
      source: row.source || 'reward',
      source_id: row.id || row.source_id,
    }))
  }
  for (const row of advances) {
    if (row.status !== 'approved' && row.status !== 'paid') continue
    rows.push(line({
      ...common,
      bar_id: row.bar_id || barId,
      type: 'advance',
      description: row.description || 'Salary advance',
      amount: -Math.abs(yen(row.amount)),
      source: 'salary_advance',
      source_id: row.id,
    }))
  }
  for (const row of deductions) {
    if (row.status !== 'approved' && row.status !== 'posted') continue
    rows.push(line({
      ...common,
      bar_id: row.bar_id || barId,
      type: 'deduction',
      description: row.reason || row.description || 'Deduction',
      amount: -Math.abs(yen(row.amount)),
      source: 'financial_deduction',
      source_id: row.id,
    }))
  }
  return rows
}

export function statementTotals(lines = []) {
  let gross = 0
  let advances = 0
  let deductions = 0
  let commissions = 0
  let bonuses = 0
  let rewards = 0
  let base = 0
  let overtime = 0
  for (const row of lines) {
    const amount = yen(row.amount)
    if (row.type === 'advance') advances += Math.abs(amount)
    else if (row.type === 'deduction') deductions += Math.abs(amount)
    else if (row.type === 'adjustment') {
      if (amount >= 0) gross += amount
      else deductions += Math.abs(amount)
    } else if (EARNINGS.has(row.type)) gross += amount
    if (row.type === 'commission') commissions += amount
    if (row.type === 'bonus') bonuses += amount
    if (row.type === 'reward') rewards += amount
    if (row.type === 'base_salary') base += amount
    if (row.type === 'overtime') overtime += amount
  }
  return {
    base,
    overtime,
    commissions,
    bonuses,
    rewards,
    gross,
    advances,
    deductions,
    net: gross - advances - deductions,
  }
}

export function transitionPeriod(current, next) {
  const allowed = NEXT_STATUS[current] || []
  if (!allowed.includes(next)) throw new Error(`cannot move payroll from ${current} to ${next}`)
  return next
}

export function lockedPeriod(status) {
  return status === 'approved' || status === 'paid' || status === 'cancelled'
}

/** A closed period only grows by a new adjustment line plus an audit row. */
export function adjustmentAfterClose(period, { employeeId, barId = null, amount, description, createdBy }) {
  if (!period || period.status === 'cancelled') throw new Error('period cannot be adjusted')
  if (!lockedPeriod(period.status) && period.status !== 'calculated' && period.status !== 'draft') {
    throw new Error('period cannot be adjusted')
  }
  const row = line({
    employee_id: employeeId,
    bar_id: barId,
    payroll_period_id: period.id,
    type: 'adjustment',
    description: description || 'Adjustment',
    amount,
    source: 'adjustment',
    source_id: null,
    created_by: createdBy,
  })
  return {
    line: row,
    audit: auditEntry({
      action: 'adjustment',
      periodId: period.id,
      employeeId,
      actorId: createdBy,
      detail: { amount: row.amount, description: row.description, previous_status: period.status },
    }),
    period,
  }
}

export function auditEntry({ action, periodId, employeeId = null, actorId = null, detail = {} }) {
  return {
    action,
    payroll_period_id: periodId || null,
    employee_id: employeeId,
    actor_id: actorId,
    detail,
  }
}

export function employeeCanSee(viewerId, row) {
  return !!viewerId && row?.employee_id === viewerId
}

export function visibleLines(viewer, lines, { hq = false } = {}) {
  if (hq) return lines || []
  return (lines || []).filter(row => employeeCanSee(viewer, row))
}

export function groupByBar(lines = []) {
  const bars = {}
  for (const row of lines) {
    const key = row.bar_id || 'none'
    if (!bars[key]) bars[key] = []
    bars[key].push(row)
  }
  return Object.entries(bars).map(([barId, rows]) => ({
    barId: barId === 'none' ? null : barId,
    lines: rows,
    totals: statementTotals(rows),
  }))
}

export function hqRows(lines = [], filters = {}) {
  const grouped = {}
  for (const row of lines) {
    if (filters.barId && row.bar_id !== filters.barId) continue
    if (filters.employeeId && row.employee_id !== filters.employeeId) continue
    const key = row.employee_id
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(row)
  }
  return Object.entries(grouped).map(([employeeId, rows]) => {
    const totals = statementTotals(rows)
    const hours = rows.filter(r => r.type === 'regular_hours' || r.type === 'overtime')
      .reduce((sum, r) => sum + (+r.quantity || 0), 0)
    return {
      employeeId,
      hours: round2(hours),
      ...totals,
      status: filters.status || null,
    }
  }).filter(row => !filters.status || row.status === filters.status)
}

export function paymentLabel(status) {
  if (status === 'approved') return 'awaiting_payment'
  return status || 'draft'
}
