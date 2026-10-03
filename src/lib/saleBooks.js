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

/**
 * Compare units that already carry one sales_indicator book.
 * Till and JBM are never added together. A missing net or gross blocks the total.
 */
export function compareBarIndicators(rows) {
  const list = Array.isArray(rows) ? rows : []
  const units = list.map(row => ({
    barId: row?.barId ?? null,
    name: row?.name ?? null,
    book: row?.book ?? null,
    gross: row?.gross ?? null,
    net: row?.net ?? null,
  }))
  const books = new Set(units.map(row => row.book).filter(Boolean))
  const missing = units.some(row => row.book == null || row.gross == null || row.net == null)
  if (!units.length || books.size !== 1 || missing) {
    return {
      comparable: false,
      book: books.size === 1 ? [...books][0] : null,
      gross: null,
      net: null,
      reason: !units.length || missing ? 'missing indicator' : 'mixed books',
      units,
    }
  }
  return {
    comparable: true,
    book: [...books][0],
    gross: units.reduce((sum, row) => sum + Number(row.gross), 0),
    net: units.reduce((sum, row) => sum + Number(row.net), 0),
    reason: null,
    units,
  }
}
