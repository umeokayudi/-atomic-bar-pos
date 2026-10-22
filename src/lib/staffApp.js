/**
 * The employee app: a separate, phone-first shell for staff logins (no HQ sidebar).
 * Pure: which logins get it, its bottom tabs, the full-screen "More" menu, and where the old "My …" pages live.
 */

import { presetFor } from './barAccess.js'
import { tokyoNightKey } from './tokyo.js'

const ATOMIC_BAR_ID = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'

/** Bottom tabs, in order. `id` is the /bar/<tab> path that opens it; 'more' opens the full-screen menu. */
export const STAFF_APP_TABS = [
  { id: 'hoje', icon: 'home', labelKey: 'staffApp.tabHome' },
  { id: 'performance', icon: 'result', labelKey: 'staffApp.tabPerformance' },
  { id: 'pos', icon: 'pos', labelKey: 'staffApp.tabPos', needs: 'pos' },
  { id: 'ponto', icon: 'clock', labelKey: 'staffApp.tabClock', needs: 'ponto' },
  { id: 'more', icon: 'menu', labelKey: 'staffApp.tabMore' },
]

/** Screens in the full-screen "More" menu. Work screens show only when "Users & access" allows them. */
export const STAFF_MORE_ITEMS = [
  { id: 'salary', icon: 'salary', labelKey: 'staffApp.more.earnings', group: 'pay' },
  { id: 'schedule', icon: 'calendar', labelKey: 'staffApp.more.schedule', group: 'work' },
  { id: 'shifts', icon: 'shifts', labelKey: 'staffApp.more.shifts', group: 'pay' },
  { id: 'reports', icon: 'send', labelKey: 'staffApp.more.reports', group: 'work' },
  { id: 'profile', icon: 'profile', labelKey: 'staffApp.more.profile', group: 'me' },
  { id: 'occurrences', icon: 'occurrences', labelKey: 'staffApp.more.occurrences', group: 'me' },
  { id: 'mesas', icon: 'mesas', labelKey: 'staffApp.more.floor', needs: 'mesas', group: 'work' },
  { id: 'pedidos', icon: 'pedidos', labelKey: 'staffApp.more.supply', needs: 'pedidos', group: 'work' },
  { id: 'settings', icon: 'settings', labelKey: 'staffApp.more.settings', group: 'me' },
]

/** Section order of the More menu: money first, then the night's work, then me. */
export const STAFF_MORE_GROUPS = ['pay', 'work', 'me']

/** More menu items split into sections (empty sections left out), keeping the item order inside each. */
export function staffMoreSections(items = STAFF_MORE_ITEMS) {
  return STAFF_MORE_GROUPS
    .map(id => ({ id, labelKey: `staffApp.more.group_${id}`, items: (items || []).filter(it => (it.group || 'me') === id) }))
    .filter(s => s.items.length)
}

/** Where the header's back button goes: Settings and Occurrences open from the profile, the rest from Home. */
export function staffBackFor(screen) {
  return ['settings', 'occurrences'].includes(screen) ? 'profile' : 'hoje'
}

/** Old staff pages → the screen that holds them now. */
const FOLDED = {
  hoje: 'hoje', goals: 'performance', result: 'performance', points: 'performance', rewards: 'performance',
  performance: 'performance',
  ponto: 'ponto', clock: 'ponto',
  shifts: 'shifts', salary: 'salary', earnings: 'salary', pay: 'salary', schedule: 'schedule', availability: 'schedule', reports: 'reports', profile: 'profile', occurrences: 'occurrences', settings: 'settings',
}

/** Work screens a staff login may open from the app (only when "Users & access" allows them). */
export const STAFF_WORK_TABS = ['pos', 'mesas', 'pedidos']

/** Self-service screens of the app (no area: every login of the role may open them). */
export const STAFF_APP_SELF = ['hoje', 'performance', 'schedule', 'shifts', 'salary', 'reports', 'profile', 'occurrences', 'settings']

/** The staff app is for bar staff, and for any non-owner login set to "Staff only". */
export function usesStaffApp(perfil, acessos = perfil?.acessos) {
  if (!perfil) return false
  if (perfil.role === 'bar_staff') return true
  if (perfil.role === 'cliente') return false
  if (perfil.role === 'gerente' || perfil.role === 'caixa') return presetFor(acessos) === 'staffOnly'
  return false
}

/** Which screen a /bar/<tab> path shows; anything unknown falls back to Home. */
export function staffAppTabFor(tab) {
  if (STAFF_WORK_TABS.includes(tab)) return tab
  return FOLDED[tab] || 'hoje'
}

/** Bottom tabs this login may open (POS needs the till area, Clock the clock area). */
export function staffAppTabsFor(canOpen = () => true) {
  return STAFF_APP_TABS.filter(t => !t.needs || canOpen(t.needs))
}

export function staffMoreItemsFor(canOpen = () => true) {
  return STAFF_MORE_ITEMS.filter(t => !t.needs || canOpen(t.needs))
}

