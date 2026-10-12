/**
 * Pure helpers for the floor status chips (Free, Occupied, …): which tables are in a state,
 * with the open tab money and details. Input is the "live" table list FloorScreen already builds
 * (table + state + open tabs with items + money + minutes). Unit tested in scripts/floorStatus.test.mjs.
 */

/** Earliest opening time (ms) of a table's open tabs, or null. */
function openedAt(open = []) {
  const ts = open.map(c => Date.parse(c.aberta_em)).filter(Number.isFinite)
  return ts.length ? Math.min(...ts) : null
}

/** Units on a tab: itens_qtd when loaded with it, else Σ qtd of its live lines. */
function itemCount(tab) {
  if (tab?.itens_qtd != null) return +tab.itens_qtd || 0
  return (tab?.items || []).filter(i => !i.removido_em).reduce((a, i) => a + (+i.qtd || 0), 0)
}

/**
 * Tables in one state, ready to list. Rows with an open tab come first, longest open first;
 * the rest keep their name order. Totals add up every row.
 */
export function tablesInState(live = [], state) {
  const rows = live.filter(tb => tb.state === state).map(tb => {
    const open = tb.open || []
    const since = openedAt(open)
    const servers = [...new Set(open.map(c => (c.responsavel_nome || '').trim()).filter(Boolean))]
    return {
      id: tb.id,
      nome: tb.nome,
      capacidade: +tb.capacidade || 0,
      guests: open.reduce((a, c) => a + (+c.pessoas || 0), 0),
      since: since == null ? null : new Date(since).toISOString(),
      minutes: open.length ? (+tb.minutes || 0) : 0,
      servers,
      items: open.reduce((a, c) => a + itemCount(c), 0),
      total: +tb.money?.total || 0,
      due: +tb.money?.due || 0,
      tabs: open.map(c => ({ id: c.id, nome: c.nome })),
      table: tb,
    }
  })
  rows.sort((a, b) => {
    if (!!a.since !== !!b.since) return a.since ? -1 : 1
    if (a.since && b.since && a.since !== b.since) return a.since < b.since ? -1 : 1
    return String(a.nome || '').localeCompare(String(b.nome || ''), undefined, { numeric: true })
  })
  return {
    rows,
    count: rows.length,
    tabs: rows.reduce((a, r) => a + r.tabs.length, 0),
    guests: rows.reduce((a, r) => a + r.guests, 0),
    items: rows.reduce((a, r) => a + r.items, 0),
    total: rows.reduce((a, r) => a + r.total, 0),
    due: rows.reduce((a, r) => a + r.due, 0),
  }
}
