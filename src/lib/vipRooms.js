/** VIP room rentals. POS money inside the room only — never a JBM invoice. */

import { tokyoNightKey, tokyoWallToUtcMs } from './tokyo.js'
import { nextTokyoDateKey } from './nightClose.js'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dateList(from, to) {
  const start = String(from || '').slice(0, 10)
  const end = String(to || '').slice(0, 10)
  if (!start || !end || start > end) return []
  const out = []
  let cursor = start
  for (let i = 0; i < 62 && cursor <= end; i += 1) {
    out.push(cursor)
    cursor = nextTokyoDateKey(cursor)
  }
  return out
}

/** Open window for one nightlife day. Close at or before open rolls to the next calendar day. */
export function openWindow(nightKey, abre = 20, fecha = 5) {
  const [y, m, d] = String(nightKey).slice(0, 10).split('-').map(Number)
  const openH = ((+abre % 24) + 24) % 24
  const closeH = ((+fecha % 24) + 24) % 24
  const from = new Date(tokyoWallToUtcMs(y, m, d, openH, 0, 0, 0)).getTime()
  const endKey = closeH <= openH ? nextTokyoDateKey(nightKey) : nightKey
  const [ey, em, ed] = endKey.split('-').map(Number)
  const to = new Date(tokyoWallToUtcMs(ey, em, ed, closeH, 0, 0, 0)).getTime()
  return { nightKey, from, to, minutes: Math.max(0, Math.round((to - from) / 60000)) }
}

function overlapMinutes(startMs, endMs, win) {
  const a = Math.max(startMs, win.from)
  const b = Math.min(endMs, win.to)
  if (b <= a) return 0
  return Math.round((b - a) / 60000)
}

function visitSpan(visit, nowMs) {
  const start = new Date(visit?.inicio || visit?.criado_em || 0).getTime()
  if (!start || Number.isNaN(start)) return null
  const endRaw = visit?.fim ? new Date(visit.fim).getTime() : nowMs
  const end = Number.isNaN(endRaw) ? nowMs : endRaw
  return { start, end: Math.max(start, end) }
}

function isRental(visit) {
  return visit && (visit.status === 'seated' || visit.status === 'done')
}

function saleNight(sale) {
  const ts = sale?.criado_em || sale?.created_at
  if (ts) {
    const d = new Date(ts)
    if (!Number.isNaN(d.getTime())) return tokyoNightKey(d)
  }
  return String(sale?.data || '').slice(0, 10)
}

function inSpan(key, from, to) {
  if (!key) return false
  if (from && key < from) return false
  if (to && key > to) return false
  return true
}

