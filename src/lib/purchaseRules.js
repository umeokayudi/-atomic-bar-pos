/** Purchases: itemized lines and one formula for the real cost. */

const LUMP_RE = /detalhar|to detail|mercadorias|goods|misc|diversos|various/i

/** Real cost = amount paid (or subtotal when nothing was paid yet) − points discount. */
export function realCost(c) {
  return Math.max(0, (+c?.total_pago || +c?.subtotal || 0) - (+c?.desconto_pontos || 0))
}

export function realCostFormula(c) {
  const base = +c?.total_pago ? 'paid' : 'subtotal'
  return { base, baseAmount: +c?.total_pago || +c?.subtotal || 0, points: +c?.desconto_pontos || 0, real: realCost(c) }
}

/**
 * null when the items are fine; else { code, … }. Lines need a name, qty > 0 and a unit cost; a single
 * catch-all line ("Mercadorias Costco — detalhar") is refused; the lines must add up to the subtotal (±¥1).
 */
export function purchaseItemsError(itens = [], subtotal = 0) {
  const lines = (itens || []).filter(it => String(it?.nome || '').trim())
  if (!lines.length) return { code: 'needItems' }
  if (lines.some(it => !(+it.qtd > 0) || !(+it.custo_unitario > 0))) return { code: 'lineIncomplete' }
  if (lines.length === 1 && LUMP_RE.test(lines[0].nome)) return { code: 'lumpLine' }
  const sum = Math.round(lines.reduce((a, it) => a + (+it.qtd) * (+it.custo_unitario), 0))
  if (subtotal > 0 && Math.abs(sum - Math.round(subtotal)) > 1) return { code: 'sumMismatch', sum, subtotal: Math.round(subtotal) }
  return null
}
