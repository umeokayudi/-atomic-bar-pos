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

export function closeSettings(goals = {}) {
  const horaNoite = clampHour(goals.hora_noite, goals.fecha == null ? 5 : goals.fecha)
  return {
    autoNoite: goals.auto_noite !== false,
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
