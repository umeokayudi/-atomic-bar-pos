import assert from 'node:assert/strict'
import { groupNotifs, sortOverdue, expiredIds } from '../src/lib/notifGroups.js'

const now = new Date('2026-10-30T12:00:00Z').getTime()
const day = d => new Date(now - d * 86400000).toISOString()
const notifs = [
  { id: 1, tipo: 'pedido_entregue', lida: true, criado_em: day(1) },
  { id: 2, tipo: 'pedido_novo', lida: false, criado_em: day(2) },
  { id: 3, tipo: 'pedido_entregue', lida: false, criado_em: day(3) },
  { id: 4, tipo: 'pedido_novo', lida: true, criado_em: day(20) },
  { id: 5, tipo: 'pedido_novo', lida: false, criado_em: day(30) },
  { id: 6, tipo: 'pedido_novo', lida: true, criado_em: day(90) },
]
const { groups, archived } = groupNotifs(notifs, now)
assert.deepEqual(groups.map(g => g.tipo), ['pedido_novo', 'pedido_entregue'])
assert.deepEqual(groups[0].items.map(n => n.id), [2, 5], 'unread old event stays visible')
assert.deepEqual(groups[1].items.map(n => n.id), [3, 1], 'unread first')
assert.deepEqual(archived.map(n => n.id), [4, 6])
assert.deepEqual(expiredIds(notifs, now), [6])
assert.deepEqual(sortOverdue([{ id: 'a', date: '2026-10-01', amount: 1 }, { id: 'b', date: '2026-08-01', amount: 1 }, { id: 'c' }]).map(r => r.id), ['b', 'a', 'c'])
console.log('notifGroups ok')
