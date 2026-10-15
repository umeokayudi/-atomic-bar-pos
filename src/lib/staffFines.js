/**
 * Fines (multas) for a missed or late night, the per-bar fine settings, and the pay math that subtracts them.
 * Pure: used by /api/bar-staff, the owner's schedule board and salary board, and the staff pay hub.
 *
 *   staff_fines    { id, bar_id, staff_id, staff_nome, day, type, amount, note, status: 'active'|'cancelled',
 *                    created_by, created_by_nome, created_at, cancelled_by, cancelled_by_nome, cancelled_at, cancel_note }
 *                  written only by the owner or a manager; a staff member reads only their own rows.
 *   staff_payouts  { id, bar_id, staff_id, staff_nome, month, gross, fines, advances, net, paid_at, paid_by, paid_by_nome, note }
 *                  the owner marks a month's salary paid; the staff member reads only their own rows.
 */

import { DEFAULT_TOLERANCE_MIN, isDayKey } from './staffSchedule.js'

export const FINE_TYPES = ['absent', 'late', 'other']
export const FINE_MAX = 1_000_000
export const FINE_WRITERS = new Set(['cliente', 'gerente'])

const yen = v => Math.max(0, Math.round(+v || 0))
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** Only the owner ('cliente') and managers ('gerente') may apply or cancel a fine. */
export function canWriteFines(perfil) {
  return !!perfil && FINE_WRITERS.has(perfil.role)
}

/** Rows a viewer may read: owner/manager the bar's, anyone else only their own. */
export function finesVisibleTo(viewer, rows = []) {
  if (canWriteFines(viewer)) return (rows || []).filter(r => !viewer.bar_id || !r.bar_id || r.bar_id === viewer.bar_id)
  const me = String(viewer?.id || '')
  return (rows || []).filter(r => me && String(r.staff_id) === me)
}

/**
 * Per-bar fine settings, kept on bar_goals: multa_falta (absent, ¥), multa_atraso (late, ¥),
 * multa_atraso_min (0 = once per late night, N = per started N minutes late), tolerancia_min (default 10).
 * 0 = off.
 */
export function fineSettings(goals = {}) {
  const tol = goals?.tolerancia_min
  return {
    absent: yen(goals?.multa_falta),
    late: yen(goals?.multa_atraso),
    lateEvery: Math.min(240, yen(goals?.multa_atraso_min)),
    tolerance: tol == null || tol === '' ? DEFAULT_TOLERANCE_MIN : Math.min(120, yen(tol)),
  }
}

export function cleanFineSettings(body = {}) {
  const out = {}
  if (body.multa_falta != null) out.multa_falta = Math.min(FINE_MAX, yen(body.multa_falta))
  if (body.multa_atraso != null) out.multa_atraso = Math.min(FINE_MAX, yen(body.multa_atraso))
  if (body.multa_atraso_min != null) out.multa_atraso_min = Math.min(240, yen(body.multa_atraso_min))
  if (body.tolerancia_min != null) out.tolerancia_min = Math.min(120, yen(body.tolerancia_min))
  return out
}

/** The amount to suggest for an attendance row ({ status, lateMinutes }). 0 = no suggestion. */
export function suggestFine(row, settings) {
  const s = settings || fineSettings({})
  if (!row) return 0
  if (row.status === 'absent') return s.absent
  if (row.status === 'late') {
    if (!s.late) return 0
    if (!s.lateEvery) return s.late
    const over = Math.max(1, Math.round(+row.lateMinutes || 0))
    return s.late * Math.ceil(over / s.lateEvery)
  }
  return 0
}

