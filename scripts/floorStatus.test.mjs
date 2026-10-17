import assert from 'node:assert/strict'
import { tablesInState } from '../src/lib/floorStatus.js'

const live = [
  { id: 'a', nome: 'T10', capacidade: 4, state: 'free', open: [], money: { total: 0, due: 0 }, minutes: 0 },
  { id: 'b', nome: 'T2', capacidade: 4, state: 'free', open: [], money: { total: 0, due: 0 }, minutes: 0 },
  {
    id: 'c', nome: 'Sofa', capacidade: 6, state: 'occupied', minutes: 30, money: { total: 12000, due: 7000 },
    open: [
      { id: 't1', nome: 'Sato', pessoas: 3, aberta_em: '2026-10-12T20:30:00Z', responsavel_nome: 'Yuki', itens_qtd: 5 },
      { id: 't2', nome: 'Sato 2', pessoas: 1, aberta_em: '2026-10-12T20:45:00Z', responsavel_nome: ' Yuki ', items: [{ qtd: 2 }, { qtd: 1, removido_em: 'x' }] },
    ],
  },
  {
    id: 'd', nome: 'Bar', capacidade: 2, state: 'occupied', minutes: 90, money: { total: 3000, due: 3000 },
    open: [{ id: 't3', nome: 'Walk-in', pessoas: 2, aberta_em: '2026-10-12T19:30:00Z', itens_qtd: 2 }],
  },
]

// Empty state.
const none = tablesInState(live, 'cleaning')
assert.equal(none.count, 0)
assert.deepEqual(none.rows, [])
assert.equal(none.total, 0)

// Free tables: name order (numeric aware), no tab details.
const free = tablesInState(live, 'free')
assert.deepEqual(free.rows.map(r => r.nome), ['T2', 'T10'])
assert.equal(free.rows[0].since, null)
assert.equal(free.rows[0].minutes, 0)

// Occupied: longest open first, totals, guests, items, servers de-duplicated.
const occ = tablesInState(live, 'occupied')
assert.deepEqual(occ.rows.map(r => r.id), ['d', 'c'])
const sofa = occ.rows[1]
assert.equal(sofa.guests, 4)
assert.equal(sofa.items, 7)
assert.deepEqual(sofa.servers, ['Yuki'])
assert.equal(sofa.since, '2026-10-12T20:30:00.000Z')
assert.deepEqual(sofa.tabs.map(x => x.id), ['t1', 't2'])
assert.equal(occ.rows[0].servers.length, 0)
assert.equal(occ.count, 2)
assert.equal(occ.tabs, 3)
assert.equal(occ.guests, 6)
assert.equal(occ.items, 9)
assert.equal(occ.total, 15000)
assert.equal(occ.due, 10000)

// Defaults do not throw.
assert.equal(tablesInState(undefined, 'free').count, 0)

console.log('floorStatus: all tests passed')
