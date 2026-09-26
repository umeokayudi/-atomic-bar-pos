/** Consumo japonês padrão 10% — notas 税抜 → sistema 税込 */
export const CONSUMPTION_TAX_RATE = 0.1

export function toZeikomi(zeibetsu) {
  return Math.round(+zeibetsu * (1 + CONSUMPTION_TAX_RATE))
}

export function fromZeikomi(zeikomi) {
  return Math.round(+zeikomi / (1 + CONSUMPTION_TAX_RATE))
}

/** POS listed prices are already 税込. Split 内消費税 — never add 10% on top. */
export function includedTaxBreakdown(zeikomi) {
  const total = Math.round(+zeikomi || 0)
  const net = fromZeikomi(total)
  return { total, net, tax: total - net, rate: CONSUMPTION_TAX_RATE }
}

export function priceChangePct(oldPrice, newPrice) {
  const old = +oldPrice || 0
  const newP = +newPrice || 0
  if (!old || !newP) return null
  return Math.round(((newP - old) / old) * 100)
}

export function formatPriceChange(pct) {
  if (pct == null) return ''
  return `${pct > 0 ? '+' : ''}${pct}%`
}

/** Parse notas fornecedor: "税抜 ¥1600 | jul ¥1850→¥1600 (-14%)" */
export function parseSupplierPriceNotas(notas) {
  if (!notas) return {}
  const zeibetsu = notas.match(/税抜\s*¥?([\d,]+)/)?.[1]?.replace(/,/g, '')
  const delta = notas.match(/([+-]?\d+)%\)/)?.[1] || notas.match(/Δ\s*([+-]?\d+)%/)?.[1]
  return {
    zeibetsu: zeibetsu ? +zeibetsu : null,
    variacao_pct: delta != null ? +delta : null,
  }
}

export function buildSupplierPriceNotas({ zeibetsu, zeikomi, firstZeibetsu, lastZeibetsu }) {
  const parts = [`税抜 ¥${Math.round(zeibetsu).toLocaleString('ja-JP')}`]
  if (firstZeibetsu != null && lastZeibetsu != null && firstZeibetsu !== lastZeibetsu) {
    const pct = priceChangePct(firstZeibetsu, lastZeibetsu)
    parts.push(`jul ¥${Math.round(firstZeibetsu).toLocaleString('ja-JP')}→¥${Math.round(lastZeibetsu).toLocaleString('ja-JP')} (${formatPriceChange(pct)})`)
  }
  return parts.join(' | ')
}
