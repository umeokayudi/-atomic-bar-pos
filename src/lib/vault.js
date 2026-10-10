/**
 * Owner PIN for money and payroll screens (client side).
 * The PIN is checked by /api/bar-staff; the browser only keeps the short-lived unlock token for this tab.
 */
export const VAULT_HEADER = 'x-bar-unlock'
const KEY = 'bar-vault'
const listeners = new Set()

// Screens behind each area. Money: the Money menu plus the night close; payroll: pay per person.
export const VAULT_TABS = {
  money: ['pagamentos', 'custos', 'fixo', 'variavel', 'cartao', 'energia', 'aluguel', 'faturas', 'contador', 'imposto', 'recibos', 'fechamento'],
  payroll: ['salarios', 'drinkback', 'staff', 'equipe'],
}

export function areaForTab(tab) {
  return Object.keys(VAULT_TABS).find(a => VAULT_TABS[a].includes(tab)) || null
}

function read() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    if (v?.token && v.exp > Date.now()) return v
  } catch { /* storage off */ }
  return null
}

export function vaultState() {
  return read()
}

export function vaultHeader() {
  const v = read()
  return v ? { [VAULT_HEADER]: v.token } : {}
}

export function setVault(token, exp) {
  try {
    if (token) sessionStorage.setItem(KEY, JSON.stringify({ token, exp }))
    else sessionStorage.removeItem(KEY)
  } catch { /* storage off */ }
  listeners.forEach(fn => fn(read()))
}

export function lockNow() {
  setVault(null)
}

export function onVault(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Minutes and seconds left, for the "locks again in" note. */
export function timeLeft(exp, now = Date.now()) {
  const s = Math.max(0, Math.round((exp - now) / 1000))
  return { min: Math.floor(s / 60), sec: s % 60, total: s }
}