export function summarizeVipRooms({
  rooms = [],
  visits = [],
  sales = [],
  from = '',
  to = '',
  abre = 20,
  fecha = 5,
  now = new Date(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const nights = dateList(from, to)
  const windows = nights.map(k => openWindow(k, abre, fecha))
  const openMinutes = windows.reduce((sum, w) => sum + w.minutes, 0)
  const roomIds = new Set(rooms.map(r => r.id))
  const rentals = (visits || []).filter(v => roomIds.has(v.space_id) && isRental(v))

  const salesByRoom = new Map()
  const usedSale = new Set()
  function addSale(roomId, sale) {
    if (!roomId || !sale?.id || usedSale.has(sale.id)) return
    if (!inSpan(saleNight(sale), from, to)) return
    usedSale.add(sale.id)
    const list = salesByRoom.get(roomId) || []
    list.push(sale)
    salesByRoom.set(roomId, list)
  }
  const visitRoom = new Map(rentals.map(v => [v.id, v.space_id]))
  for (const sale of sales || []) {
    if (roomIds.has(sale.space_id)) addSale(sale.space_id, sale)
    else if (visitRoom.has(sale.visit_id)) addSale(visitRoom.get(sale.visit_id), sale)
  }
  for (const visit of rentals) {
    if (!visit.pos_venda_id) continue
    const sale = (sales || []).find(s => s.id === visit.pos_venda_id)
    if (sale) addSale(visit.space_id, sale)
  }

  const rows = rooms.map(room => {
    const mine = rentals.filter(v => v.space_id === room.id)
    let times = 0
    let rentedMinutes = 0
    let usedSeatMinutes = 0
    for (const visit of mine) {
      const span = visitSpan(visit, nowMs)
      if (!span) continue
      let hit = 0
      for (const win of windows) hit += overlapMinutes(span.start, span.end, win)
      if (!hit) continue
      times += 1
      rentedMinutes += hit
      usedSeatMinutes += hit * Math.max(0, +visit.party_size || 0)
    }
    const seats = Math.max(1, +room.capacidade || 1)
    const available = seats * openMinutes
    const capacityPct = available > 0 ? Math.round((usedSeatMinutes / available) * 100) : 0
    const partyAvg = rentedMinutes > 0 ? Math.round((usedSeatMinutes / rentedMinutes) * 10) / 10 : 0
    const roomSales = salesByRoom.get(room.id) || []
    const revenue = roomSales.reduce((sum, s) => sum + (+s.total || 0), 0)
    return {
      id: room.id,
      nome: room.nome,
      seats,
      times,
      minutes: rentedMinutes,
      usedSeatMinutes,
      capacityPct,
      partyAvg,
      revenue: Math.round(revenue),
      tickets: roomSales.length,
    }
  })

  const totals = rows.reduce((acc, row) => ({
    times: acc.times + row.times,
    minutes: acc.minutes + row.minutes,
    revenue: acc.revenue + row.revenue,
    tickets: acc.tickets + row.tickets,
    seats: acc.seats + row.seats,
    usedSeatMinutes: acc.usedSeatMinutes + row.usedSeatMinutes,
  }), { times: 0, minutes: 0, revenue: 0, tickets: 0, seats: 0, usedSeatMinutes: 0 })
  const available = totals.seats * openMinutes
  totals.capacityPct = available > 0 ? Math.round((totals.usedSeatMinutes / available) * 100) : 0
  totals.partyAvg = totals.minutes > 0
    ? Math.round((rows.reduce((sum, row) => sum + row.partyAvg * row.minutes, 0) / totals.minutes) * 10) / 10
    : 0
  totals.openMinutes = openMinutes
  totals.openLabel = `${pad2(abre)}:00–${pad2(fecha)}:00`

  return { rows, totals, openMinutes }
}

function spaceOfSale(sale, spaceById, visitById, visitBySale) {
  if (sale?.space_id && spaceById.has(sale.space_id)) return sale.space_id
  const visit = visitById.get(sale?.visit_id) || visitBySale.get(sale?.id)
  if (visit?.space_id && spaceById.has(visit.space_id)) return visit.space_id
  return null
}

function guestOfSale(sale, guestsById, membersById, visitById, visitBySale) {
  const visit = visitById.get(sale?.visit_id) || visitBySale.get(sale?.id)
  const guestId = sale?.guest_id || visit?.guest_id || ''
  if (guestId) {
    const known = guestsById.get(guestId)
    const nome = known?.nome || visit?.bar_guests?.nome || ''
    if (!nome) return null
    return { key: `g:${guestId}`, nome }
  }
  const memberId = sale?.vip_member_id || ''
  if (memberId && membersById.get(memberId)) {
    return { key: `v:${memberId}`, nome: membersById.get(memberId) }
  }
  return null
}

/** Floor till and VIP-room till stay apart. One ticket lands in one place. */
export function placeRevenue({
  spaces = [],
  visits = [],
  sales = [],
  guests = [],
  members = [],
  from = '',
  to = '',
} = {}) {
  const active = (spaces || []).filter(s => s.ativo !== false)
  const spaceById = new Map(active.map(s => [s.id, s]))
  const vipIds = new Set(active.filter(s => s.tipo === 'vip_room' || s.zona === 'vip').map(s => s.id))
  const visitById = new Map((visits || []).map(v => [v.id, v]))
  const visitBySale = new Map()
  for (const visit of visits || []) {
    if (visit?.pos_venda_id) visitBySale.set(visit.pos_venda_id, visit)
  }
  const guestsById = new Map((guests || []).map(g => [g.id, g]))
  const membersById = new Map((members || []).filter(m => m?.id && m?.nome).map(m => [m.id, m.nome]))
  const bySpace = new Map()
  const byClient = new Map()
  const buckets = {
    floor: { revenue: 0, tickets: 0 },
    vip: { revenue: 0, tickets: 0 },
    open: { revenue: 0, tickets: 0 },
  }
  const seen = new Set()
  for (const sale of sales || []) {
    if (!sale?.id || seen.has(sale.id)) continue
    if (!inSpan(saleNight(sale), from, to)) continue
    seen.add(sale.id)
    const amount = +sale.total || 0
    const spaceId = spaceOfSale(sale, spaceById, visitById, visitBySale)
    let lane = 'open'
    if (spaceId && vipIds.has(spaceId)) lane = 'vip'
    else if (spaceId) lane = 'floor'
    buckets[lane].revenue += amount
    buckets[lane].tickets += 1
    if (spaceId) bySpace.set(spaceId, (bySpace.get(spaceId) || 0) + amount)
    const guest = guestOfSale(sale, guestsById, membersById, visitById, visitBySale)
    if (!guest) continue
    const row = byClient.get(guest.key) || { key: guest.key, nome: guest.nome, total: 0, vip: 0, floor: 0, open: 0, tickets: 0 }
    row.nome = guest.nome || row.nome
    row.total += amount
    row[lane] += amount
    row.tickets += 1
    byClient.set(guest.key, row)
  }
  for (const lane of Object.values(buckets)) lane.revenue = Math.round(lane.revenue)
  const clients = [...byClient.values()].map(row => ({
    ...row,
    total: Math.round(row.total),
    vip: Math.round(row.vip),
    floor: Math.round(row.floor),
    open: Math.round(row.open),
  })).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome))
  const spaceRevenue = new Map([...bySpace.entries()].map(([id, n]) => [id, Math.round(n)]))
  return { ...buckets, spaceRevenue, clients }
}

export function filterClients(clients = [], query = '') {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return (clients || []).filter(c => c.vip > 0)
  return (clients || []).filter(c => String(c.nome || '').toLowerCase().includes(q))
}
