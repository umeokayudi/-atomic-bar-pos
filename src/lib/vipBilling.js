/**
 * VIP room hourly charge. Pure helpers shared by the till, the VIP page and tests.
 *
 * - Price per hour lives on the room (bar_spaces.notas, line "VipHour: 3000"), so no migration is needed.
 * - Block length and warning time are bar settings on pos_settings (vip_block_min, vip_warn_min).
 * - Every decision at the till ("charge 2h more" / "leave it, no charge") is an event on the visit
 *   (bar_visits.vip_eventos), so the VIP page can show hours used, hours charged and hours given away.
 */

import { tokyoNightKey } from './tokyo.js'
import { openWindow } from './vipRooms.js'
import { nextTokyoDateKey } from './nightClose.js'

export const VIP_DEFAULTS = { blockMin: 120, warnMin: 15 }
const HOUR_RE = /^VipHour:\s*(\d+)\s*$/im

export function readRoomMeta(notas) {
  const m = String(notas || '').match(HOUR_RE)
  return { hourPrice: m ? Math.max(0, +m[1]) : 0 }
}

/** Free-text note without our meta line (what a person typed). */
export function roomNoteText(notas) {
  return String(notas || '').replace(new RegExp(HOUR_RE.source, 'gim'), '').replace(/^\s+|\s+$/g, '')
}

export function writeRoomMeta(notas, { hourPrice = 0 } = {}) {
  const body = roomNoteText(notas)
  const price = Math.max(0, Math.round(+hourPrice || 0))
  const head = price > 0 ? `VipHour: ${price}` : ''
  return [head, body].filter(Boolean).join('\n') || null
}

export function vipSettings(settings = {}) {
  const block = Math.round(+settings?.vip_block_min || 0)
  const warn = Math.round(+settings?.vip_warn_min || 0)
  return {
    blockMin: block >= 15 && block <= 720 ? block : VIP_DEFAULTS.blockMin,
    warnMin: warn >= 1 && warn <= 60 ? warn : VIP_DEFAULTS.warnMin,
  }
}

/** Cost of using a room for `minutes` at `hourPrice` per hour (rounded to the yen). */
export function roomCost(hourPrice, minutes) {
  return Math.round((Math.max(0, +hourPrice || 0) * Math.max(0, +minutes || 0)) / 60)
}

function events(visit) {
  return Array.isArray(visit?.vip_eventos) ? visit.vip_eventos.filter(e => e && (e.acao === 'cobrar' || e.acao === 'livre')) : []
}

/** What has been decided on this use so far. */
export function visitBilling(visit) {
  let billedMin = 0
  let waivedMin = 0
  let billedYen = 0
  for (const e of events(visit)) {
    const min = Math.max(0, Math.round(+e.min || 0))
    if (e.acao === 'cobrar') {
      billedMin += min
      billedYen += Math.max(0, Math.round(+e.valor || 0))
    } else waivedMin += min
  }
  return { billedMin, waivedMin, billedYen, coveredMin: billedMin + waivedMin, events: events(visit) }
}

