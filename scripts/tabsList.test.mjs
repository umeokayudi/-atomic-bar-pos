import assert from 'node:assert/strict'
import { countOpenTabs, missingOpeners, openedAtLabel, openerName, tabsListRows } from '../src/lib/tabsList.js'
import { tonightGlance } from '../src/lib/onAccount.js'

let n = 0
function test(name, fn) { fn(); n++; console.log('ok', name) }

// What the owner saw on 13/11/2026: 6 open tabs, 1 with ¥46,200 and 5 empty. The header said "1 tabs".
const tabs = [
  { id: 'a', nome: 'ze', status: 'open', aberta_em: '2026-10-17T09:03:24Z', criado_por: 'u1', responsavel_nome: 'umeokayudi' },
  { id: 'b', nome: 'lots', status: 'open', aberta_em: '2026-10-17T09:04:20Z', criado_por: 'u1', responsavel_nome: 'umeokayudi' },
  { id: 'c', nome: 'Mesa 39', status: 'open', aberta_em: '2026-10-17T09:05:01Z', criado_por: 'u1' },
  { id: 'd', nome: '4', status: 'open', aberta_em: '2026-10-17T09:05:25Z', criado_por: 'u1' },
  { id: 'e', nome: 'Joao', status: 'awaiting_payment', aberta_em: '2026-11-03T09:06:59Z', criado_por: 'u2' },
  { id: 'f', nome: '2', status: 'open', aberta_em: '2026-11-12T12:00:00Z', responsavel_nome: 'Benny' },
]

test('the counter counts every open tab, empty ones included', () => {
  assert.equal(countOpenTabs(tabs), 6)
  assert.equal(countOpenTabs([...tabs, { id: 'x', status: 'closed' }, { id: 'y', status: 'cancelled' }]), 6)
  assert.equal(countOpenTabs([]), 0)
  assert.equal(countOpenTabs(), 0)
  // The "tonight" card on the till: 6 tabs open, only one has money on it.
  const g = tonightGlance({ tabs: [{ total: 46200, paid: 0 }, ...Array(5).fill({ total: 0, paid: 0 })] })
  assert.equal(g.openCount, 6)
  assert.equal(g.openTotal, 46200)
})

test('opened at shows the date and the time, Tokyo time', () => {
  assert.equal(openedAtLabel('2026-11-12T12:05:00Z'), '12/11 21:05')
  assert.equal(openedAtLabel('2026-11-12T12:05:00Z', 'ja'), '11/12 21:05')
  // After midnight in Tokyo it is already the next calendar day.
  assert.equal(openedAtLabel('2026-11-12T16:30:00Z'), '13/11 01:30')
  assert.equal(openedAtLabel(''), '')
  assert.equal(openedAtLabel('nope'), '')
})

test('who opened: the creating login first, then the person responsible', () => {
  const names = { u1: 'Benny Diallo' }
  assert.equal(openerName(tabs[0], names), 'Benny Diallo')
  assert.equal(openerName(tabs[4], names), '')
  assert.equal(openerName(tabs[5], names), 'Benny')
  assert.deepEqual(missingOpeners(tabs, names), ['u2'])
  assert.deepEqual(missingOpeners(tabs, { u1: 'B', u2: null }), [])
})

test('the list keeps tabs from earlier nights at the top, marked', () => {
  const rows = tabsListRows([tabs[5], tabs[4], tabs[0]], '2026-11-12')
  assert.deepEqual(rows.map(r => r.tab.id), ['a', 'e', 'f'])
  assert.deepEqual(rows.map(r => r.carried), [true, true, false])
})

console.log(`${n} tabsList tests passed`)
