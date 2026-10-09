/** Drink-back pay. Till money only, never the JBM bill.
 * Only drinks she herself drank, priced above ¥2,000.
 * The part above ¥2,000 does not count, so 50% pays ¥1,000 and 30% pays ¥600 per drink.
 * Bottles (shots) are excluded.
 */

export const DRINK_BACK_CAP = 2000

export function isBottleLine(item) {
  return item?.kind === 'shot' || !!item?.produto_id
}

export function drinkBackUnit(item, pct) {
  if (!item?.forCast || isBottleLine(item)) return 0
  const price = +item.preco_unitario || +item.preco || +item.preco_lista || 0
  const rate = Math.max(0, +pct || 0) / 100
  if (!(price > DRINK_BACK_CAP) || !rate) return 0
  return Math.round(DRINK_BACK_CAP * rate)
}

export function drinkBackCommission(items = [], pct = 0) {
  return (items || []).reduce((sum, it) => sum + drinkBackUnit(it, pct) * Math.max(0, +it.qtd || 0), 0)
}