function startMs(visit) {
  const t = new Date(visit?.inicio || visit?.criado_em || 0).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Where an open room is in its time blocks.
 * state: 'start' (nothing decided yet), 'ok', 'soon' (inside the warning time), 'over' (time ran out).
 * askNow is true when the till should ask "charge more or leave it".
 */
export function roomClock(visit, now = Date.now(), cfg = VIP_DEFAULTS) {
  const { blockMin, warnMin } = { ...VIP_DEFAULTS, ...cfg }
  const nowMs = now instanceof Date ? now.getTime() : +now
  const start = startMs(visit)
  const usedMin = start ? Math.max(0, Math.floor((nowMs - start) / 60000)) : 0
  const bill = visitBilling(visit)
  const leftMin = bill.coveredMin - usedMin
  let state = 'ok'
  if (bill.coveredMin === 0) state = 'start'
  else if (leftMin <= 0) state = 'over'
  else if (leftMin <= warnMin) state = 'soon'
  return {
    ...bill,
    usedMin,
    leftMin,
    state,
    blockMin,
    warnMin,
    endsAt: start ? start + bill.coveredMin * 60000 : 0,
    askNow: state !== 'ok',
    snoozeKey: `${visit?.id || ''}:${bill.coveredMin}`,
  }
}

/** Event to append on bar_visits.vip_eventos for a till decision. */
export function billingEvent({ acao, min, hourPrice = 0, por = '', now = new Date() }) {
  const m = Math.max(0, Math.round(+min || 0))
  return {
    acao: acao === 'cobrar' ? 'cobrar' : 'livre',
    min: m,
    valor: acao === 'cobrar' ? roomCost(hourPrice, m) : 0,
    em: (now instanceof Date ? now : new Date(now)).toISOString(),
    por: String(por || '').slice(0, 60),
  }
}

/** Till line for the room charge. Typed room_min so it stays apart from drinks (no stock, no commission). */
export function roomHourLine({ room, min, hourPrice }) {
  const valor = roomCost(hourPrice, min)
  const hours = Math.round((min / 60) * 10) / 10
  return {
    key: `vip-hour-${room?.id || 'room'}-${Date.now().toString(36)}`,
    kind: 'room_min',
    nome: `${room?.nome || '個室'} · ${hours}h`,
    qtd: 1,
    preco: valor,
    preco_unitario: valor,
    preco_lista: valor,
    tipo_preco: 'room_min',
    desconto_valor: 0,
    drink_menu_id: null,
    produto_id: null,
  }
}

function dateList(from, to) {
  const out = []
  let cur = String(from || '').slice(0, 10)
  const end = String(to || '').slice(0, 10)
  for (let i = 0; i < 62 && cur && end && cur <= end; i += 1) {
    out.push(cur)
    cur = nextTokyoDateKey(cur)
  }
  return out
}

/**
 * One row per night: hours the bar was open, hours the VIP rooms were used, hours charged and given away,
 * the room-hour money and everything spent in the rooms. Feeds the VIP charts.
 */
export function vipDaily({ rooms = [], visits = [], sales = [], from = '', to = '', abre = 20, fecha = 5, now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : +new Date(now)
  const roomIds = new Set((rooms || []).map(r => r.id))
  const nights = dateList(from, to)
  const rows = new Map(nights.map(k => [k, {
    night: k,
    openMin: openWindow(k, abre, fecha).minutes,
    usedMin: 0,
    billedMin: 0,
    waivedMin: 0,
    roomFee: 0,
    spend: 0,
    uses: 0,
  }]))
  for (const v of visits || []) {
    if (!roomIds.has(v.space_id) || (v.status !== 'seated' && v.status !== 'done')) continue
    const start = startMs(v)
    if (!start) continue
    const row = rows.get(tokyoNightKey(new Date(start)))
    if (!row) continue
    const end = v.fim ? new Date(v.fim).getTime() : nowMs
    row.uses += 1
    row.usedMin += Math.max(0, Math.round((Math.max(start, end) - start) / 60000))
    const bill = visitBilling(v)
    row.billedMin += bill.billedMin
    row.waivedMin += bill.waivedMin
    row.roomFee += bill.billedYen
  }
  const visitRoom = new Map((visits || []).map(v => [v.id, v.space_id]))
  const seen = new Set()
  for (const s of sales || []) {
    if (!s?.id || seen.has(s.id)) continue
    const inRoom = roomIds.has(s.space_id) || roomIds.has(visitRoom.get(s.visit_id))
    if (!inRoom) continue
    seen.add(s.id)
    const ts = s.criado_em ? tokyoNightKey(new Date(s.criado_em)) : String(s.data || '').slice(0, 10)
    const row = rows.get(ts)
    if (row) row.spend += Math.round(+s.total || 0)
  }
  return [...rows.values()]
}

export function vipDailyTotals(days = [], roomCount = 1) {
  const t = days.reduce((a, d) => ({
    openMin: a.openMin + d.openMin,
    usedMin: a.usedMin + d.usedMin,
    billedMin: a.billedMin + d.billedMin,
    waivedMin: a.waivedMin + d.waivedMin,
    roomFee: a.roomFee + d.roomFee,
    spend: a.spend + d.spend,
    uses: a.uses + d.uses,
  }), { openMin: 0, usedMin: 0, billedMin: 0, waivedMin: 0, roomFee: 0, spend: 0, uses: 0 })
  const room = Math.max(1, +roomCount || 1)
  t.usedPct = t.openMin ? Math.round((t.usedMin / (t.openMin * room)) * 100) : 0
  return t
}
