/**
 * Cost categories for the bar's fixed and variable cost pages.
 * Rent and power keep their own registry kinds (the close and the payment agenda look for them);
 * every other category is saved as kind fixo / variavel with the category key in `detalhe`.
 * A key that is not in the list is the owner's own category name.
 */

export const FIXED_CATEGORIES = [
  { key: 'rent', emoji: '🏠', kind: 'aluguel' },
  { key: 'internet', emoji: '🌐' },
  { key: 'phone', emoji: '📱' },
  { key: 'insurance', emoji: '🛡️' },
  { key: 'cleaning', emoji: '🧹' },
  { key: 'security', emoji: '🔒' },
  { key: 'music', emoji: '🎵' },
  { key: 'subscription', emoji: '📺' },
  { key: 'lease', emoji: '🧾' },
  { key: 'loan', emoji: '🏦' },
  { key: 'parking', emoji: '🅿️' },
  { key: 'marketing', emoji: '📣' },
]

export const VARIABLE_CATEGORIES = [
  { key: 'power', emoji: '⚡', kind: 'energia' },
  { key: 'water', emoji: '💧' },
  { key: 'gas', emoji: '🔥' },
  { key: 'repair', emoji: '🔧' },
  { key: 'ice', emoji: '🧊' },
  { key: 'supplies', emoji: '🧻' },
  { key: 'food', emoji: '🍋' },
  { key: 'decor', emoji: '💐' },
  { key: 'transport', emoji: '🚕' },
  { key: 'marketing', emoji: '📣' },
  { key: 'event', emoji: '🎉' },
  { key: 'tax', emoji: '🏛️' },
]

export const CUSTOM_EMOJI = '🏷️'

const ALL = [...FIXED_CATEGORIES, ...VARIABLE_CATEGORIES]

export function categoriesFor(registerKind) {
  return registerKind === 'variavel' ? VARIABLE_CATEGORIES : FIXED_CATEGORIES
}

export function isKnownCostCategory(key) {
  return ALL.some(c => c.key === key)
}

/** Category key of a saved registry row ('' when none was picked). */
export function costCategoryOf(row) {
  if (!row) return ''
  if (row.kind === 'aluguel') return 'rent'
  if (row.kind === 'energia') return 'power'
  if (row.kind === 'fixo' || row.kind === 'variavel' || row.kind === 'outro') return String(row.detalhe || '').trim()
  return ''
}

export function costEmoji(key) {
  if (!key) return CUSTOM_EMOJI
  return (ALL.find(c => c.key === key) || {}).emoji || CUSTOM_EMOJI
}

/** Registry kind to save for a category on a given page (fixo or variavel). */
export function kindForCategory(registerKind, key) {
  const hit = categoriesFor(registerKind).find(c => c.key === key)
  return hit?.kind || registerKind
}

/** Digits only, for the yen input. */
export function yenDigits(value) {
  return String(value ?? '').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 10)
}

export function groupYen(value) {
  const digits = yenDigits(value)
  return digits ? Number(digits).toLocaleString('en-US') : ''
}
