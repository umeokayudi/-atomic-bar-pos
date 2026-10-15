/**
 * The employee app: a separate, phone-first shell for staff logins (no HQ sidebar).
 * Pure: which logins get it, its bottom tabs, the full-screen "More" menu, and where the old "My …" pages live.
 */

import { presetFor } from './barAccess.js'

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
  { id: 'shifts', icon: 'shifts', labelKey: 'staffApp.more.shifts' },
  { id: 'salary', icon: 'salary', labelKey: 'staffApp.more.earnings' },
  { id: 'reports', icon: 'send', labelKey: 'staffApp.more.reports' },
  { id: 'profile', icon: 'profile', labelKey: 'staffApp.more.profile' },
  { id: 'occurrences', icon: 'occurrences', labelKey: 'staffApp.more.occurrences' },
  { id: 'mesas', icon: 'mesas', labelKey: 'staffApp.more.floor', needs: 'mesas' },
  { id: 'pedidos', icon: 'pedidos', labelKey: 'staffApp.more.supply', needs: 'pedidos' },
  { id: 'settings', icon: 'settings', labelKey: 'staffApp.more.settings' },
]

/** Old staff pages → the screen that holds them now. */
const FOLDED = {
  hoje: 'hoje', goals: 'performance', result: 'performance', points: 'performance', rewards: 'performance',
  performance: 'performance',
  ponto: 'ponto', clock: 'ponto',
  shifts: 'shifts', salary: 'salary', reports: 'reports', profile: 'profile', occurrences: 'occurrences', settings: 'settings',
}

/** Work screens a staff login may open from the app (only when "Users & access" allows them). */
export const STAFF_WORK_TABS = ['pos', 'mesas', 'pedidos']

/** Self-service screens of the app (no area: every login of the role may open them). */
export const STAFF_APP_SELF = ['hoje', 'performance', 'shifts', 'salary', 'reports', 'profile', 'occurrences', 'settings']

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
  return {
    name: String(bar?.nome || '').trim(),
    initials: initialsOf(bar?.nome),
    color,
    logo: /^https:\/\//.test(logo) || /^data:image\//.test(logo) ? logo : '',
  }
}

const BRAND_KEY = 'staff_app_brand'

/** Last bar seen by a staff login on this device (name, initials, colour, logo): the sign-in screen shows it. */
export function readStaffBrand() {
  try {
    const raw = localStorage.getItem(BRAND_KEY)
    const b = raw ? JSON.parse(raw) : null
    if (!b || !b.name) return null
    return barBrand({ nome: b.name, cor: b.color, logo_url: b.logo })
  } catch {
    return null
  }
}

export function rememberStaffBrand(brand) {
  try { localStorage.setItem(BRAND_KEY, JSON.stringify({ name: brand.name, initials: brand.initials, color: brand.color, logo: brand.logo })) } catch { /* storage blocked */ }
}
