import assert from 'node:assert/strict'
import {
  agentStaffId, creditBoard, creditFor, creditShares, isPerson, personCredit, readCommissionBy, saleParticipants, splitEven, staffAliases,
} from '../src/lib/saleCredit.js'
import { castAgentId, castCommission, castRoster, mySalesTonight, withMe } from '../src/lib/staffPos.js'
import {
  formatCastList, orderCastFromObs, orderCastIdFromObs, orderCastListFromObs, orderDetailsFromObs, orderMeta, withOrderCast,
} from '../src/lib/orderMeta.js'
import { packTicketObs, readTicketMeta } from '../src/lib/nightTicket.js'
import { staffDayReport } from '../src/lib/staffDayReport.js'
import { buildGoalProgress } from '../src/lib/barGoals.js'
import { salaryBoard } from '../src/lib/barClose.js'
import { guardSalePatch, stampSaleRows } from '../api/_posSaleStamp.js'

let n = 0
const queue = []
const test = (name, fn) => queue.push([name, fn])
const sum = rows => rows.reduce((a, r) => a + r.amount, 0)
const AT = '2026-10-09T13:00:00.000Z' // 22:00 Tokyo, night 2026-10-09

test('splitEven: whole yen, exact total, leftover to the first parts', () => {
  assert.deepEqual(splitEven(1000, 1), [1000])
  assert.deepEqual(splitEven(1000, 2), [500, 500])
  assert.deepEqual(splitEven(1000, 3), [334, 333, 333])
  assert.deepEqual(splitEven(1001, 2), [501, 500])
  assert.deepEqual(splitEven(5, 4), [2, 1, 1, 1])
  assert.deepEqual(splitEven(2, 3), [1, 1, 0])
  assert.deepEqual(splitEven(0, 2), [0, 0])
  assert.deepEqual(splitEven(-1000, 3), [-334, -333, -333])
  assert.deepEqual(splitEven(1000, 0), [])
  assert.deepEqual(splitEven(999.6, 2), [500, 500], 'rounds the amount to yen first')
})

test('cast line: several people, round trip, old single-cast tickets still read', () => {
  const line = withOrderCast('VIP 1', [{ name: 'Aiko', id: 'st1' }, { name: 'Ken', id: 'st2' }, { name: 'Aiko', id: 'st1' }])
  assert.equal(line, 'Cast: Aiko|st1; Ken|st2\nVIP 1')
  assert.deepEqual(orderCastListFromObs(line), [{ name: 'Aiko', id: 'st1' }, { name: 'Ken', id: 'st2' }])
  assert.equal(orderCastFromObs(line), 'Aiko, Ken')
  assert.equal(orderCastIdFromObs(line), 'st1')
  assert.equal(orderDetailsFromObs(line), 'VIP 1')
  assert.equal(formatCastList([{ name: 'A;b|c', id: 'x' }]), 'A b c|x', 'separators never leak into a name')
  // Old shapes.
  assert.deepEqual(orderCastListFromObs('Cast: Ana'), [{ name: 'Ana', id: '' }])
  assert.deepEqual(orderCastListFromObs('Cast: Someone|b\nNight: 2026-10-09'), [{ name: 'Someone', id: 'b' }])
  assert.equal(orderMeta('Cast: Ana|a1\nhello').cast, 'Ana')
  assert.equal(orderMeta('Cast: Ana|a1\nhello').details, 'hello')
  assert.deepEqual(orderCastListFromObs(''), [])
})

test('packTicketObs: cast list + per-person drink-back; meta lines stay out of the details', () => {
  const obs = packTicketObs({ details: 'Sofa', cast: [{ name: 'Aiko', id: 'st1' }, { name: 'Ken', id: 'st2' }], commission: 1000, commissionBy: { st1: 1000, st2: 0 }, nightKey: '2026-10-09' })
  assert.match(obs, /^Cast: Aiko\|st1; Ken\|st2$/m)
  assert.match(obs, /^Comm: 1000$/m)
  assert.match(obs, /^CommBy: st1=1000;st2=0$/m)
  assert.equal(readTicketMeta(obs).commission, 1000)
  assert.equal(orderDetailsFromObs(obs), 'Sofa')
  assert.deepEqual([...readCommissionBy(obs)], [['st1', 1000], ['st2', 0]])
  // Old single-cast call still works.
  assert.match(packTicketObs({ castName: 'Ana', castId: 'a1' }), /^Cast: Ana\|a1$/m)
})

