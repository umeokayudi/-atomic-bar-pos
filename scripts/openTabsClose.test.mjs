import assert from 'node:assert/strict'
import {
  ageParts, cleanException, closeCleared, exceptionError, exceptionTabs, isCarriedTab, isEmptyTab, openMinutes,
  sortCarriedFirst, tabNight, tabsBlockingNight, transferNote,
} from '../src/lib/openTabsClose.js'

let n = 0
function test(name, fn) { fn(); n++; console.log('ok', name) }

// Tokyo = UTC+9. 2026-11-04 22:00 JST = 13:00Z; 2026-11-05 02:00 JST = 2026-11-04 17:00Z (still the night of 11-04).
const t1 = { id: 'a', nome: 'Table 3', status: 'open', aberta_em: '2026-11-04T13:00:00Z', responsavel_nome: 'Mika', items: [{ qtd: 1 }], payments: [] }
const t2 = { id: 'b', nome: 'Walk-in', status: 'open', aberta_em: '2026-11-04T17:00:00Z', items: [], payments: [] }
const t3 = { id: 'c', nome: 'VIP 1', status: 'awaiting_payment', aberta_em: '2026-11-05T12:00:00Z', items: [], payments: [{ valor: 100 }] }
const t0 = { id: 'z', nome: 'Old', status: 'open', aberta_em: '2026-11-03T12:00:00Z', items: [], payments: [] }

test('night of a tab follows the 06:00 rule', () => {
  assert.equal(tabNight(t1), '2026-11-04')
  assert.equal(tabNight(t2), '2026-11-04')
  assert.equal(tabNight(t3), '2026-11-05')
  assert.equal(tabNight({}), '')
})

test('tabs blocking a night: that night and earlier, open statuses only', () => {
  const all = [t1, t2, t3, { ...t1, id: 'x', status: 'closed' }]
  assert.deepEqual(tabsBlockingNight(all, '2026-11-04').map(x => x.id), ['a', 'b'])
  assert.deepEqual(tabsBlockingNight(all, '2026-11-05').map(x => x.id), ['a', 'b', 'c'])
})

test('carried tabs come first, oldest first, the rest keep their order', () => {
  assert.equal(isCarriedTab(t1, '2026-11-05'), true)
  assert.equal(isCarriedTab(t3, '2026-11-05'), false)
  const sorted = sortCarriedFirst([t3, t1, t0, t2], '2026-11-05').map(x => x.id)
  assert.deepEqual(sorted, ['z', 'a', 'b', 'c'])
  assert.deepEqual(sortCarriedFirst([t3], '2026-11-05').map(x => x.id), ['c'])
})

test('age and empty tab', () => {
  assert.equal(openMinutes(t1, Date.parse('2026-11-04T16:20:00Z')), 200)
  assert.deepEqual(ageParts(200), { h: 3, m: 20 })
  assert.deepEqual(ageParts(-5), { h: 0, m: 0 })
  assert.equal(isEmptyTab(t1), false)
  assert.equal(isEmptyTab(t2), true)
  assert.equal(isEmptyTab(t3), false)
  assert.equal(isEmptyTab({ items: [{ removido_em: 'x' }], payments: [{ estornado_em: 'y' }] }), true)
})

test('transfer note keeps history', () => {
  const at = new Date('2026-11-04T15:05:00Z')
  const a = transferNote('', { from: 'Mika', to: 'Ken', by: 'Yuri', at })
  assert.equal(a, '[05/11, 00:05] Mika → Ken (by Yuri)')
  const b = transferNote(a, { from: 'Ken', to: 'Ana', by: 'Ana', at })
  assert.equal(b.split('\n').length, 2)
  assert.ok(b.endsWith('Ken → Ana'))
})

test('exception form checks', () => {
  assert.equal(exceptionError({ pin: '1234', reason: 'guest pays tomorrow', tabs: [] }), 'noTabs')
  assert.equal(exceptionError({ pin: '12', reason: 'guest pays tomorrow', tabs: [t1] }), 'badPin')
  assert.equal(exceptionError({ pin: '1234', reason: ' ok ', tabs: [t1] }), 'shortReason')
  assert.equal(exceptionError({ pin: '1234', reason: 'guest pays tomorrow', tabs: [t1] }), '')
})

test('close cleared only when an exception covers every blocking tab', () => {
  const blocking = [t1, t2]
  assert.equal(closeCleared([], [], '2026-11-04'), true)
  assert.equal(closeCleared(blocking, [], '2026-11-04'), false)
  const ex = { night_key: '2026-11-04', tabs: [{ id: 'a' }] }
  assert.equal(closeCleared(blocking, [ex], '2026-11-04'), false)
  const ex2 = { night_key: '2026-11-04', tabs: [{ id: 'a' }, { id: 'b' }] }
  assert.equal(closeCleared(blocking, [ex2], '2026-11-04'), true)
  // An exception from an earlier night does not clear a later close; a later one clears an earlier pending count.
  assert.equal(closeCleared(blocking, [{ ...ex2, night_key: '2026-11-03' }], '2026-11-04'), false)
  assert.equal(closeCleared(blocking, [{ ...ex2, night_key: '2026-11-05' }], '2026-11-04'), true)
})

test('server cleans the exception', () => {
  const now = new Date('2026-11-05T05:00:00Z')
  const bad = cleanException({ night_key: '2026-11-04', reason: 'x', tabs: [t1] }, { barId: 'bar', actor: {}, now })
  assert.ok(bad.error)
  assert.ok(cleanException({ night_key: 'nope', reason: 'guest pays', tabs: [t1] }, { barId: 'bar', now }).error)
  assert.ok(cleanException({ night_key: '2026-11-04', reason: 'guest pays', tabs: [] }, { barId: 'bar', now }).error)
  const tabs = exceptionTabs([t1, t2], { a: 4500.4 })
  assert.equal(tabs[0].total, 4500)
  const ok = cleanException({ night_key: '2026-11-04', reason: '  guest pays tomorrow ', tabs: [null, ...tabs] }, { barId: 'bar', actor: { id: 'u1', nome: 'Yuri' }, now })
  assert.equal(ok.row.reason, 'guest pays tomorrow')
  assert.equal(ok.row.tabs.length, 2)
  assert.equal(ok.row.tabs[0].total, 4500)
  assert.equal(ok.row.tabs[0].responsavel, 'Mika')
  assert.equal(ok.row.asked_by_nome, 'Yuri')
  assert.equal(ok.row.bar_id, 'bar')
  assert.ok(ok.row.id.startsWith('bar:2026-11-04:'))
})

console.log(`${n} tests passed`)
