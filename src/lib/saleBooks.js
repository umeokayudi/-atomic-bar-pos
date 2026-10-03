/** Official client mirror of sales_indicator. Till and JBM stay separate books. */

import { saleGross, saleNet } from './nightClose.js'

const TILL_VOID = new Set(['void', 'cancelada', 'cancelado'])
const JBM_VOID = new Set(['cancelada', 'cancelado', 'void', 'estornada'])

export function tillGross(sale) {
  return saleGross(sale)
}

/** Net till amount. A voided ticket stays on record and contributes 0. */
export function tillNet(sale) {
  const status = String(sale?.void_status || '')
  if (TILL_VOID.has(status)) return 0
  return Math.max(0, saleNet(sale))
}

export function sumTillGross(rows) {
  return (rows || []).reduce((sum, sale) => sum + tillGross(sale), 0)
}

export function sumTillNet(rows) {
  return (rows || []).reduce((sum, sale) => sum + tillNet(sale), 0)
}

export function countTillValid(rows) {
  return (rows || []).filter(sale => tillNet(sale) > 0).length
}

export function jbmGross(sale) {
  return Math.round(+sale?.total || 0)
}

export function jbmNet(sale) {
  const status = String(sale?.status || '')
  if (JBM_VOID.has(status)) return 0
  const gross = jbmGross(sale)
  return gross > 0 ? gross : 0
}

export function sumJbmGross(rows) {
  return (rows || []).reduce((sum, sale) => sum + jbmGross(sale), 0)
}

export function sumJbmNet(rows) {
  return (rows || []).reduce((sum, sale) => sum + jbmNet(sale), 0)
}

export function countJbmValid(rows) {
  return (rows || []).filter(sale => jbmNet(sale) > 0).length
}
