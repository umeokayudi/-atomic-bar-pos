/**
 * The till's "Tabs" button and full list (owner, 13/11/2026). Pure helpers, unit tested in scripts/tabsList.test.mjs.
 *
 * - The counter counts EVERY open tab, with or without anything on it (6 open, 5 of them ¥0 = "6 tabs").
 * - The list shows every open tab: carried-over tabs ("From yesterday — check") first, then tonight's by opening time.
 * - Each row says when the tab was opened (date + time, Tokyo) and who opened it.
 */

import { OPEN_TAB_STATUSES, isCarriedTab, sortCarriedFirst } from './openTabsClose.js'

/** How many tabs are open: all of them, empty ones included. */
export function countOpenTabs(tabs = []) {
  return (tabs || []).filter(x => x && OPEN_TAB_STATUSES.includes(x.status || 'open')).length
}

/** "13/11 21:05" (en) or "11/13 21:05" (ja), Tokyo time. '' when the date is missing. */
export function openedAtLabel(iso, lang = 'en') {
  const at = iso ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map(p => [p.type, p.value]))
  const date = lang === 'ja' ? `${parts.month}/${parts.day}` : `${parts.day}/${parts.month}`
  return `${date} ${parts.hour}:${parts.minute}`
}

/** Who opened the tab: the login that created it (criado_por → name), else the person responsible for it. */
export function openerName(tab, names = {}) {
  return (tab?.criado_por && names[tab.criado_por]) || tab?.responsavel_nome || ''
}

/** Ids of the logins that opened these tabs whose names we do not know yet. */
export function missingOpeners(tabs = [], names = {}) {
  return [...new Set((tabs || []).map(x => x?.criado_por).filter(id => id && !(id in names)))]
}

/** Rows of the list: carried tabs first (oldest first), then tonight's in opening order. */
export function tabsListRows(tabs = [], today) {
  return sortCarriedFirst(tabs, today).map(x => ({ tab: x, carried: isCarriedTab(x, today) }))
}
