/** Till / HQ hashes after login. Role decides the screen — not four login doors. */

export const DOOR_PREF_KEY = 'bar_login_door'

export const LOGIN_DOORS = [
  {
    id: 'pos',
    hash: 'pos',
    titleKey: 'auth.doorPosTitle',
    hintKey: 'auth.doorPosHint',
    keep: true,
    prefillEmail: '',
  },
  {
    id: 'gerente',
    hash: 'hq',
    titleKey: 'auth.doorGerenteTitle',
    hintKey: 'auth.doorGerenteHint',
    keep: false,
    prefillEmail: '',
  },
  {
    id: 'clock',
    hash: 'clock',
    titleKey: 'auth.doorStaffTitle',
    hintKey: 'auth.doorStaffHint',
    keep: true,
    prefillEmail: '',
  },
  {
    id: 'jbm',
    hash: 'jbm',
    titleKey: 'auth.doorJbmTitle',
    hintKey: 'auth.doorJbmHint',
    keep: false,
    prefillEmail: '',
  },
]

export function loginDoorFromHash(hash = typeof location !== 'undefined' ? location.hash : '') {
  const h = String(hash || '').replace(/^#\/?/, '').split(/[/?#]/)[0].toLowerCase()
  if (h === 'pos' || h === 'till' || h === 'caixa') return 'pos'
  if (h === 'clock' || h === 'ponto' || h === 'staff') return 'clock'
  if (h === 'hq' || h === 'office' || h === 'gerente') return 'gerente'
  if (h === 'jbm' || h === 'supply') return 'jbm'
  return ''
}

export function hashForRole(role) {
  if (role === 'caixa') return '#/pos'
  if (role === 'bar_staff') return '#/clock'
  if (role === 'admin' || role === 'staff' || role === 'funcionario') return '#/jbm'
  if (role === 'cliente' || role === 'gerente') return '#/hq'
  return '#/'
}

export function setHashForRole(role) {
  if (typeof location === 'undefined') return
  const next = hashForRole(role)
  if (location.hash !== next) location.hash = next
}

export function hashForDoor(id) {
  if (id === 'pos') return '#/pos'
  if (id === 'clock') return '#/clock'
  if (id === 'gerente') return '#/hq'
  if (id === 'jbm') return '#/jbm'
  return '#/'
}

export function doorById(id) {
  return LOGIN_DOORS.find(d => d.id === id) || null
}

export function readDoorPref() {
  try { return localStorage.getItem(DOOR_PREF_KEY) || '' } catch { return '' }
}

export function writeDoorPref(id) {
  try {
    if (id) localStorage.setItem(DOOR_PREF_KEY, id)
    else localStorage.removeItem(DOOR_PREF_KEY)
  } catch {}
}

export function setDoorHash(id) {
  if (typeof location === 'undefined') return
  const next = hashForDoor(id)
  if (location.hash !== next) location.hash = next
}

/** POS till tablet chrome — caixa always, or owner covering the floor via /#/pos. */
export function isTillKiosk(role, door = loginDoorFromHash()) {
  if (role === 'caixa') return true
  if (door === 'pos' && (role === 'cliente' || role === 'gerente')) return true
  return false
}

export function isClockKiosk(role) {
  return role === 'bar_staff'
}

export function doorAllowsRole(door, role) {
  if (!door) return true
  if (door === 'pos') return role === 'caixa' || role === 'cliente' || role === 'gerente'
  if (door === 'clock') return role === 'bar_staff'
  if (door === 'gerente') return role === 'cliente' || role === 'gerente'
  if (door === 'jbm') return role === 'admin' || role === 'funcionario' || role === 'staff'
  return true
}
