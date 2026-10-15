/**
 * Who a till sale counts for, and how much each person gets. Pure: no fetch, no writes.
 *
 * Rule (owner, Oct 2026: "isso atribuir ao trabalho dela … quando tiver mais de uma pessoa junto
 * devera ser distribuido de forma igualitaria"):
 *   1. People marked as cast on the ticket ("Cast: Aiko|id1; Ken|id2") share the sale. A staff member
 *      ringing her own sale on the staff POS is marked by default, so it counts for her.
 *   2. Old tickets with no Cast line but a drink-back agent column: that agent.
 *   3. Nobody marked: whoever rang it up. That is `staff_id`, or `criado_por`, which the server stamps
 *      from the signed-in login (pos_commit_sale uses auth.uid(); /api/bar/live-db overwrites it).
 * With several people the amount is split equally in whole yen. Leftover yen go one each to the first
 * people in ticket order, so the shares always add up to the sale exactly.
 *
 * Ids: a cast id may be a staff login id or a drink_back_agents id. An agent linked to a staff member
 * (notas "staff:<id>" or staff_id) is the same person; pass `agents` so both ids match.
 */

import { orderCastListFromObs } from './orderMeta.js'
import { readTicketMeta } from './nightTicket.js'
import { saleNet } from './nightClose.js'

const COMM_BY = /^CommBy:\s*(.+)$/im

/** amount split into n whole-yen parts; the first (amount mod n) parts get 1 yen more. */
export function splitEven(amount, n) {
  const count = Math.max(0, Math.floor(+n || 0))
  if (!count) return []
  const total = Math.round(+amount || 0)
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  const base = Math.floor(abs / count)
  const rest = abs - base * count
  return Array.from({ length: count }, (_, i) => sign * (base + (i < rest ? 1 : 0)))
}

/** Staff id an agent stands for, or ''. */
export function agentStaffId(agent) {
  if (!agent) return ''
  if (agent.staff_id) return String(agent.staff_id)
  const m = String(agent.notas || '').match(/^staff:(.+)$/)
  return m ? m[1].trim() : ''
}

/** agent id → staff id for linked agents. */
export function staffAliases(agents = []) {
  const map = new Map()
  for (const a of agents || []) {
    const sid = agentStaffId(a)
    if (a?.id && sid) map.set(String(a.id), sid)
  }
  return map
}

function canon(id, aliases) {
  const s = String(id || '')
  return (aliases && aliases.get(s)) || s
}

/** The login that rang the sale up. */
export function saleRinger(sale) {
  return String(sale?.staff_id || sale?.criado_por || '')
}

function aliasesOf(opts) {
  return opts?.aliases instanceof Map ? opts.aliases : staffAliases(opts?.agents)
}

/**
 * People the sale counts for, in ticket order: [{ id, name, via }] with via 'cast' | 'agent' | 'ringer'.
 * opts.castOnly: leave out the ringer fallback (drink-back screens: only people marked on the ticket).
 */
export function saleParticipants(sale, opts = {}) {
  const aliases = aliasesOf(opts)
  const out = []
  const seen = new Set()
  const push = (id, name, via) => {
    const cid = id ? canon(id, aliases) : ''
    const key = cid || `n:${String(name || '').trim().toLowerCase()}`
    if (key === 'n:' || seen.has(key)) return
    seen.add(key)
    out.push({ id: cid, name: String(name || '').trim(), via })
  }
  for (const c of orderCastListFromObs(sale?.obs)) push(c.id, c.name, 'cast')
  if (!out.length && sale?.drink_back_agent_id) push(sale.drink_back_agent_id, sale.drink_back_agent_nome || '', 'agent')
  if (!out.length && !opts.castOnly) {
    const ringer = saleRinger(sale)
    if (ringer) push(ringer, sale?.staff_nome || '', 'ringer')
  }
  return out
}

/** "CommBy: id=600;id2=0" → Map(id → yen), or null when the ticket has no per-person line. */
export function readCommissionBy(obs, aliases) {
  const m = String(obs || '').match(COMM_BY)
  if (!m) return null
  const map = new Map()
  for (const part of m[1].split(';')) {
    const [id, v] = part.split('=')
    if (!id || !id.trim()) continue
    const key = canon(id.trim(), aliases)
    map.set(key, (map.get(key) || 0) + Math.round(+v || 0))
  }
  return map
}

/**
 * [{ staffId, name, share, amount, commission, via }] — one row per person, amounts add up to the sale.
 * opts.amount overrides the sale amount (default: net of refunds). opts.agents / opts.aliases: id links.
 * Commission: the per-person CommBy line when present, otherwise the ticket's Comm split equally.
 */
export function creditShares(sale, opts = {}) {
  const aliases = aliasesOf(opts)
  const people = saleParticipants(sale, { ...opts, aliases })
  if (!people.length) return []
  const amount = opts.amount != null ? opts.amount : saleNet(sale)
  const parts = splitEven(amount, people.length)
  const by = readCommissionBy(sale?.obs, aliases)
  const comm = by ? null : splitEven(readTicketMeta(sale?.obs).commission || 0, people.length)
  return people.map((p, i) => ({
    staffId: p.id,
    name: p.name,
    share: 1 / people.length,
    amount: parts[i],
    commission: by ? (by.get(p.id) || 0) : comm[i],
    via: p.via,
  }))
}

/** Does this credit row (or participant) belong to the person? Same id (through agent links) or same name. */
export function isPerson(row, person, aliases) {
  if (!row || !person) return false
  const rid = row.staffId ?? row.id
  if (rid) {
    const c = canon(rid, aliases)
    if (person.id && c === canon(person.id, aliases)) return true
    if (person.agentId && c === canon(person.agentId, aliases)) return true
  }
  const name = String(row.name || '').trim().toLowerCase()
  return !!name && name === String(person.nome || person.name || '').trim().toLowerCase()
}

/** The person's part of one sale, or null. */
export function creditFor(sale, person, opts = {}) {
  const aliases = aliasesOf(opts)
  return creditShares(sale, { ...opts, aliases }).find(r => isPerson(r, person, aliases)) || null
}

/** Totals for one person over many sales: { tickets, sales, commission, rows: [{ sale, amount, share, commission }] }. */
export function personCredit(sales = [], person, opts = {}) {
  const aliases = aliasesOf(opts)
  const rows = []
  for (const sale of sales || []) {
    const hit = creditFor(sale, person, { ...opts, aliases })
    if (hit) rows.push({ sale, amount: hit.amount, share: hit.share, commission: hit.commission })
  }
  return {
    tickets: rows.length,
    sales: rows.reduce((a, r) => a + r.amount, 0),
    commission: rows.reduce((a, r) => a + r.commission, 0),
    rows,
  }
}

/** Everyone credited on these sales: [{ id, name, sales, tickets, commission }], best seller first. */
export function creditBoard(sales = [], opts = {}) {
  const aliases = aliasesOf(opts)
  const map = new Map()
  for (const sale of sales || []) {
    for (const r of creditShares(sale, { ...opts, aliases })) {
      const key = r.staffId || `n:${r.name.toLowerCase()}`
      const prev = map.get(key) || { id: r.staffId || r.name, name: r.name, sales: 0, tickets: 0, commission: 0 }
      if (r.name && !prev.name) prev.name = r.name
      prev.sales += r.amount
      prev.tickets += 1
      prev.commission += r.commission
      map.set(key, prev)
    }
  }
  return [...map.values()].sort((a, b) => b.sales - a.sales)
}
