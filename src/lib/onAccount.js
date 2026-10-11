/**
 * Customer "on account" (ツケ / fiado) and customer-linked discounts. Pure helpers, unit tested in
 * scripts/posFloor.test.mjs.
 *
 * Rules (owner):
 * - Only a customer in the bar's CRM (bar_guests, the recurring customers) can put a bill on account,
 *   in full or the rest after a partial payment.
 * - Only a CRM customer can get a discount (code or VIP price); the sale is linked to that customer.
 *
 * Where the money lives:
 * - On a tab, the part put on account is a tab payment (pos_comanda_pagamentos) whose method is
 *   "On account · <name> #<guest id>", so the tab is fully settled and the sale closes as usual.
 * - The balance per customer is the ledger table bar_guest_ledger (live store, JSON until a Postgres
 *   table exists): one 'charge' row per amount put on account (written when the sale closes),
 *   one 'payment' row per later payment received. Balance = Σ charges − Σ payments (reversed rows ignored).
 */

export const ON_ACCOUNT = 'On account'
export const LEDGER_TABLE = 'bar_guest_ledger'

/** Method text stored on a tab payment / sale for an amount put on a customer's account. */
export function onAccountMethod(guest) {
  const nome = String(guest?.nome || '').replace(/[#·]/g, ' ').replace(/\s+/g, ' ').trim()
  const id = String(guest?.id || '').trim()
  return [ON_ACCOUNT, nome].filter(Boolean).join(' · ') + (id ? ` #${id}` : '')
}

/** Reverse of onAccountMethod. Any other method reads as { onAccount: false }. */
export function parseOnAccountMethod(metodo) {
  const text = String(metodo || '').trim()
  if (!text.toLowerCase().startsWith(ON_ACCOUNT.toLowerCase())) return { onAccount: false, nome: '', guestId: null }
  const m = text.match(/#([^\s#]+)\s*$/)
  const guestId = m ? m[1] : null
  const body = (m ? text.slice(0, m.index) : text).slice(ON_ACCOUNT.length).replace(/^\s*·\s*/, '').trim()
  return { onAccount: true, nome: body, guestId }
}

/** Method as people read it (the internal customer id is dropped). */
export function methodDisplay(metodo) {
  const p = parseOnAccountMethod(metodo)
  if (!p.onAccount) return String(metodo || '')
  return p.nome ? `${ON_ACCOUNT} · ${p.nome}` : ON_ACCOUNT
}

/** A recurring customer = an active row of the bar's CRM (bar_guests). */
export function isCrmGuest(guest) {
  return !!(guest && guest.id && guest.ativo !== false)
}

/** Is this a discounted ticket? (discount code applied, or VIP price) */
export function hasDiscount({ priceType = 'regular', codeId = null, vipId = null } = {}) {
  return !!codeId || !!vipId || priceType === 'vip' || priceType === 'codigo'
}

/** Error key when a discount is used without a CRM customer, '' when fine. */
export function discountGuestError({ priceType, codeId, vipId, guest } = {}) {
  if (!hasDiscount({ priceType, codeId, vipId })) return ''
  return isCrmGuest(guest) ? '' : 'onAccount.errDiscountGuest'
}

/** Check an amount to put on account. Returns an error key or ''. */
export function onAccountError({ guest, amount, due } = {}) {
  if (!isCrmGuest(guest)) return 'onAccount.errGuest'
  const a = Math.round(+amount || 0)
  if (a <= 0) return 'onAccount.errAmount'
  if (due != null && a > Math.round(+due || 0)) return 'onAccount.errOverDue'
  return ''
}

const live = row => row && !row.estornado_em

/** Ledger rows → balance per customer, biggest debt first. Customers at 0 are kept only with { all: true }. */
export function ledgerBalances(rows = [], { all = false } = {}) {
  const by = new Map()
  for (const r of rows || []) {
    if (!live(r) || !r.guest_id) continue
    const cur = by.get(r.guest_id) || { guest_id: r.guest_id, nome: r.guest_nome || '', charged: 0, paid: 0, balance: 0, last: null, count: 0 }
    const v = Math.round(+r.valor || 0)
    if (r.tipo === 'payment') cur.paid += v
    else cur.charged += v
    if (r.guest_nome) cur.nome = r.guest_nome
    if (r.criado_em && (!cur.last || r.criado_em > cur.last)) cur.last = r.criado_em
    cur.count += 1
    cur.balance = cur.charged - cur.paid
    by.set(r.guest_id, cur)
  }
  return [...by.values()]
    .filter(b => all || b.balance !== 0)
    .sort((a, b) => b.balance - a.balance || String(a.nome).localeCompare(String(b.nome)))
}

export function guestBalance(rows = [], guestId) {
  return ledgerBalances(rows, { all: true }).find(b => b.guest_id === guestId)?.balance || 0
}

export function ledgerTotal(rows = []) {
  return ledgerBalances(rows).reduce((a, b) => a + Math.max(0, b.balance), 0)
}

/**
 * Charge rows for the on-account payments of a tab that is being closed. The ledger id is the tab
 * payment id, so writing them twice (retry) never doubles a debt.
 */
export function tabOnAccountRows(payments = [], { barId, comandaId = null, vendaId = null, guests = [], now = new Date().toISOString(), userId = null } = {}) {
  const out = []
  for (const p of payments || []) {
    if (!live(p) || !p.id) continue
    const m = parseOnAccountMethod(p.metodo)
    if (!m.onAccount || !m.guestId) continue
    const g = (guests || []).find(x => x.id === m.guestId)
    out.push({
      id: p.id, bar_id: barId, guest_id: m.guestId, guest_nome: g?.nome || m.nome || p.pagador || '',
      tipo: 'charge', valor: Math.round(+p.valor || 0), metodo: ON_ACCOUNT,
      venda_id: vendaId, comanda_id: comandaId || p.comanda_id || null, criado_em: now, criado_por: userId,
    })
  }
  return out
}

/** Charge row for a counter sale put entirely on account. Same id as the sale: idempotent. */
export function saleOnAccountRow({ barId, vendaId, guest, valor, now = new Date().toISOString(), userId = null }) {
  return {
    id: vendaId, bar_id: barId, guest_id: guest.id, guest_nome: guest.nome || '',
    tipo: 'charge', valor: Math.round(+valor || 0), metodo: ON_ACCOUNT,
    venda_id: vendaId, comanda_id: null, criado_em: now, criado_por: userId,
  }
}

/** A later payment received against a customer's balance. Returns { row } or { error } (i18n key). */
export function receivePaymentRow({ id, barId, guest, valor, metodo = 'Cash', balance, nota = '', now = new Date().toISOString(), userId = null }) {
  const v = Math.round(+valor || 0)
  if (!guest?.guest_id && !guest?.id) return { error: 'onAccount.errGuest' }
  if (v <= 0) return { error: 'onAccount.errAmount' }
  if (balance != null && v > Math.round(+balance || 0)) return { error: 'onAccount.errOverBalance' }
  return {
    row: {
      id, bar_id: barId, guest_id: guest.guest_id || guest.id, guest_nome: guest.nome || '',
      tipo: 'payment', valor: v, metodo, nota: String(nota || '').trim() || null,
      venda_id: null, comanda_id: null, criado_em: now, criado_por: userId,
    },
  }
}

/** The one customer a set of on-account tab payments belongs to (null when none or several). */
export function onAccountGuestId(payments = []) {
  const ids = new Set((payments || []).filter(live).map(p => parseOnAccountMethod(p.metodo)).filter(m => m.onAccount && m.guestId).map(m => m.guestId))
  return ids.size === 1 ? [...ids][0] : null
}

/** Queue of ledger rows not yet saved (offline / store error). Upsert by id, so replays are safe. */
export function queueRows(queue = [], rows = []) {
  const by = new Map((queue || []).map(r => [r.id, r]))
  for (const r of rows || []) if (r?.id) by.set(r.id, r)
  return [...by.values()]
}

/**
 * The till's "tonight" card: closed sales of the night (from summarizeNight) plus what is open on tabs now.
 * tabs: [{ total, paid }] — total of each open tab's bill (service included), paid = partial payments taken.
 */
export function tonightGlance({ summary = null, tabs = [] } = {}) {
  const open = (tabs || []).filter(x => (+x.total || 0) > 0)
  return {
    soldTotal: Math.round(+summary?.drinksTotal || 0),
    soldCount: Math.round(+summary?.ticketCount || 0),
    openTotal: open.reduce((a, x) => a + Math.round(+x.total || 0), 0),
    openPaid: open.reduce((a, x) => a + Math.round(+x.paid || 0), 0),
    openCount: open.length,
  }
}

/** Search CRM customers by name, LINE id, phone or tag. Active only. */
export function searchCrm(guests = [], q = '') {
  const s = String(q || '').trim().toLowerCase()
  const list = (guests || []).filter(isCrmGuest)
  if (!s) return list
  return list.filter(g => [g.nome, g.line_id, g.telefone, ...(g.tags || [])].filter(Boolean).some(v => String(v).toLowerCase().includes(s)))
}
