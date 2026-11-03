/** When the night shift and the day close by themselves. */

import { addDays } from './barClose.js'
import { tokyoDateKey, tokyoNightKey, tokyoParts } from './tokyo.js'

function clampHour(value, fallback) {
  const n = Math.round(+value)
  if (!Number.isFinite(n)) return fallback
  return ((n % 24) + 24) % 24
}

function clampMin(value) {
  const n = Math.round(+value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(59, n))
}

export const NIGHT_MODES = ['auto', 'alerta', 'off']
export const WARN_CHOICES = [0, 15, 30, 60]

/**
 * What happens at the night close time: 'auto' closes the night by itself (system totals, drawer not counted),
 * 'alerta' only reminds the bar to close, 'off' does nothing. Bars saved before the choice existed keep
 * auto_noite (true → auto, false → off).
 */
export function nightMode(goals = {}) {
  if (NIGHT_MODES.includes(goals.modo_noite)) return goals.modo_noite
  return goals.auto_noite === false ? 'off' : 'auto'
}

function clampWarn(value) {
  const n = Math.round(+value)
  return WARN_CHOICES.includes(n) ? n : 0
}

export function closeSettings(goals = {}) {
  const horaNoite = clampHour(goals.hora_noite, goals.fecha == null ? 5 : goals.fecha)
  const modoNoite = nightMode(goals)
  return {
    modoNoite,
    autoNoite: modoNoite === 'auto',
    avisoMin: clampWarn(goals.aviso_min),
    horaNoite,
    minNoite: clampMin(goals.min_noite),
    autoDia: goals.auto_dia !== false,
    horaDia: clampHour(goals.hora_dia, 18),
    minDia: clampMin(goals.min_dia),
    abre: clampHour(goals.abre, 20),
    corta: clampHour(goals.corta, 0),
  }
}

export function clockLabel(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Night that should already be closed, or null if the close hour has not arrived. */
export function nightKeyDue(now, hour, minute) {
  const p = tokyoParts(now)
  const nowMins = p.hour * 60 + p.minute
  const closeMins = hour * 60 + minute
  const today = tokyoDateKey(now)
  if (hour < 12) {
    if (nowMins < closeMins) return null
    if (p.hour < 6) return tokyoNightKey(now)
    return addDays(today, -1)
  }
  if (nowMins >= closeMins) return today
  return addDays(today, -1)
}

/** Calendar day that should already be closed. Before today's hour, yesterday is due. */
export function dayKeyDue(now, hour, minute) {
  const p = tokyoParts(now)
  const today = tokyoDateKey(now)
  if (p.hour * 60 + p.minute >= hour * 60 + minute) return today
  return addDays(today, -1)
}

export function shiftsDue(goals, now = new Date()) {
  const cfg = closeSettings(goals)
  const due = []
  if (cfg.autoNoite) {
    const key = nightKeyDue(now, cfg.horaNoite, cfg.minNoite)
    if (key && goals.fechou_noite !== key) due.push({ kind: 'noite', key })
  }
  if (cfg.autoDia) {
    const key = dayKeyDue(now, cfg.horaDia, cfg.minDia)
    if (key && goals.fechou_dia !== key) due.push({ kind: 'dia', key: `${key}#dia`, day: key })
  }
  return due
}

function minutesUntil(now, hour, minute) {
  const p = tokyoParts(now)
  let diff = hour * 60 + minute - (p.hour * 60 + p.minute)
  if (diff < 0) diff += 24 * 60
  return diff
}

/**
 * Banner the bar should see now about the night close, or null.
 *  - kind 'soon': the close time is within the warning minutes (alert mode, or the warning before an auto close).
 *  - kind 'due': alert mode and the close time has passed, the night is still open.
 * closedKeys: night keys already closed or counting (pos_shifts). Before 12:00 the close belongs to the night
 * that started the evening before, like nightKeyDue.
 */
export function closeAlert(goals, now = new Date(), closedKeys = new Set()) {
  const cfg = closeSettings(goals)
  if (cfg.modoNoite === 'off') return null
  const time = clockLabel(cfg.horaNoite, cfg.minNoite)
  const dueKey = nightKeyDue(now, cfg.horaNoite, cfg.minNoite)
  const left = minutesUntil(now, cfg.horaNoite, cfg.minNoite)
  if (cfg.avisoMin > 0 && left > 0 && left <= cfg.avisoMin) {
    const key = upcomingNightKey(now, cfg.horaNoite, cfg.minNoite)
    if (!closedKeys.has(key) && goals.fechou_noite !== key) return { kind: 'soon', mode: cfg.modoNoite, key, time, left }
  }
  if (cfg.modoNoite !== 'alerta' || !dueKey) return null
  if (closedKeys.has(dueKey) || goals.fechou_noite === dueKey) return null
  // Only nag for the night that just ended: after 12 hours a missed close is shown on the close screen instead.
  const since = left === 0 ? 0 : 24 * 60 - left
  if (since > 12 * 60) return null
  return { kind: 'due', mode: 'alerta', key: dueKey, time, late: since }
}

/** Night key that the next close time will close. */
function upcomingNightKey(now, hour, minute) {
  const later = new Date(now.getTime() + minutesUntil(now, hour, minute) * 60_000)
  return nightKeyDue(later, hour, minute)
}
