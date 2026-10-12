import assert from 'node:assert/strict'
import {
  billingEvent, readRoomMeta, roomClock, roomCost, roomHourLine, roomNoteText, vipDaily, vipDailyTotals, vipSettings, visitBilling, writeRoomMeta,
} from '../src/lib/vipBilling.js'
import { drinkCount, newPeopleByNight, readWalk, summarizeWalkIns, walkLine } from '../src/lib/walkIn.js'
import { packTicketObs, readTicketMeta } from '../src/lib/nightTicket.js'
import { floorMetrics, floorScale, fromDbTable, isDecor, toSavePayload } from '../src/lib/floorEditor.js'
import { tokyoNightKey } from '../src/lib/tokyo.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`) }

test('room price per hour lives on the room note and keeps what people typed', () => {
  assert.deepEqual(readRoomMeta(null), { hourPrice: 0 })
  const notas = writeRoomMeta('Karaoke inside', { hourPrice: 3000 })
  assert.equal(notas, 'VipHour: 3000\nKaraoke inside')
  assert.equal(readRoomMeta(notas).hourPrice, 3000)
  assert.equal(roomNoteText(notas), 'Karaoke inside')
  assert.equal(writeRoomMeta(notas, { hourPrice: 0 }), 'Karaoke inside')
  assert.equal(writeRoomMeta(null, { hourPrice: 0 }), null)
  assert.equal(readRoomMeta(writeRoomMeta(notas, { hourPrice: 4500 })).hourPrice, 4500)
})

test('cost for hours and bar settings with safe defaults', () => {
  assert.equal(roomCost(3000, 120), 6000)
  assert.equal(roomCost(3000, 90), 4500)
  assert.equal(roomCost(0, 120), 0)
  assert.deepEqual(vipSettings({}), { blockMin: 120, warnMin: 15 })
  assert.deepEqual(vipSettings({ vip_block_min: 60, vip_warn_min: 10 }), { blockMin: 60, warnMin: 10 })
  assert.deepEqual(vipSettings({ vip_block_min: 5, vip_warn_min: 999 }), { blockMin: 120, warnMin: 15 })
})

test('till asks at the start, 15 min before each 2h block ends, and when time is over', () => {
  const t0 = Date.parse('2026-10-11T12:00:00Z')
  const visit = { id: 'v1', inicio: new Date(t0).toISOString(), vip_eventos: [] }
  assert.equal(roomClock(visit, t0 + 60000).state, 'start')
  assert.equal(roomClock(visit, t0 + 60000).askNow, true)
  const charged = { ...visit, vip_eventos: [billingEvent({ acao: 'cobrar', min: 120, hourPrice: 3000, now: new Date(t0) })] }
  assert.equal(charged.vip_eventos[0].valor, 6000)
  assert.equal(roomClock(charged, t0 + 60 * 60000).state, 'ok')
  assert.equal(roomClock(charged, t0 + 60 * 60000).askNow, false)
  assert.equal(roomClock(charged, t0 + 106 * 60000).state, 'soon')
  assert.equal(roomClock(charged, t0 + 106 * 60000).leftMin, 14)
  assert.equal(roomClock(charged, t0 + 130 * 60000).state, 'over')
  const waived = { ...charged, vip_eventos: [...charged.vip_eventos, billingEvent({ acao: 'livre', min: 120, hourPrice: 3000 })] }
  const b = visitBilling(waived)
  assert.deepEqual([b.billedMin, b.waivedMin, b.billedYen, b.coveredMin], [120, 120, 6000, 240])
  assert.equal(roomClock(waived, t0 + 130 * 60000).state, 'ok')
  assert.notEqual(roomClock(charged, t0).snoozeKey, roomClock(waived, t0).snoozeKey, 'a new block asks again')
})

test('room hour line is a room charge, not a drink', () => {
  const line = roomHourLine({ room: { id: 'r1', nome: '個室 VIP 1' }, min: 120, hourPrice: 3000 })
  assert.equal(line.tipo_preco, 'room_min')
  assert.equal(line.preco_unitario, 6000)
  assert.equal(line.nome, '個室 VIP 1 · 2h')
  assert.equal(line.drink_menu_id, null)
  assert.equal(drinkCount([line, { qtd: 2, tipo_preco: 'regular' }]), 2)
})

test('VIP charts per night: open hours, used, charged, free, fee and spend', () => {
  const rooms = [{ id: 'r1' }, { id: 'r2' }]
  const start = Date.parse('2026-10-10T12:00:00Z') // 21:00 Tokyo on the 10th
  const visits = [
    { id: 'a', space_id: 'r1', status: 'done', inicio: new Date(start).toISOString(), fim: new Date(start + 180 * 60000).toISOString(),
      vip_eventos: [{ acao: 'cobrar', min: 120, valor: 6000 }, { acao: 'livre', min: 120, valor: 0 }] },
    { id: 'b', space_id: 'zz', status: 'done', inicio: new Date(start).toISOString(), fim: new Date(start + 60 * 60000).toISOString() },
  ]
  const sales = [{ id: 's1', space_id: 'r1', total: 20000, criado_em: new Date(start + 30 * 60000).toISOString() }, { id: 's2', visit_id: 'a', total: 6000, criado_em: new Date(start + 90 * 60000).toISOString() }]
  const days = vipDaily({ rooms, visits, sales, from: '2026-10-10', to: '2026-10-11', abre: 20, fecha: 5, now: new Date(start + 600 * 60000) })
  assert.equal(days.length, 2)
  assert.deepEqual(
    [days[0].openMin, days[0].usedMin, days[0].billedMin, days[0].waivedMin, days[0].roomFee, days[0].spend, days[0].uses],
    [540, 180, 120, 120, 6000, 26000, 1],
  )
  const tot = vipDailyTotals(days, 2)
  assert.equal(tot.usedPct, Math.round((180 / (1080 * 2)) * 100))
})

