/**
 * The "Tabs" button and its full list on the till (12/11/2026). Pure helpers, unit tested in scripts/tabsList.test.mjs.
 *
 * Rule (owner, 13/11 check at Atomic): the counter counts EVERY open tab, with or without value. A ¥0 tab opened by
 * mistake must be visible, never hidden from the number. Tabs from an earlier night stay first, marked "from yesterday".
 */

import { isCarriedTab, isEmptyTab, sortCarriedFirst } from './openTabsClose.js'
import { tokyoNightKey } from './tokyo.js'

/** How many tabs are open: all of them (server tabs + tabs kept on this device), ¥0 ones included. */
export function openTabsCount(serverTabs = [], localTabs = []) {
  return (serverTabs || []).length + (localTabs || []).length
}

/** "12 Nov 21:05" in Tokyo time (date + time, so a tab from another day reads as such). '' when unknown. */
export function openedStamp(iso, lang = 'en') {
  const at = iso ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return ''
  const opts = { timeZone: 'Asia/Tokyo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
  if (lang === 'ja') return new Intl.DateTimeFormat('ja-JP', { ...opts, month: 'numeric' }).format(at)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', opts).formatToParts(at).map(p => [p.type, p.value]))
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`
}

/**
 * Rows of the list: server tabs (carried first, then in opening order) and then tabs kept on this device.
 * total(tab) gives the bill of a server tab (incl. lines not sent yet); local tabs carry { id, label, total }.
 */
export function tabRows({ serverTabs = [], localTabs = [], total = () => 0, today = tokyoNightKey() } = {}) {
  const srv = sortCarriedFirst(serverTabs || [], today).map(x => ({
    key: `srv:${x.id}`,
    id: x.id,
    server: true,
    name: x.nome || '',
    table: x.mesa_nome && x.mesa_nome !== x.nome ? x.mesa_nome : '',
    people: +x.pessoas || 0,
    total: Math.round(+total(x) || 0),
    openedAt: x.aberta_em || null,
    openedBy: x.responsavel_nome || '',
    carried: isCarriedTab(x, today),
    empty: isEmptyTab(x) && !(Math.round(+total(x) || 0) > 0),
    paying: x.status === 'awaiting_payment',
    tab: x,
  }))
  const local = (localTabs || []).map(x => ({
    key: x.id,
    id: x.id,
    server: false,
    name: x.label || '',
    table: '',
    people: 0,
    total: Math.round(+x.total || 0),
    openedAt: x.openedAt || null,
    openedBy: x.openedBy || '',
    carried: false,
    empty: !(Math.round(+x.total || 0) > 0),
    paying: false,
    tab: null,
  }))
  return [...srv, ...local]
}

/** Search the list by tab name, table or who opened it. */
export function filterRows(rows = [], q = '') {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return rows
  return rows.filter(r => [r.name, r.table, r.openedBy].some(v => String(v || '').toLowerCase().includes(s)))
}