/** Validate a fine the owner sends. Returns { fine } or { error }. */
export function cleanFine(body = {}, { today } = {}) {
  const staffId = clip(body.staff_id, 64)
  if (!staffId) return { error: 'Pick a person' }
  const day = String(body.day || '')
  if (!isDayKey(day)) return { error: 'Pick a day' }
  if (today && day > today) return { error: 'A fine cannot be for a future day' }
  const type = FINE_TYPES.includes(body.type) ? body.type : 'other'
  const amount = Math.round(+body.amount || 0)
  if (!(amount > 0)) return { error: 'Amount must be more than ¥0' }
  if (amount > FINE_MAX) return { error: 'Amount too large' }
  return {
    fine: {
      staff_id: staffId,
      staff_nome: clip(body.staff_nome, 80),
      day,
      type,
      amount,
      note: clip(body.note, 300),
      late_minutes: type === 'late' ? Math.min(1440, yen(body.late_minutes)) : 0,
    },
  }
}

export const isActiveFine = f => !!f && f.status !== 'cancelled'

/** Sum of active fines, optionally for one person and a day range. */
export function finesTotal(fines = [], { staffId, from, to } = {}) {
  return (fines || []).reduce((sum, f) => {
    if (!isActiveFine(f)) return sum
    if (staffId != null && String(f.staff_id) !== String(staffId)) return sum
    if (from && f.day < from) return sum
    if (to && f.day > to) return sum
    return sum + yen(f.amount)
  }, 0)
}

/** Active fines grouped by person: { staffId: total }. */
export function finesByStaff(fines = [], { from, to } = {}) {
  const out = {}
  for (const f of fines || []) {
    if (!isActiveFine(f)) continue
    if (from && f.day < from) continue
    if (to && f.day > to) continue
    out[f.staff_id] = (out[f.staff_id] || 0) + yen(f.amount)
  }
  return out
}

/**
 * The one pay formula used everywhere (pay hub, salary board, mark paid):
 *   gross = hours pay + commission + rewards
 *   net   = gross − fines − advances − other deductions
 */
export function payNet({ hoursPay = 0, commission = 0, rewards = 0, fines = 0, advances = 0, deductions = 0 } = {}) {
  const gross = yen(hoursPay) + yen(commission) + yen(rewards)
  const taken = yen(fines) + yen(advances) + yen(deductions)
  return { gross, taken, fines: yen(fines), advances: yen(advances), deductions: yen(deductions), net: gross - taken }
}

/** A clean payout row for "mark salary paid". */
export function cleanPayout(body = {}) {
  const month = String(body.month || '')
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: 'month (YYYY-MM) required' }
  const staffId = clip(body.staff_id, 64)
  if (!staffId) return { error: 'Pick a person' }
  const math = payNet({ hoursPay: body.hoursPay ?? body.pay, commission: body.commission ?? body.comm, rewards: body.rewards, fines: body.fines, advances: body.advances, deductions: body.deductions })
  return {
    payout: {
      staff_id: staffId,
      staff_nome: clip(body.staff_nome, 80),
      month,
      gross: math.gross,
      fines: math.fines,
      advances: math.advances,
      deductions: math.deductions,
      net: math.net,
      note: clip(body.note, 300),
    },
  }
}

/**
 * Past payments for the chart and the list, newest last for the chart: bar payouts first, then HQ payroll
 * periods (approved/paid) for months the bar has no payout for. `limit` periods at most.
 */
export function paymentHistory({ payouts = [], periods = [], limit = 12 } = {}) {
  const byMonth = new Map()
  for (const p of payouts || []) {
    if (!p || p.status === 'cancelled' || !/^\d{4}-\d{2}$/.test(String(p.month || ''))) continue
    const prev = byMonth.get(p.month)
    if (prev && String(prev.paid_at || '') > String(p.paid_at || '')) continue
    byMonth.set(p.month, { month: p.month, gross: yen(p.gross), taken: yen(p.fines) + yen(p.advances) + yen(p.deductions), fines: yen(p.fines), net: Math.round(+p.net || 0), paidAt: p.paid_at || null, source: 'bar', status: 'paid' })
  }
  for (const p of periods || []) {
    if (!p || byMonth.has(p.month) || !['approved', 'paid'].includes(p.status)) continue
    byMonth.set(p.month, { month: p.month, gross: yen(p.gross), taken: yen(p.taken), fines: 0, net: Math.round(+p.net || 0), paidAt: p.paidAt || null, source: 'hq', status: p.status })
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-limit)
}