test('pay-as-you-go: Walk line on the ticket counts people and their drinks', () => {
  assert.equal(walkLine('w1abc', 2), 'Walk: w1abc 2')
  assert.equal(walkLine('bad id!', 0), 'Walk: badid')
  const obs = packTicketObs({ nightKey: '2026-10-10', payNote: 'Cash', walk: walkLine('w1', 2), details: 'note' })
  assert.deepEqual(readWalk(obs), { id: 'w1', drinks: 2 })
  assert.equal(readTicketMeta(obs).details, 'note', 'Walk line stays out of the visible notes')
  const at = h => new Date(Date.parse('2026-10-10T12:00:00Z') + h * 3600000).toISOString()
  const sales = [
    { total: 1600, obs: 'Walk: w1 2', criado_em: at(0) },
    { total: 800, obs: 'Walk: w2 1', criado_em: at(0.5) },
    { total: 800, obs: 'Walk: w1 1', criado_em: at(1) },
    { total: 3000, obs: 'Night: 2026-10-10', criado_em: at(1) },
  ]
  const night = tokyoNightKey(new Date(at(0)))
  const s = summarizeWalkIns(sales, night)
  assert.deepEqual([s.people, s.drinks, s.spend, s.avgDrinks], [2, 4, 3200, 2])
  assert.equal(s.byPerson[0].id, 'w1')
  const np = newPeopleByNight({ sales, guests: [{ criado_em: at(0.2) }, { criado_em: at(48) }], nights: [night], nightOf: tokyoNightKey })
  assert.deepEqual([np.rows[0].walk, np.rows[0].crm, np.rows[0].total], [2, 1, 3])
})

test('floor: entertainment saved as a stage with a note, read back as itself', () => {
  assert.ok(isDecor('darts') && isDecor('pool'))
  assert.equal(fromDbTable({ forma: 'stage', nota: 'Fun: darts' }).forma, 'darts')
  assert.equal(fromDbTable({ forma: 'stage', nota: 'Fun: rocket' }).forma, 'stage')
  assert.equal(fromDbTable({ forma: 'round', nota: 'Reserved' }).forma, 'round')
  const state = {
    layout: { id: 'L', versao: 1, nome: 'Main', largura: 1200, altura: 800 },
    sectors: [],
    tables: [
      { id: 'tmp-1', nome: 'Darts', forma: 'darts', x: 0, y: 0, largura: 60, altura: 60, capacidade: 0 },
      { id: 'a', nome: '1', forma: 'round', x: 0, y: 0, largura: 100, altura: 100, capacidade: 4, nota: 'Fun: darts' },
      { id: 'b', nome: '2', forma: 'square', x: 0, y: 0, largura: 100, altura: 100, capacidade: 4, nota: 'VIP guest' },
    ],
  }
  const p = toSavePayload(state)
  assert.deepEqual([p.tables[0].forma, p.tables[0].nota], ['stage', 'Fun: darts'])
  assert.deepEqual([p.tables[1].forma, p.tables[1].nota], ['round', null], 'old entertainment note cleared')
  assert.ok(!('nota' in p.tables[2]), 'other notes untouched')
})

test('floor: size in metres, seats, standing estimate and entertainment count', () => {
  assert.deepEqual(floorScale({}), { pxPerM: 50, m2PerPerson: 1.5 })
  const m = floorMetrics({
    layout: { largura: 1200, altura: 800 },
    tables: [
      { forma: 'round', largura: 100, altura: 100, capacidade: 4 },
      { forma: 'bar', largura: 500, altura: 50, capacidade: 8 },
      { forma: 'wall', largura: 1200, altura: 10, capacidade: 0 },
      { forma: 'darts', largura: 50, altura: 50, capacidade: 0 },
      { forma: 'square', largura: 100, altura: 100, capacidade: 4, ativo: false },
    ],
  }, { pxPerM: 50, m2PerPerson: 1.5 })
  assert.deepEqual([m.widthM, m.heightM, m.areaM2], [24, 16, 384])
  assert.equal(m.furnitureM2, 15)
  assert.equal(m.freeM2, 369)
  assert.equal(m.seats, 12)
  assert.equal(m.standing, 246)
  assert.equal(m.capacity, 258)
  assert.deepEqual(m.fun, [{ kind: 'darts', n: 1 }])
})

console.log(`\n${n} passed`)
