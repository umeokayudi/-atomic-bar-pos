/**
 * Who may touch which rows through /api/bar/live-db. Pure, unit tested (scripts/tests/liveScope.test.mjs).
 *
 * The rule is enforced here on the server, never by what the browser sends:
 *  - HQ (admin, jbm): every bar.
 *  - A bar login (owner, manager, till, staff): only rows of ITS bar. Any bar_id the browser sends as a filter
 *    is thrown away and replaced by the login's own bar; a row for another bar is refused. Before 2026-11-18 a
 *    filter such as bar_id = <another bar> (or bar_id != x) was accepted as sent, so one bar could read, change
 *    or delete another bar's sales, guests and settings.
 *  - Any other login (HQ staff, supplier, no role): nothing, except reading the company row for receipts.
 */

export const BAR_ROLES = ['cliente', 'gerente', 'caixa', 'bar_staff']
export const HQ_ROLES = ['admin', 'jbm']

/** Tables with no bar_id column: how a bar login is still kept inside its own bar. */
const NO_BAR_COLUMN = {
  // One row for the whole company (receipt issuer). Read by everyone signed in, written by HQ only (route check).
  jbm_company: 'company',
  // Lines of a sale: scoped through the sale they belong to (pos_venda_id must be a sale of this bar).
  pos_vendas_itens: 'sale',
  // The bar's own location row, keyed by the bar id.
  bar_geo: 'self',
  // Staff files (pay, bank, PIN hash) are only read and written through /api/bar-staff.
  staff_extras: 'server_only',
}

function withoutKey(filters, key) {
  return (filters || []).filter(f => f && f.k !== key)
}

/**
 * @param auth   { perfil: { role, bar_id } }
 * @param spec   { table, mode, filters, insertRows }
 * @param extra  { ownSaleIds?: string[] }  ids of this bar's sales, needed only for pos_vendas_itens
 * @returns { filters, insertRows } or { error, status }
 */
export function scopeLiveRequest(auth, spec, extra = {}) {
  const role = auth?.perfil?.role || ''
  const barId = auth?.perfil?.bar_id || ''
  const mode = spec.mode || 'select'
  const table = spec.table
  const filters = Array.isArray(spec.filters) ? spec.filters.filter(Boolean) : []
  const rows = Array.isArray(spec.insertRows) ? spec.insertRows.map(r => ({ ...r })) : spec.insertRows

  if (HQ_ROLES.includes(role)) return { filters, insertRows: rows }

  if (!BAR_ROLES.includes(role)) {
    if (table === 'jbm_company' && mode === 'select') return { filters, insertRows: rows }
    return { error: 'No permission', status: 403 }
  }
  if (!barId) return { error: 'This login is not linked to a bar', status: 403 }

  const kind = NO_BAR_COLUMN[table]
  if (kind === 'server_only') return { error: 'Use the team screens for staff details', status: 403 }
  if (kind === 'company') return { filters, insertRows: rows }
  if (kind === 'self') {
    if (mode !== 'select') return { error: 'Use the clock settings to change the bar location', status: 403 }
    return { filters: [...withoutKey(filters, 'id'), { op: 'eq', k: 'id', v: barId }], insertRows: rows }
  }
  if (kind === 'sale') {
    const own = new Set((extra.ownSaleIds || []).map(String))
    if (mode === 'insert' || mode === 'upsert') {
      const bad = (rows || []).find(r => !r?.pos_venda_id || !own.has(String(r.pos_venda_id)))
      if (bad) return { error: 'This sale is not from your bar', status: 403 }
      return { filters, insertRows: rows }
    }
    // An empty list must match nothing (never "no filter").
    return { filters: [...filters, { op: 'in', k: 'pos_venda_id', v: own.size ? [...own] : ['__none__'] }], insertRows: rows }
  }

  if (mode === 'insert' || mode === 'upsert') {
    for (const r of rows || []) {
      if (r.bar_id && r.bar_id !== barId) return { error: 'bar_id mismatch', status: 403 }
      r.bar_id = barId
    }
    return { filters: [...withoutKey(filters, 'bar_id'), { op: 'eq', k: 'bar_id', v: barId }], insertRows: rows }
  }
  return { filters: [...withoutKey(filters, 'bar_id'), { op: 'eq', k: 'bar_id', v: barId }], insertRows: rows }
}

/** An update may never move a row to another bar. */
export function scopePatch(auth, patch) {
  if (!patch || HQ_ROLES.includes(auth?.perfil?.role)) return patch
  const { bar_id: _drop, ...rest } = patch
  return rest
}

export function needsOwnSales(auth, table) {
  return table === 'pos_vendas_itens' && BAR_ROLES.includes(auth?.perfil?.role)
}
