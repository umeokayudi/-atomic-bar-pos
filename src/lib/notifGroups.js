/**
 * Notification panel order: overdue money first (oldest due date on top), then order events grouped by type.
 * Order events older than ARCHIVE_DAYS are archived (folded at the bottom, deleted after DELETE_DAYS).
 */
export const ARCHIVE_DAYS = 14
export const DELETE_DAYS = 60

const TYPE_ORDER = ['pedido_novo', 'pedido_confirmado', 'pedido_entregue', 'pedido_cancelado']

function ageDays(iso, now) {
  const when = new Date(iso).getTime()
  if (!iso || Number.isNaN(when)) return 0
  return (now - when) / 86400000
}

/** Oldest due date first, then the larger amount. */
export function sortOverdue(rows = []) {
  return [...(rows || [])].sort((a, b) =>
    String(a.date || '9999').localeCompare(String(b.date || '9999')) || (+b.amount || 0) - (+a.amount || 0))
}

/** Splits order events into groups by type (unread first inside a group) and an archive of old ones. */
export function groupNotifs(notifs = [], now = Date.now()) {
  const groups = new Map()
  const archived = []
  for (const n of notifs || []) {
    if (n.lida && ageDays(n.criado_em, now) > ARCHIVE_DAYS) { archived.push(n); continue }
    const k = n.tipo || 'other'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(n)
  }
  const rank = k => { const i = TYPE_ORDER.indexOf(k); return i < 0 ? TYPE_ORDER.length : i }
  const list = [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([tipo, items]) => ({
      tipo,
      items: items.sort((a, b) => (a.lida === b.lida ? String(b.criado_em).localeCompare(String(a.criado_em)) : a.lida ? 1 : -1)),
    }))
  return { groups: list, archived }
}

/** Ids of read events old enough to delete for good. */
export function expiredIds(notifs = [], now = Date.now()) {
  return (notifs || []).filter(n => n.lida && ageDays(n.criado_em, now) > DELETE_DAYS).map(n => n.id)
}
