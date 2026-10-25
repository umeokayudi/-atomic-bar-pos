/**
 * Business partners: the companies a bar works with (cleaning, drinks, repairs…). Stored as `bar_registry`
 * rows of kind 'fornecedor'; the category key lives in `cargo`. Only the bar's own partners: JBM's upstream
 * suppliers are never here. Own orders (Drink supply) pick their supplier from this list.
 */

export const PARTNER_KIND = 'fornecedor'

export const PARTNER_CATEGORIES = [
  { key: 'bebidas', emoji: '🍾' },
  { key: 'comida', emoji: '🍱' },
  { key: 'gelo', emoji: '🧊' },
  { key: 'limpeza', emoji: '🧹' },
  { key: 'reforma', emoji: '🔨' },
  { key: 'manutencao', emoji: '🔧' },
  { key: 'equipamento', emoji: '🧰' },
  { key: 'som', emoji: '🎵' },
  { key: 'decoracao', emoji: '🌸' },
  { key: 'seguranca', emoji: '🛡️' },
  { key: 'marketing', emoji: '📣' },
  { key: 'internet', emoji: '📶' },
  { key: 'transporte', emoji: '🚚' },
  { key: 'outro', emoji: '📦' },
]

export const COST_PER = ['visit', 'month', 'order']

const CATEGORY = new Map(PARTNER_CATEGORIES.map(c => [c.key, c]))

/** Emoji for a category key; a typed category gets a handshake. */
export function partnerEmoji(category) {
  if (!category) return '🤝'
  return CATEGORY.get(category)?.emoji || '🤝'
}

export function isKnownCategory(category) {
  return CATEGORY.has(category)
}

const isoDay = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').slice(0, 10)) ? String(v).slice(0, 10) : '')

function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}

/** Days from today to the next service: 0 today, negative when it is past. null when there is no date. */
export function daysUntil(date, today) {
  const a = isoDay(date)
  const b = isoDay(today)
  if (!a || !b) return null
  return Math.round(dayNumber(a) - dayNumber(b))
}

/** 'late' | 'soon' (within 7 days) | 'later' | '' */
export function nextState(date, today) {
  const d = daysUntil(date, today)
  if (d == null) return ''
  if (d < 0) return 'late'
  if (d <= 7) return 'soon'
  return 'later'
}

/** Partner rows from the registry, the next service first, then by name. */
export function partnersFrom(registry = []) {
  return (registry || [])
    .filter(r => r?.kind === PARTNER_KIND && String(r.nome || '').trim())
    .sort((a, b) => {
      const na = isoDay(a.proximo_servico)
      const nb = isoDay(b.proximo_servico)
      if (na && nb && na !== nb) return na < nb ? -1 : 1
      if (na && !nb) return -1
      if (!na && nb) return 1
      return String(a.nome).localeCompare(String(b.nome))
    })
}

/** Names for a supplier picker (Own orders): drinks, food and ice partners first. */
export function supplierChoices(registry = []) {
  const rank = c => (['bebidas', 'comida', 'gelo'].includes(c) ? 0 : 1)
  return partnersFrom(registry)
    .slice()
    .sort((a, b) => rank(a.cargo) - rank(b.cargo) || String(a.nome).localeCompare(String(b.nome)))
    .map(r => ({ id: r.id, nome: String(r.nome).trim(), emoji: partnerEmoji(r.cargo), category: r.cargo || '' }))
}

/** Category counts for the filter row, in the picker's order; typed categories at the end. */
export function categoryCounts(rows = []) {
  const counts = new Map()
  for (const r of rows) {
    const key = r.cargo || 'outro'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const known = PARTNER_CATEGORIES.filter(c => counts.has(c.key)).map(c => ({ key: c.key, emoji: c.emoji, count: counts.get(c.key) }))
  const typed = [...counts.keys()].filter(k => !CATEGORY.has(k)).sort().map(k => ({ key: k, emoji: partnerEmoji(k), count: counts.get(k) }))
  return [...known, ...typed]
}

/** A phone number a `tel:` link can dial, or '' (LINE ids and the like stay plain text). */
export function telHref(contact) {
  const raw = String(contact || '').trim()
  if (!/^[+\d][\d\s\-().]{5,}$/.test(raw)) return ''
  return `tel:${raw.replace(/[^\d+]/g, '')}`
}