test('creditShares: 1, 2 and 3 people, remainder to the first marked', () => {
  const one = creditShares({ total: 9000, obs: 'Cast: Aiko|st1', criado_por: 'own1' })
  assert.deepEqual(one.map(r => [r.staffId, r.amount, r.share, r.via]), [['st1', 9000, 1, 'cast']], 'cast wins over the ringer')
  const two = creditShares({ total: 9001, obs: 'Cast: Aiko|st1; Ken|st2' })
  assert.deepEqual(two.map(r => [r.staffId, r.amount]), [['st1', 4501], ['st2', 4500]])
  assert.equal(two[0].share, 0.5)
  const three = creditShares({ total: 10000, obs: 'Cast: Ken|st2; Aiko|st1; Mika|pp1' })
  assert.deepEqual(three.map(r => [r.staffId, r.amount]), [['st2', 3334], ['st1', 3333], ['pp1', 3333]])
  assert.equal(sum(three), 10000)
  for (const total of [1, 2, 7, 999, 12345, 100001]) {
    for (const k of [1, 2, 3, 4, 7]) {
      const obs = `Cast: ${Array.from({ length: k }, (_, i) => `P${i}|p${i}`).join('; ')}`
      assert.equal(sum(creditShares({ total, obs })), total, `exact for ${total}/${k}`)
    }
  }
  assert.equal(sum(creditShares({ total: 10000, refunded: 4000, obs: 'Cast: A|a; B|b' })), 6000, 'net of refunds')
  assert.deepEqual(creditShares({ total: 5000, obs: 'Cast: A|a; B|b' }, { amount: 3 }).map(r => r.amount), [2, 1])
})

test('creditShares: legacy shapes and the ringer fallback', () => {
  assert.deepEqual(creditShares({ total: 5000, obs: 'Cast: Ana' }).map(r => [r.staffId, r.name, r.amount]), [['', 'Ana', 5000]])
  assert.deepEqual(creditShares({ total: 5000, obs: '', drink_back_agent_id: 'dba1' }).map(r => [r.staffId, r.via]), [['dba1', 'agent']])
  assert.deepEqual(creditShares({ total: 5000, obs: '', criado_por: 'st1' }).map(r => [r.staffId, r.via, r.amount]), [['st1', 'ringer', 5000]])
  assert.deepEqual(creditShares({ total: 5000, staff_id: 'st9', criado_por: 'st1' }).map(r => r.staffId), ['st9'])
  assert.deepEqual(creditShares({ total: 5000, obs: '' }), [], 'nobody to credit')
  assert.deepEqual(creditShares({ total: 5000, criado_por: 'st1' }, { castOnly: true }), [], 'drink-back screens ignore the ringer')
  assert.deepEqual(saleParticipants({ obs: 'Cast: A|a; A|a; B' }).map(p => p.id || p.name), ['a', 'B'], 'duplicates once')
})

test('agent links: an agent tied to a staff member is the same person', () => {
  const agents = [{ id: 'dba1', nome: 'Aiko Tanaka', notas: 'staff:st1' }, { id: 'dba2', nome: 'Marco', staff_id: 'st2' }, { id: 'dba3', nome: 'Yuki' }]
  assert.equal(agentStaffId(agents[0]), 'st1')
  assert.equal(agentStaffId(agents[1]), 'st2')
  assert.equal(agentStaffId(agents[2]), '')
  const aliases = staffAliases(agents)
  const sale = { total: 6000, obs: 'Cast: Aiko Tanaka|dba1; Yuki|dba3' }
  assert.deepEqual(creditShares(sale, { agents }).map(r => [r.staffId, r.amount]), [['st1', 3000], ['dba3', 3000]])
  assert.equal(creditFor(sale, { id: 'st1', nome: 'X' }, { agents }).amount, 3000, 'staff id matches the linked agent id')
  assert.equal(creditFor({ total: 4000, obs: 'Cast: Aiko|st1' }, { id: 'dba1', agentId: 'dba1', nome: 'X' }, { agents }).amount, 4000, 'and the other way round')
  assert.equal(creditFor(sale, { id: 'zz', nome: 'yuki' }).amount, 3000, 'name match without links')
  assert.equal(creditFor(sale, { id: 'zz', nome: 'Nobody' }), null)
  assert.equal(isPerson({ staffId: 'dba2', name: '' }, { id: 'st2' }, aliases), true)
  // Both marked: one shared sale, no double credit for the same person under two ids.
  assert.deepEqual(creditShares({ total: 1000, obs: 'Cast: Aiko|dba1; Aiko|st1' }, { agents }).map(r => [r.staffId, r.amount]), [['st1', 1000]])
})

