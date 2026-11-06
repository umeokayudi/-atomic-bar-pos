/** Bar queue: load colour, ticket lines, metrics, recipes, access to the Bar screen. */
import assert from 'node:assert/strict'
import { clockLabel, newIds, queueMetrics, queueTone, recipeFor, sortQueue, ticketItems } from '../src/lib/barQueue.js'
import { canOpenBarQueue, presetFor } from '../src/lib/barAccess.js'
import { staffAppTabsFor } from '../src/lib/staffApp.js'

let n = 0
function ok(name, fn) { fn(); n += 1; console.log(`ok ${n} - ${name}`) }

ok('queue colour: up to 3 green, over 3 yellow, over 5 red', () => {
  assert.deepEqual([0, 3, 4, 5, 6, 12].map(queueTone), ['green', 'green', 'yellow', 'yellow', 'red', 'red'])
})

ok('ticket lines merge the same drink and skip charges', () => {
  const items = ticketItems([
    { nome: 'Gimlet', drink_menu_id: 'g', qtd: 2 },
    { nome: 'Gimlet', drink_menu_id: 'g', qtd: 1 },
    { nome: 'Service 10%', tipo_preco: 'service', qtd: 1 },
    { nome: 'Baileys', produto_id: 'b', qtd: 1 },
    { nome: 'Zero', drink_menu_id: 'z', qtd: 0 },
  ])
  assert.deepEqual(items, [
    { nome: 'Gimlet', qtd: 3, drink_menu_id: 'g', produto_id: null },
    { nome: 'Baileys', qtd: 1, drink_menu_id: null, produto_id: 'b' },
  ])
})

ok('sort: waiting first (oldest first), ready after, delivered out', () => {
  const rows = [
    { id: 'a', status: 'pronto', chegou_em: '2026-11-06T10:00:00Z' },
    { id: 'b', status: 'novo', chegou_em: '2026-11-06T10:05:00Z' },
    { id: 'c', status: 'novo', chegou_em: '2026-11-06T10:01:00Z' },
    { id: 'd', status: 'entregue', chegou_em: '2026-11-06T09:00:00Z' },
  ]
  assert.deepEqual(sortQueue(rows).map(r => r.id), ['c', 'b', 'a'])
})

ok('metrics: time from arrival to ready, per barman', () => {
  const m = queueMetrics([
    { status: 'entregue', qtd: 2, chegou_em: '2026-11-06T10:00:00Z', pronto_em: '2026-11-06T10:02:00Z', entregue_em: '2026-11-06T10:03:00Z', feito_por: 'u1', feito_por_nome: 'Ken' },
    { status: 'pronto', qtd: 1, chegou_em: '2026-11-06T10:00:00Z', pronto_em: '2026-11-06T10:04:00Z', feito_por: 'u1', feito_por_nome: 'Ken' },
    { status: 'novo', qtd: 3, chegou_em: '2026-11-06T10:05:00Z' },
  ])
  assert.equal(m.tickets, 2)
  assert.equal(m.drinks, 3)
  assert.equal(m.avgPrep, 180)
  assert.equal(m.maxPrep, 240)
  assert.equal(m.avgToGuest, 180)
  assert.deepEqual(m.byPerson, [{ id: 'u1', nome: 'Ken', tickets: 2, drinks: 3, avgPrep: 180 }])
  assert.equal(clockLabel(185), '3:05')
})

ok('new cards are the novo ones not seen before', () => {
  assert.deepEqual(newIds([{ id: 'a', status: 'novo' }, { id: 'b', status: 'novo' }, { id: 'c', status: 'pronto' }], new Set(['a'])), ['b'])
})

ok('recipe from the menu, without cost notes', () => {
  const menu = [{ id: 'g', nome: 'Gimlet', receita: 'Gin 45ml + Lime juice 15ml + Lime (¥20)' }]
  assert.deepEqual(recipeFor({ drink_menu_id: 'g', nome: 'Gimlet' }, menu), ['Gin 45ml', 'Lime juice 15ml', 'Lime'])
  assert.deepEqual(recipeFor({ drink_menu_id: 'x', nome: 'Other' }, menu), [])
})

ok('Bar screen: owner, full manager, or a login with "Bar" ticked', () => {
  assert.equal(canOpenBarQueue({ role: 'cliente' }), true)
  assert.equal(canOpenBarQueue({ role: 'gerente', acessos: null }), true)
  assert.equal(canOpenBarQueue({ role: 'bar_staff', acessos: null }), false)
  assert.equal(canOpenBarQueue({ role: 'bar_staff', acessos: ['clock', 'bar'] }), true)
  assert.equal(canOpenBarQueue({ role: 'caixa', acessos: ['till'] }), false)
})

ok('existing manager lists still read as the Manager preset', () => {
  assert.equal(presetFor(['home', 'till', 'floor', 'clock', 'close', 'drinks', 'team', 'clients']), 'manager')
})

ok('staff app shows the Bar tab only when it may open it', () => {
  assert.ok(staffAppTabsFor(id => id === 'bar').some(t => t.id === 'bar'))
  assert.ok(!staffAppTabsFor(id => id !== 'bar').some(t => t.id === 'bar'))
})

console.log(`bar queue tests passed (${n})`)
