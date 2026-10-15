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