/** The bottom tab lit for a screen: screens from the More menu light "More". */
export function bottomTabFor(screen) {
  return STAFF_APP_TABS.some(t => t.id === screen) ? screen : 'more'
}

/** Live clock text: "2:05:09" from milliseconds. */
export function elapsedLabel(ms) {
  const s = Math.max(0, Math.floor((+ms || 0) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** My punches, newest first, and whether the last one leaves me on shift. */
export function myClockState(punches = [], meId) {
  const mine = (punches || [])
    .filter(p => p && (!meId || p.staff_id === meId) && p.punched_at)
    .sort((a, b) => String(b.punched_at).localeCompare(String(a.punched_at)))
  const last = mine[0] || null
  const onShift = last?.tipo === 'in'
  return { mine, last, onShift, since: onShift ? last.punched_at : null, openInId: onShift ? (last.id || null) : null }
}

/**
 * My hours per bar night from my punches: in → out pairs, each counted on the night of its clock-in.
 * A shift still open counts up to `now` (an open shift older than 20h is a forgotten clock-out: left out).
 */
export function hoursByNight(punches = [], meId, now = Date.now()) {
  const mine = (punches || [])
    .filter(p => p && (!meId || p.staff_id === meId) && p.punched_at)
    .sort((a, b) => Date.parse(a.punched_at) - Date.parse(b.punched_at))
  const out = {}
  let open = null
  const add = (inAt, ms) => {
    const key = tokyoNightKey(new Date(inAt))
    out[key] = Math.round(((out[key] || 0) + ms / 3600e3) * 100) / 100
  }
  for (const p of mine) {
    if (p.tipo === 'in') open = p
    else if (p.tipo === 'out' && open) { add(open.punched_at, Math.max(0, Date.parse(p.punched_at) - Date.parse(open.punched_at))); open = null }
  }
  if (open && now - Date.parse(open.punched_at) < 20 * 3600e3) add(open.punched_at, Math.max(0, now - Date.parse(open.punched_at)))
  return out
}

const shiftKey = (key, n) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/**
 * Hours of one calendar month (YYYY-MM), up to `today` for the current month:
 *   days: [{ day, hours }] for every day of the month · total · worked (nights with hours)
 *   perDay: average per worked night · perWeek: total / weeks elapsed (7 days, at least 1).
 */
export function monthHoursStats(byNight = {}, monthKey, today = tokyoNightKey()) {
  const [y, m] = String(monthKey).split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const first = `${monthKey}-01`
  const end = `${monthKey}-${String(last).padStart(2, '0')}`
  const days = []
  for (let d = first; d <= end; d = shiftKey(d, 1)) days.push({ day: d, hours: +byNight[d] || 0, future: d > today })
  const counted = days.filter(d => !d.future)
  const total = Math.round(counted.reduce((a, d) => a + d.hours, 0) * 100) / 100
  const worked = counted.filter(d => d.hours > 0).length
  const weeks = Math.max(1, counted.length / 7)
  return {
    days, total, worked,
    perDay: worked ? Math.round((total / worked) * 100) / 100 : 0,
    perWeek: counted.length ? Math.round((total / weeks) * 100) / 100 : 0,
    longest: Math.max(0, ...counted.map(d => d.hours)),
  }
}

/** Initials for a bar or a person with no picture: "Atomic Bar" → "AB". */
export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  const pick = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]
  return pick.toUpperCase()
}

/** The bar's look for the staff app: its logo when stored, else its initials on its colour. */
export function barBrand(bar) {
  const raw = String(bar?.cor || bar?.color || '').trim()
  const color = /^#[0-9a-f]{6}$/i.test(raw) || /^#[0-9a-f]{3}$/i.test(raw) ? raw : ''
  const logo = String(bar?.logo_url || bar?.logo || '').trim()
  const name = String(bar?.nome || '').trim()
  return {
    // Atomic's staff app has its own look: red and black, an atom mark in white lines on red.
    atomic: bar?.id === ATOMIC_BAR_ID || /\batomic\b/i.test(name),
    name,
    initials: initialsOf(bar?.nome),
    color,
    logo: /^https:\/\//.test(logo) || /^data:image\//.test(logo) ? logo : '',
  }
}

/**
 * Notification types a staff login may see in the staff app bell: only their own staff items (schedule, answers to
 * their requests, their fines and pay). Invoices, overdue bills and other owner money alarms never show there.
 */
export const STAFF_NOTIF_TYPES = {
  staff_schedule_reminder: { icon: 'calendar', tone: 'warn', tab: 'schedule' },
  staff_schedule_confirmed: { icon: 'ok', tone: 'ok', tab: 'schedule' },
  staff_request_answer: { icon: 'inbox', tone: 'info', tab: 'reports' },
  staff_fine: { icon: 'fine', tone: 'bad', tab: 'salary' },
  staff_payout: { icon: 'salary', tone: 'ok', tab: 'salary' },
}
export const isStaffNotif = n => !!n && Object.prototype.hasOwnProperty.call(STAFF_NOTIF_TYPES, n.tipo)
