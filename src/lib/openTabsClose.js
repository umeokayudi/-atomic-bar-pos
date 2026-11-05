/**
 * Open tabs at the day close (pure helpers, unit tested in scripts/openTabsClose.test.mjs).
 *
 * Rule (owner, 05/11/2026): the only warning is at the day close. If a tab is still open, the Close screen lists it
 * and the team closes it or hands it to someone else. The day can only be closed with tabs still open with the
 * owner's PIN and a written reason (an exception, stored in the live table pos_close_exceptions). A tab left open
 * that way shows the next day at the top of the tabs, marked "from yesterday, check it", until someone closes or
 * transfers it. Nothing warns during the night.
 */

import { tokyoNightKey } from './tokyo.js'

export const EXCEPTION_TABLE = 'pos_close_exceptions'
export const REASON_MIN = 5
export const OPEN_TAB_STATUSES = ['open', 'awaiting_payment']

/** Business night a tab belongs to (before 06:00 Tokyo counts as the night before). */
export function tabNight(tab) {
  const at = tab?.aberta_em ? new Date(tab.aberta_em) : null
  return at && !Number.isNaN(at.getTime()) ? tokyoNightKey(at) : ''
}

/** Open tabs that belong to night `night` or earlier: these keep that night's close from being concluded. */
export function tabsBlockingNight(tabs = [], night) {
  return (tabs || []).filter(x => OPEN_TAB_STATUSES.includes(x.status || 'open') && tabNight(x) && tabNight(x) <= night)
}

/** A tab opened on an earlier night than `today` that is still open: "from yesterday, check it". */
export function isCarriedTab(tab, today = tokyoNightKey()) {
  const n = tabNight(tab)
  return !!n && n < today
}

/** Carried-over tabs first (oldest first), then tonight's in their normal order. Stable. */
export function sortCarriedFirst(tabs = [], today = tokyoNightKey()) {
  return (tabs || [])
    .map((x, i) => ({ x, i, old: isCarriedTab(x, today), n: tabNight(x) }))
    .sort((a, b) => (a.old !== b.old ? (a.old ? -1 : 1) : a.old ? (a.n < b.n ? -1 : a.n > b.n ? 1 : a.i - b.i) : a.i - b.i))
    .map(r => r.x)
}

/** Minutes a tab has been open. */
export function openMinutes(tab, now = Date.now()) {
  const at = Date.parse(tab?.aberta_em || '')
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 60000)) : 0
}

/** { h, m } for "open for 3 h 20 min"; h is 0 under an hour. */
export function ageParts(minutes) {
  const total = Math.max(0, Math.floor(+minutes || 0))
  return { h: Math.floor(total / 60), m: total % 60 }
}

/** Can the tab be cancelled (opened by mistake): no live lines and no live payments. */
export function isEmptyTab(tab) {
  const lines = (tab?.items || []).filter(i => !i.removido_em)
  const pays = (tab?.payments || []).filter(p => !p.estornado_em)
  return lines.length === 0 && pays.length === 0
}

/** The line added to the tab note when it changes hands, so it stays on the tab with who and when. */
export function transferNote(prevObs, { from, to, by, at = new Date() }) {
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  const line = `[${when}] ${from || '—'} → ${to}${by && by !== to ? ` (by ${by})` : ''}`
  const prev = String(prevObs || '').trim()
  return (prev ? `${prev}\n${line}` : line).slice(-2000)
}

/** Check the exception form before it goes to the server. Returns an error key or ''. */
export function exceptionError({ pin, reason, tabs }) {
  if (!(tabs || []).length) return 'noTabs'
  if (!/^\d{4,8}$/.test(String(pin || ''))) return 'badPin'
  if (String(reason || '').trim().length < REASON_MIN) return 'shortReason'
  return ''
}

/** What the server stores about each tab in an exception (no lines, just enough to find it again). */
export function exceptionTabs(tabs = [], totals = {}) {
  return (tabs || []).slice(0, 60).map(x => ({
    id: String(x.id),
    nome: String(x.nome || '').slice(0, 80),
    // Accepts a tab row (mesa_nome / responsavel_nome) or an already cleaned entry (mesa / responsavel).
    mesa: (x.mesa_nome ?? x.mesa) ? String(x.mesa_nome ?? x.mesa).slice(0, 40) : null,
    responsavel: (x.responsavel_nome ?? x.responsavel) ? String(x.responsavel_nome ?? x.responsavel).slice(0, 80) : null,
    aberta_em: x.aberta_em || null,
    total: Math.round(+totals[x.id] || 0),
  }))
}

/**
 * Is the close of `night` cleared? Yes when no open tab blocks it, or when an exception for that night (or later) covers
 * every blocking tab (a tab opened after the exception needs a new one).
 */
export function closeCleared(blocking = [], exceptions = [], night) {
  if (!blocking.length) return true
  const covered = new Set()
  for (const e of exceptions || []) {
    // An exception recorded at this close or a later one covers the tabs it lists.
    if (!e?.night_key || e.night_key < night) continue
    for (const x of e.tabs || []) covered.add(String(x.id))
  }
  return blocking.every(x => covered.has(String(x.id)))
}

/** Server-side cleaning of the exception body. Returns { row } or { error }. */
export function cleanException(body = {}, { barId, actor, now = new Date() }) {
  const night = String(body.night_key || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return { error: 'night required' }
  const reason = String(body.reason || '').trim().slice(0, 500)
  if (reason.length < REASON_MIN) return { error: `Write a reason (at least ${REASON_MIN} letters)` }
  const list = Array.isArray(body.tabs) ? body.tabs.filter(x => x && x.id) : []
  const tabs = exceptionTabs(list, Object.fromEntries(list.map(x => [String(x.id), x.total])))
  if (!tabs.length) return { error: 'No open tabs listed' }
  return {
    row: {
      id: `${barId}:${night}:${now.getTime().toString(36)}`,
      bar_id: barId,
      night_key: night,
      tabs,
      reason,
      authorized_by: 'owner_pin',
      asked_by: actor?.id || null,
      asked_by_nome: actor?.nome || null,
      criado_em: now.toISOString(),
    },
  }
}