test('commission: per-person line, else the ticket total split equally', () => {
  const by = creditShares({ total: 8000, obs: 'Cast: A|a; B|b\nComm: 1000\nCommBy: a=1000;b=0' })
  assert.deepEqual(by.map(r => r.commission), [1000, 0])
  const even = creditShares({ total: 8000, obs: 'Cast: A|a; B|b; C|c\nComm: 1000' })
  assert.deepEqual(even.map(r => r.commission), [334, 333, 333])
  assert.deepEqual(creditShares({ total: 8000, obs: 'Cast: Ana\nComm: 600' }).map(r => r.commission), [600])
})

test('personCredit / creditBoard / mySalesTonight', () => {
  const sales = [
    { id: 's1', total: 9000, obs: 'Cast: Aiko|st1; Ken|st2', criado_em: AT },
    { id: 's2', total: 3000, obs: '', criado_por: 'st1', criado_em: AT },
    { id: 's3', total: 5000, obs: 'Cast: Ken|st2', criado_por: 'st1', criado_em: AT },
    { id: 's4', total: 7000, obs: 'Cast: Aiko|st1', criado_em: '2026-10-08T13:00:00.000Z' },
  ]
  const me = personCredit(sales, { id: 'st1', nome: 'Aiko' })
  assert.deepEqual([me.tickets, me.sales], [3, 4500 + 3000 + 7000])
  const tonight = mySalesTonight(sales, { id: 'st1', nome: 'Aiko' }, { nightKey: '2026-10-09' })
  assert.deepEqual([tonight.tickets, tonight.sales], [2, 7500], 'rung for Ken: his, not hers; last night excluded')
  assert.deepEqual(tonight.rows.map(r => [r.sale.id, r.amount, r.share]), [['s1', 4500, 0.5], ['s2', 3000, 1]])
  const board = creditBoard(sales.slice(0, 3))
  assert.deepEqual(board.map(r => [r.id, r.sales, r.tickets]), [['st2', 9500, 2], ['st1', 7500, 2]])
  assert.deepEqual(creditBoard(sales.slice(0, 3), { castOnly: true }).map(r => [r.id, r.sales]), [['st2', 9500], ['st1', 4500]])
})

test('staff day report: shared tickets split, own sales by the ringer, unassigned', () => {
  const r = staffDayReport({
    night: '2026-10-09',
    staff: [{ id: 'st1', nome: 'Aiko' }, { id: 'st2', nome: 'Ken' }, { id: 'st3', nome: 'Mika' }],
    punches: [],
    agents: [{ id: 'dba3', nome: 'Mika agent', notas: 'staff:st3' }],
    tickets: [
      { total: 9001, obs: 'Cast: Aiko|st1; Ken|st2\nComm: 0', criado_em: AT },
      { total: 3000, obs: '', criado_por: 'st2', criado_em: AT },
      { total: 6000, obs: 'Cast: Mika agent|dba3; Aiko|st1; Ken|st2', criado_em: AT },
      { total: 1000, obs: '', criado_em: AT },
    ],
    now: '2026-10-09T15:00:00.000Z',
  })
  const by = Object.fromEntries(r.rows.map(x => [x.id, x]))
  assert.deepEqual([by.st1.tickets, by.st1.sales], [2, 4501 + 2000])
  assert.deepEqual([by.st2.tickets, by.st2.sales], [3, 4500 + 3000 + 2000])
  assert.deepEqual([by.st3.tickets, by.st3.sales], [1, 2000], 'agent id on the ticket counts for the linked staff member')
  assert.equal(r.totals.sales, 9001 + 3000 + 6000, 'shares add up to the credited tickets')
  assert.equal(r.totals.unassigned, 1)
})

test('goals per person and the salary board use the equal split', () => {
  const nightKey = '2026-10-09'
  const tickets = [
    { total: 10000, obs: 'Cast: Aiko|st1; Lucia|st3', criado_em: AT },
    { total: 4000, obs: 'Cast: Lucia', criado_em: AT },
  ]
  const p = buildGoalProgress({ tickets, people: [{ id: 'st1', nome: 'Aiko', drink_back: true }, { id: 'st3', nome: 'Lucia', drink_back: true }], nightKey, goals: { pessoas: [{ id: 'st1', noite: 10000 }] } })
  const by = Object.fromEntries(p.pessoas.map(x => [x.id, x]))
  assert.equal(by.st1.noite, 5000)
  assert.equal(by.st1.noitePct, 50)
  assert.equal(by.st3.noite, 9000)
  const board = salaryBoard({ payroll: [{ staff_id: 'st1', nome: 'Aiko', pay: 10000, hours: 5 }, { staff_id: 'st3', nome: 'Lucia', pay: 3000, hours: 2 }], tickets, monthKey: '2026-10' })
  const sb = Object.fromEntries(board.rows.map(x => [x.id, x]))
  assert.equal(sb.st1.sales, 5000)
  assert.equal(sb.st3.sales, 9000)
})

