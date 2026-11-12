import assert from 'node:assert/strict'
import { filterRows, openTabsCount, openedStamp, tabRows } from '../src/lib/tabsList.js'

let n = 0
function test(name, fn) { fn(); n++; console.log('ok', name) }

// The 13/11/2026 case at Atomic: 6 open tabs, 1 with ¥46,200 and 5 empty; one of them from the night before.
const today = '2026-11-12'
const big = { id: 'a', nome: 'Table 3', status: 'open', aberta_em: '2026-11-12T12:05:00Z', responsavel_nome: 'Mika', items: [{ qtd: 2 }], payments: [] }
const old = { id: 'y', nome: 'Ken', status: 'open', aberta_em: '2026-11-11T13:00:00Z', responsavel_nome: 'Aya', items: [], payments: [] }
const empties = [1, 2, 3, 4].map(i => ({ id: `e${i}`, nome: `Walk-in ${i}`, status: 'open', aberta_em: `2026-11-12T1${i}:00:00Z`, items: [], payments: [] }))
const tabs = [big, ...empties, old]
const totals = { a: 46200 }

test('the counter counts every open tab, ¥0 ones too', () => {
  assert.equal(openTabsCount(tabs, []), 6)
  assert.equal(openTabsCount(tabs, ['tab-1']), 7)
  assert.equal(openTabsCount(), 0)
})

test('rows: all 6, the one from yesterday first, totals and who opened', () => {
  const rows = tabRows({ serverTabs: tabs, total: x => totals[x.id] || 0, today })
  assert.equal(rows.length, 6)
  assert.equal(rows[0].id, 'y')
  assert.equal(rows[0].carried, true)
  assert.equal(rows.filter(r => r.carried).length, 1)
  const a = rows.find(r => r.id === 'a')
  assert.equal(a.total, 46200)
  assert.equal(a.empty, false)
  assert.equal(a.openedBy, 'Mika')
  assert.equal(rows.filter(r => r.empty).length, 5)
  assert.equal(rows.reduce((s, r) => s + r.total, 0), 46200)
})

test('local device tabs are listed after the server ones', () => {
  const rows = tabRows({ serverTabs: [big], localTabs: [{ id: 'tab-1', label: 'Bar 2', total: 0, openedAt: '2026-11-12T12:00:00Z' }], total: () => 1000, today })
  assert.deepEqual(rows.map(r => r.key), ['srv:a', 'tab-1'])
  assert.equal(rows[1].server, false)
  assert.equal(rows[1].empty, true)
})

test('opened stamp shows date and time in Tokyo', () => {
  assert.equal(openedStamp('2026-11-12T12:05:00Z'), '12 Nov 21:05')
  assert.equal(openedStamp('2026-11-11T16:30:00Z'), '12 Nov 01:30')
  assert.equal(openedStamp(''), '')
  assert.match(openedStamp('2026-11-12T12:05:00Z', 'ja'), /11\/12.*21:05/)
})

test('search by name, table or person', () => {
  const rows = tabRows({ serverTabs: tabs, total: () => 0, today })
  assert.deepEqual(filterRows(rows, 'mika').map(r => r.id), ['a'])
  assert.equal(filterRows(rows, 'walk').length, 4)
  assert.equal(filterRows(rows, '').length, 6)
})

console.log(`${n} tests passed`)
