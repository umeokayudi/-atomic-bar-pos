/**
 * The bar's drink queue (the barman's "Bar" screen), kept in public.pos_bar_fila (sql/bar_queue.sql).
 *
 * Every order sent from the till (a tab's Send, a counter sale) or from a waiter's panel becomes one ticket.
 * The barman taps it: novo -> pronto (drink finished, card turns green) -> entregue (leaves the queue).
 * chegou_em -> pronto_em is how long the drink took; that is what the metrics read.
 *
 * Pure helpers on top, Supabase calls at the bottom. Pushing a ticket never breaks a sale: errors are swallowed.
 */

export const OPEN_STATUSES = ['novo', 'preparando', 'pronto']

/** Queue load colour: up to 3 open orders green, more than 3 yellow, more than 5 red. */
export const LOAD_YELLOW = 3
export const LOAD_RED = 5
export function queueTone(openCount) {
  const n = +openCount || 0
  if (n > LOAD_RED) return 'red'
  if (n > LOAD_YELLOW) return 'yellow'
  return 'green'
}

/** Till cart / tab lines -> the ticket's drinks (same drink merged), skipping charges (service, room, set). */
export function ticketItems(lines = []) {
  const skip = new Set(['set', 'nominho', 'service', 'room_min'])
  const map = new Map()
  for (const l of lines || []) {
    if (!l || skip.has(l.tipo_preco) || skip.has(l.kind)) continue
    const qtd = +l.qtd || 0
    if (qtd <= 0) continue
    const key = l.drink_menu_id ? `d-${l.drink_menu_id}` : l.produto_id ? `p-${l.produto_id}` : `n-${l.nome}`
    const hit = map.get(key)
    if (hit) hit.qtd += qtd
    else map.set(key, { nome: String(l.nome || '').trim() || '—', qtd, drink_menu_id: l.drink_menu_id || null, produto_id: l.produto_id || null })
  }
  return [...map.values()]
}

/** Seconds between two ISO times (null when either is missing). */
export function secondsBetween(from, to) {
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.round((b - a) / 1000))
}

/** "2:05" (m:ss) or "1:02:05" from seconds. */
export function clockLabel(sec) {
  const s = Math.max(0, Math.floor(+sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** Open tickets oldest first; finished ones (pronto) after the waiting ones so the barman sees what to make first. */
export function sortQueue(rows = []) {
  const rank = r => (r.status === 'pronto' ? 1 : 0)
  return [...(rows || [])]
    .filter(r => OPEN_STATUSES.includes(r.status))
    .sort((a, b) => rank(a) - rank(b) || String(a.chegou_em).localeCompare(String(b.chegou_em)))
}

/**
 * The night's numbers from its tickets: how many were made, average / slowest time to make (arrival -> ready),
 * average time to the guest (arrival -> delivered), drinks made, and the same per barman.
 */
export function queueMetrics(rows = []) {
  const made = (rows || []).filter(r => r && r.pronto_em && r.status !== 'cancelado')
  const prep = made.map(r => secondsBetween(r.chegou_em, r.pronto_em)).filter(v => v != null)
  const toGuest = (rows || []).filter(r => r && r.entregue_em).map(r => secondsBetween(r.chegou_em, r.entregue_em)).filter(v => v != null)
  const avg = list => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null)
  const people = new Map()
  for (const r of made) {
    const key = r.feito_por || r.feito_por_nome || '—'
    const p = people.get(key) || { id: r.feito_por || null, nome: r.feito_por_nome || '—', tickets: 0, drinks: 0, secs: [] }
    p.tickets += 1
    p.drinks += +r.qtd || 0
    const s = secondsBetween(r.chegou_em, r.pronto_em)
    if (s != null) p.secs.push(s)
    people.set(key, p)
  }
  return {
    tickets: made.length,
    drinks: made.reduce((a, r) => a + (+r.qtd || 0), 0),
    avgPrep: avg(prep),
    maxPrep: prep.length ? Math.max(...prep) : null,
    avgToGuest: avg(toGuest),
    byPerson: [...people.values()]
      .map(p => ({ id: p.id, nome: p.nome, tickets: p.tickets, drinks: p.drinks, avgPrep: avg(p.secs) }))
      .sort((a, b) => b.tickets - a.tickets),
  }
}

/** Ids in `rows` that were not in `seen` (cards that just arrived: they flash). */
export function newIds(rows = [], seen = new Set()) {
  return (rows || []).filter(r => r.status === 'novo' && !seen.has(r.id)).map(r => r.id)
}

/** Recipe text of a ticket line from the bar's menu (drink_menu.receita), split into ingredients. */
export function recipeFor(item, menu = []) {
  const drink = (menu || []).find(d => (item.drink_menu_id && d.id === item.drink_menu_id) || (!item.drink_menu_id && String(d.nome).trim().toLowerCase() === String(item.nome).trim().toLowerCase()))
  const text = String(drink?.receita || '').trim()
  return text ? text.split(/\s*\+\s*/).map(s => s.replace(/\s*\(\s*¥[^)]*\)\s*$/, '').trim()).filter(Boolean) : []
}

const isMissing = e => /pos_bar_fila|does not exist|schema cache|42P01|PGRST205/i.test(`${e?.code || ''} ${e?.message || ''}`)

/** Add an order to the queue. Safe to call twice with the same key. Never throws. */
export async function pushTicket(supabase, { barId, key, origem = 'tab', comandaId = null, label = '', lines = [], byName = null }) {
  try {
    const itens = ticketItems(lines)
    if (!barId || !key || !itens.length) return { ok: false, skipped: true }
    const row = {
      bar_id: barId, idem_key: String(key), origem, comanda_id: comandaId, label: label || null,
      itens, qtd: itens.reduce((a, l) => a + l.qtd, 0), pedido_por_nome: byName || null,
    }
    const { error } = await supabase.from('pos_bar_fila').upsert(row, { onConflict: 'bar_id,idem_key', ignoreDuplicates: true })
    if (error) return { ok: false, missing: isMissing(error), error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Open tickets plus the last `hours` of finished ones (for the metrics). */
export async function loadQueue(supabase, barId, hours = 14) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString()
  const { data, error } = await supabase.from('pos_bar_fila').select('*')
    .eq('bar_id', barId).gte('chegou_em', since).order('chegou_em', { ascending: true }).limit(500)
  if (error) {
    if (isMissing(error)) return { missing: true, rows: [] }
    throw error
  }
  return { missing: false, rows: data || [] }
}

/** Move a ticket. `pronto` / `entregue` stamp the time and who did it (first stamp wins). */
export async function moveTicket(supabase, row, status, me = {}) {
  const now = new Date().toISOString()
  const patch = { status }
  if (status === 'preparando' && !row.iniciado_em) patch.iniciado_em = now
  if (status === 'pronto' || status === 'entregue') {
    if (!row.pronto_em) patch.pronto_em = now
    if (!row.feito_por) { patch.feito_por = me.id || null; patch.feito_por_nome = me.nome || null }
  }
  if (status === 'entregue' && !row.entregue_em) patch.entregue_em = now
  if (status === 'novo') { patch.pronto_em = null; patch.entregue_em = null; patch.feito_por = null; patch.feito_por_nome = null }
  const { error } = await supabase.from('pos_bar_fila').update(patch).eq('id', row.id)
  if (error) throw error
  return { ...row, ...patch }
}
