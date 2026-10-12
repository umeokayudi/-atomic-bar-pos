/** Employee file helpers: who is a real employee, contract state, and the private file calls. */

export const CONTRACT_TYPES = ['seishain', 'part', 'gyomu', 'haken', 'trial', 'other']

/** Till (caixa) and owner logins are system accounts, not people on the payroll. */
export function isSystemLogin(p) {
  return p?.role === 'caixa' || p?.role === 'cliente'
}

/** none · open (no end date) · active · ending (≤ 30 days left) · ended. */
export function contractState(p, today = new Date().toISOString().slice(0, 10)) {
  if (!p?.contrato_tipo && !p?.contrato_inicio && !p?.contrato_fim) return { state: 'none', days: null }
  if (!p.contrato_fim) return { state: 'open', days: null }
  const days = Math.round((Date.parse(p.contrato_fim) - Date.parse(today)) / 86400000)
  if (days < 0) return { state: 'ended', days }
  if (days <= 30) return { state: 'ending', days }
  return { state: 'active', days }
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase()
}