test('staff POS helpers: roster without private fields, drink-back per person, agent column', () => {
  const roster = castRoster([
    { id: 'own1', nome: 'Owner', role: 'cliente' },
    { id: 'st1', nome: 'Aiko', role: 'bar_staff', salario_hora: 1600, email: 'a@x', telefone: '090', acessos: ['clock'] },
    { id: 'st2', nome: 'Ken', role: 'bar_staff', ativo: false },
    { id: 'ln1', nome: 'Front till', role: 'caixa', lane: true },
    { id: 'gm', nome: 'Manager', role: 'gerente' },
  ], [
    { id: 'dba1', nome: 'Aiko agent', notas: 'staff:st1', comissao_pct: 10, ativo: true },
    { id: 'dba2', nome: 'Marco', comissao_pct: 15, ativo: true },
    { id: 'dba3', nome: 'Old', comissao_pct: 8, ativo: false },
  ])
  assert.deepEqual(roster, [
    { id: 'st1', nome: 'Aiko', agentId: 'dba1', pct: 10 },
    { id: 'gm', nome: 'Manager', agentId: '', pct: 0 },
    { id: 'dba2', nome: 'Marco', agentId: 'dba2', pct: 15 },
  ])
  for (const p of roster) assert.deepEqual(Object.keys(p).sort(), ['agentId', 'id', 'nome', 'pct'])
  assert.deepEqual(withMe(roster, { id: 'gm', nome: 'Manager' }).map(p => p.id), ['gm', 'st1', 'dba2'])
  assert.deepEqual(withMe([], { id: 'x', nome: 'Me' }), [{ id: 'x', nome: 'Me', agentId: '', pct: 0 }])
  const lines = [{ drink_menu_id: 'd', qtd: 2, preco_unitario: 3000, forCast: true }]
  assert.deepEqual(castCommission(lines, [roster[0]]), { total: 400, by: {} })
  assert.deepEqual(castCommission(lines, [roster[0], roster[1], roster[2]]), { total: 133 + 0 + 200, by: { st1: 133, gm: 0, dba2: 200 } })
  assert.deepEqual(castCommission(lines, []), { total: 0, by: {} })
  assert.equal(castAgentId([roster[1], roster[2]]), 'dba2')
  assert.equal(castAgentId([roster[1]]), '')
})

test('server: who rang the sale is the signed-in login, never the browser', () => {
  const auth = { user: { id: 'st1' }, perfil: { id: 'st1', role: 'bar_staff', bar_id: 'b1' } }
  const rows = stampSaleRows('pos_vendas', [{ bar_id: 'b1', total: 100, criado_por: 'owner-forged', staff_id: 'x' }], auth)
  assert.equal(rows[0].criado_por, 'st1')
  assert.equal('staff_id' in rows[0], false)
  assert.equal(rows[0].total, 100)
  const lane = stampSaleRows('pos_vendas', [{ total: 1 }], { user: { id: 'lane-7' }, perfil: { role: 'caixa' } })
  assert.equal(lane[0].criado_por, 'lane-7')
  assert.equal(stampSaleRows('pos_vendas', [{ criado_por: 'forged' }], {})[0].criado_por, undefined, 'no login: no ringer at all')
  const other = [{ criado_por: 'keep' }]
  assert.equal(stampSaleRows('bar_guests', other, auth), other)
  assert.deepEqual(guardSalePatch('pos_vendas', { guest_id: 'g', criado_por: 'x', staff_id: 'y' }, auth), { guest_id: 'g' })
  assert.deepEqual(guardSalePatch('pos_vendas', { criado_por: 'x' }, { perfil: { role: 'admin' } }), { criado_por: 'x' })
  assert.deepEqual(guardSalePatch('bar_guests', { criado_por: 'x' }, auth), { criado_por: 'x' })
})

for (const [name, fn] of queue) {
  try {
    await fn()
    n += 1
    console.log(`ok ${n} - ${name}`)
  } catch (e) {
    console.error(`not ok - ${name}`)
    console.error(e)
    process.exitCode = 1
  }
}
console.log(`\n${n}/${queue.length} passed`)
