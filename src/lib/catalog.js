/**
 * Catalog rules: one product name (normalized) per item, wholesale items apart from bar-menu items,
 * cost ¥0 is a pending task (not a 100% margin), and each supplier says whether its prices include tax.
 */
import { CONSUMPTION_TAX_RATE } from './consumptionTax.js'

// Spelling variants seen in the catalog (review 29/10/2026).
const SPELLING = [
  [/\bcramberry\b/g, 'cranberry'],
  [/\bgrape\s+fruit\b/g, 'grapefruit'],
  [/\bjasmin\b/g, 'jasmine'],
]

/** Name used to compare products: lower case, no accents, no "(dup)", no size/pack suffix, spelling fixed. */
export function normalizeName(nome) {
  let s = String(nome || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  s = s.replace(/\((dup|copy|copia)\)/g, ' ')
  s = s.replace(/\(\s*\d+(\.\d+)?\s*(l|ml|cl)\s*\)/g, ' ')
  s = s.replace(/\b\d+\s*(unit|units|pcs|pack|本|個)\b/g, ' ')
  for (const [re, to] of SPELLING) s = s.replace(re, to)
  return s.replace(/[^a-z0-9぀-ヿ一-龯]+/g, ' ').trim().replace(/\s+/g, ' ')
}

/** Groups of active products that share a normalized name (likely duplicates). */
export function findDuplicates(produtos = []) {
  const by = new Map()
  for (const p of produtos || []) {
    if (p?.ativo === false) continue
    const k = normalizeName(p.nome)
    if (!k) continue
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(p)
  }
  return [...by.values()].filter(g => g.length > 1)
}

/** Another active product already has this name (normalized). */
export function nameTaken(produtos = [], nome, exceptId = null) {
  const k = normalizeName(nome)
  return (produtos || []).find(p => p.id !== exceptId && p.ativo !== false && normalizeName(p.nome) === k) || null
}

/** Bar menu / POS items (dishes, cocktails, Bottle/Glass) are not wholesale catalog items. */
export function isMenuItem(p, menuCategories = []) {
  if (p?.tipo && /menu|pos|cardapio/i.test(p.tipo)) return true
  const cat = String(p?.categoria || '')
  if (menuCategories.includes(cat)) return true
  return /\b(bottle|glass)\b/i.test(String(p?.nome || '')) && !/\d\s*(ml|l)\b/i.test(String(p?.nome || ''))
}

/** Cost ¥0 is a pending item: no margin is shown for it. */
export function costPending(p) {
  return !(+p?.custo > 0)
}

export function productMargin(p) {
  if (costPending(p) || !(+p?.preco_venda > 0)) return null
  return Math.round((p.preco_venda - p.custo) / p.preco_venda * 100)
}

const TAX_TAG = /\[tax:(included|excluded)\]/i
// Suppliers whose price sheets state tax included (review 29/10/2026); a tag on the supplier overrides it.
const KNOWN_INCLUDED = [/liquor\s*mountain/i, /le\s*vin/i]

/** 'included' | 'excluded': whether the supplier's listed prices already include consumption tax. */
export function supplierTaxMode(f) {
  if (typeof f?.imposto_incluido === 'boolean') return f.imposto_incluido ? 'included' : 'excluded'
  const tag = String(f?.notas || '').match(TAX_TAG)
  if (tag) return tag[1].toLowerCase()
  if (KNOWN_INCLUDED.some(re => re.test(String(f?.nome || '')))) return 'included'
  return 'excluded'
}

/** Writes the supplier's tax mode as a tag in its notes (no schema change needed). */
export function withTaxTag(notas, mode) {
  const clean = String(notas || '').replace(TAX_TAG, '').trim()
  return `${clean ? clean + ' ' : ''}[tax:${mode}]`
}

export function stripTaxTag(notas) {
  return String(notas || '').replace(TAX_TAG, '').trim()
}

/** Price without and with tax, from the listed price and the supplier's mode (never +10% on an included price). */
export function offerPrices(preco, mode) {
  const p = Math.round(+preco || 0)
  if (!p) return { net: 0, gross: 0 }
  if (mode === 'included') return { net: Math.round(p / (1 + CONSUMPTION_TAX_RATE)), gross: p }
  return { net: p, gross: Math.round(p * (1 + CONSUMPTION_TAX_RATE)) }
}

/**
 * Compare a product's real offers (price > 0) on the same basis (with tax). Returns the offers sorted,
 * and coverage: how many suppliers have a real price out of the suppliers linked to the product.
 */
export function compareOffers(offers = []) {
  const linked = offers.length
  const real = offers
    .filter(o => +o.preco > 0)
    .map(o => {
      const mode = supplierTaxMode(o.fornecedores || o.fornecedor || {})
      return { ...o, taxMode: mode, ...offerPrices(o.preco, mode) }
    })
    .sort((a, b) => a.gross - b.gross)
  return { offers: real, coverage: { withPrice: real.length, linked } }
}
