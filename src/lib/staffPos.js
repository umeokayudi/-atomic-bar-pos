/**
 * Staff POS helpers (pure). Who can be marked on a sale, the drink-back of each person on a shared
 * sale, and "my sales tonight". Credit rules live in saleCredit.js.
 */

import { drinkBackCommission } from './drinkBackPay.js'
import { agentStaffId, personCredit, staffAliases } from './saleCredit.js'
import { nightKeyOfSale } from './nightClose.js'

/**
 * People who can be marked on a sale: active staff logins (not the owner, not till devices) and the
 * active drink-back agents. An agent linked to a staff member is that person (one entry, staff id).
 * Only { id, nome, agentId, pct } leave the server: no pay, contact or access fields.
 */
export function castRoster(staff = [], agents = []) {
  const activeAgents = (agents || []).filter(a => a && a.id && a.ativo !== false)
  const byStaff = new Map(activeAgents.filter(a => agentStaffId(a)).map(a => [agentStaffId(a), a]))
  const out = []
  const linked = new Set()
  for (const s of staff || []) {
    if (!s?.id || s.ativo === false) continue
    if (s.role === 'cliente' || s.role === 'caixa') continue
    const nome = String(s.nome || '').trim()
    if (!nome) continue
    const agent = byStaff.get(String(s.id))
    if (agent) linked.add(agent.id)
    out.push({ id: String(s.id), nome, agentId: agent ? String(agent.id) : '', pct: agent ? +agent.comissao_pct || 0 : 0 })
  }
  for (const a of activeAgents) {
    if (linked.has(a.id) || out.some(p => p.id === String(a.id))) continue
    const nome = String(a.nome || '').trim()
    if (!nome) continue
    out.push({ id: String(a.id), nome, agentId: String(a.id), pct: +a.comissao_pct || 0 })
  }
  return out
}

/** Owner till without a roster: the drink-back agents as people. */
export function castPeopleFromAgents(agents = []) {
  return castRoster([], agents)
}

/** The roster always holds the signed-in person (first), even when the team could not be loaded. */
export function withMe(people = [], me) {
  if (!me?.id) return people || []
  const list = (people || []).filter(p => p.id !== me.id)
  const mine = (people || []).find(p => p.id === me.id) || { id: me.id, nome: me.nome || '', agentId: '', pct: 0 }
  return [{ ...mine, nome: mine.nome || me.nome || '' }, ...list]
}

/**
 * Drink-back on a sale shared by several people: each person with a drink-back % earns it on her equal
 * part of the drinks. Returns { total, by: { personId: yen } } (by is empty for a single person).
 */
export function castCommission(lines = [], people = []) {
  const list = (people || []).filter(Boolean)
  if (!list.length) return { total: 0, by: {} }
  const by = {}
  let total = 0
  for (const p of list) {
    const pct = +p.pct || 0
    const yen = pct > 0 ? Math.round(drinkBackCommission(lines, pct) / list.length) : 0
    by[p.id] = yen
    total += yen
  }
  return { total, by: list.length > 1 ? by : {} }
}

/** The drink_back_agent_id column keeps one agent: the first person on the sale who is one. */
export function castAgentId(people = []) {
  return (people || []).find(p => p?.agentId)?.agentId || ''
}

/** Tonight's sales credited to me: { tickets, sales, commission, rows } (see saleCredit.personCredit). */
export function mySalesTonight(sales = [], me, { nightKey, agents = [] } = {}) {
  if (!me?.id) return { tickets: 0, sales: 0, commission: 0, rows: [] }
  const tonight = (sales || []).filter(s => !nightKey || nightKeyOfSale(s) === nightKey)
  return personCredit(tonight, me, { aliases: staffAliases(agents) })
}
