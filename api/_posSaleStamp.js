/**
 * Who rang a till sale up is never taken from the browser.
 * Sales written through /api/bar/live-db get `criado_por` = the signed-in login (Supabase user or lane
 * login id), whatever the client sent; bar logins cannot rewrite it later. The atomic RPC
 * (pos_commit_sale in sql/floor_comandas.sql) already stamps auth.uid() itself.
 * saleCredit.js credits a sale nobody was marked on to this login.
 */

export const SALE_TABLE = 'pos_vendas'
export const RINGER_FIELD = 'criado_por'
const BAR_ROLES = ['cliente', 'gerente', 'caixa', 'bar_staff']

/** Rows to insert/upsert with the ringer stamped from the authenticated actor. Other tables untouched. */
export function stampSaleRows(table, rows, auth) {
  if (table !== SALE_TABLE) return rows
  const uid = String(auth?.user?.id || auth?.perfil?.id || '')
  return (rows || []).map(row => {
    if (!row || typeof row !== 'object') return row
    const next = { ...row }
    if (uid) next[RINGER_FIELD] = uid
    else delete next[RINGER_FIELD]
    // Mirror field some clients may send; never trusted either.
    delete next.staff_id
    return next
  })
}

/** Update patch for a sale: bar logins cannot change who rang it up. */
export function guardSalePatch(table, patch, auth) {
  if (table !== SALE_TABLE || !patch || typeof patch !== 'object') return patch
  if (!BAR_ROLES.includes(auth?.perfil?.role)) return patch
  const next = { ...patch }
  delete next[RINGER_FIELD]
  delete next.staff_id
  return next
}

// Till and staff logins may only attach a guest/visit/tab to a sale; money fields change only by the owner or a
// manager (a void is a new negative row, never an edit). A cashier may delete only the sale it just rang up,
// which is how a failed stock write rolls the sale back (src/lib/atomicPos.js rollbackPosSale).
const FRONT_ROLES = ['caixa', 'bar_staff']
const FRONT_SALE_PATCH = new Set(['guest_id', 'visit_id', 'comanda_id'])
const ROLLBACK_WINDOW_MS = 10 * 60 * 1000

export function isFrontLogin(auth) {
  return FRONT_ROLES.includes(auth?.perfil?.role)
}

/** Error text when a till/staff login tries a sale write it may not do, else null. Delete is checked separately. */
export function frontSaleWriteError(table, spec, auth) {
  if (!isFrontLogin(auth) || (table !== SALE_TABLE && table !== 'pos_vendas_itens')) return null
  if (spec.mode === 'upsert') return 'Sales cannot be overwritten from the till'
  if (spec.mode === 'insert' && table === SALE_TABLE && (spec.insertRows || []).some(r => Math.round(+r?.total || 0) < 0)) {
    return 'Only the owner or a manager can void a sale'
  }
  if (spec.mode === 'update') {
    if (table !== SALE_TABLE) return 'Only the owner or a manager can change a sale'
    const keys = Object.keys(spec.updatePatch || {})
    if (keys.some(k => !FRONT_SALE_PATCH.has(k))) return 'Only the owner or a manager can change a sale'
  }
  return null
}

/** Rows a till/staff login is about to delete: allowed only for its own sale rung up in the last minutes. */
export function frontDeleteError(saleRows, auth, now = Date.now()) {
  if (!isFrontLogin(auth)) return null
  const uid = String(auth?.user?.id || auth?.perfil?.id || '')
  for (const sale of saleRows || []) {
    const fresh = sale?.criado_em && now - Date.parse(sale.criado_em) < ROLLBACK_WINDOW_MS
    if (!uid || String(sale?.criado_por || '') !== uid || !fresh) return 'Only the owner or a manager can delete a sale'
  }
  return null
}
