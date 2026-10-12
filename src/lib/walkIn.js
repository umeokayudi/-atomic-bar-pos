/**
 * Pay-as-you-go guests on quiet nights: no tab, each drink paid on its own, but the till still knows
 * it is the same person. Every such sale carries "Walk: <id> <drinks>" in pos_vendas.obs, so any device
 * can count people, drinks per person and new guests of the night without a new table.
 */

import { saleOnNight } from './nightClose.js'

const WALK_RE = /^Walk:\s*([A-Za-z0-9_-]+)(?:\s+(\d+))?\s*$/im

export function walkLine(id, drinks = 0) {
  const clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)
  if (!clean) return ''
  const n = Math.max(0, Math.round(+drinks || 0))
  return n ? `Walk: ${clean} ${n}` : `Walk: ${clean}`
}

export function readWalk(obs) {
  const m = String(obs || '').match(WALK_RE)
  return m ? { id: m[1], drinks: m[2] ? +m[2] : 0 } : null
}

export function newWalkId(now = Date.now()) {
  return `w${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** Drinks on a cart: every line that is not a room / service / set charge. */
export function drinkCount(lines = []) {
  return (lines || [])
    .filter(l => !['set', 'nominho', 'service', 'room_min'].includes(l.tipo_preco))
    .reduce((a, l) => a + Math.max(0, +l.qtd || 0), 0)
}

/**
 * Tonight's pay-as-you-go guests. people = distinct guests (each one is new to the night),
 * drinks = drinks they bought, spend = what they paid. byPerson is sorted by arrival.
 */
export function summarizeWalkIns(sales = [], nightKey) {
  const map = new Map()
  for (const s of sales || []) {
    if (nightKey && !saleOnNight(s, nightKey)) continue
    const w = readWalk(s.obs)
    if (!w) continue
    const row = map.get(w.id) || { id: w.id, drinks: 0, spend: 0, tickets: 0, first: s.criado_em || '' }
    row.drinks += w.drinks
    row.spend += Math.round(+s.total || 0) - Math.round(+s.refunded || 0)
    row.tickets += 1
    if (s.criado_em && (!row.first || s.criado_em < row.first)) row.first = s.criado_em
    map.set(w.id, row)
  }
  const byPerson = [...map.values()].sort((a, b) => String(a.first).localeCompare(String(b.first)))
  const drinks = byPerson.reduce((a, r) => a + r.drinks, 0)
  const spend = byPerson.reduce((a, r) => a + r.spend, 0)
  return {
    people: byPerson.length,
    drinks,
    spend,
    avgDrinks: byPerson.length ? Math.round((drinks / byPerson.length) * 10) / 10 : 0,
    byPerson,
  }
}

/**
 * New people per night: every pay-as-you-go guest counts as a new person of that night, plus CRM
 * customers created that night (first time in the book). Returns rows for a chart and the totals.
 */
export function newPeopleByNight({ sales = [], guests = [], nights = [], nightOf }) {
  const crm = new Map()
  for (const g of guests || []) {
    const key = g?.criado_em ? nightOf(new Date(g.criado_em)) : ''
    if (key) crm.set(key, (crm.get(key) || 0) + 1)
  }
  const rows = nights.map(night => {
    const w = summarizeWalkIns(sales, night)
    const crmNew = crm.get(night) || 0
    return { night, walk: w.people, drinks: w.drinks, spend: w.spend, crm: crmNew, total: w.people + crmNew }
  })
  const totals = rows.reduce((a, r) => ({
    walk: a.walk + r.walk, drinks: a.drinks + r.drinks, spend: a.spend + r.spend, crm: a.crm + r.crm, total: a.total + r.total,
  }), { walk: 0, drinks: 0, spend: 0, crm: 0, total: 0 })
  totals.avgDrinks = totals.walk ? Math.round((totals.drinks / totals.walk) * 10) / 10 : 0
  return { rows, totals }
}
