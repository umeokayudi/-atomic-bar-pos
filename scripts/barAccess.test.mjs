import assert from 'node:assert/strict'
import {
  ACCESS_PRESETS, BAR_AREAS, LIVE_TABLE_AREA, SENSITIVE_AREAS, TAB_AREA, canAccess, canAccessAny, canEditAccessOf, canManageLogin,
  canOpenTab, cleanAcessos, filterNavGroups, firstOpenTab, loginEmailFor, missingArea, presetAreas, presetFor, registryArea,
  STAFF_SELF_TABS, staffActionAreas,
} from '../src/lib/barAccess.js'
import { dockForLogin, groupedNavForRole, primaryDockForRole } from '../src/lib/access.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`) }

const owner = { id: 'o1', role: 'cliente', acessos: ['till'] }
const manager = { id: 'g1', role: 'gerente' }
const limitedManager = { id: 'g2', role: 'gerente', acessos: presetAreas('manager') }
const tillOnly = { id: 'c1', role: 'caixa', acessos: ['till'] }

test('no list keeps today: every area open, for every bar role', () => {
  for (const role of ['gerente', 'caixa', 'bar_staff']) {
    for (const a of BAR_AREAS) assert.equal(canAccess({ role }, a), true, `${role} ${a}`)
    assert.equal(canAccess({ role, acessos: null }, 'money'), true)
  }
})

test('the owner always has everything, even with a stray list', () => {
  for (const a of BAR_AREAS) assert.equal(canAccess(owner, a), true)
})

test('a list limits; an empty list allows nothing gated', () => {
  assert.equal(canAccess(tillOnly, 'till'), true)
  assert.equal(canAccess(tillOnly, 'floor'), false)
  assert.equal(canAccess(tillOnly, 'money'), false)
  assert.equal(canAccess({ role: 'caixa', acessos: [] }, 'till'), false)
  assert.equal(canAccess({ role: 'caixa', acessos: [] }, null), true)
  assert.equal(canAccess(null, 'till'), false)
})

test('cleanAcessos drops unknown areas, dedupes, keeps menu order; non-arrays mean no limit', () => {
  assert.deepEqual(cleanAcessos(['money', 'till', 'till', 'root', '']), ['till', 'money'])
  assert.equal(cleanAcessos(undefined), null)
  assert.equal(cleanAcessos('till'), null)
})

test('presets: manager leaves out money, payroll and logins; full clears the list', () => {
  const m = presetAreas('manager')
  for (const a of SENSITIVE_AREAS) assert.ok(!m.includes(a))
  assert.ok(m.includes('till') && m.includes('team'))
  assert.equal(presetAreas('full'), null)
  assert.equal(presetFor(['floor', 'till']), 'tillFloor')
  assert.equal(presetFor(['till', 'money']), 'custom')
  assert.equal(presetFor(null), 'full')
  assert.equal(new Set(ACCESS_PRESETS.map(p => p.id)).size, ACCESS_PRESETS.length)
})

test('every owner/manager menu tab and dock button maps to an area', () => {
  for (const role of ['cliente', 'gerente', 'caixa']) {
    const ids = [...groupedNavForRole(role).flatMap(g => g.items.map(i => i.id)), ...primaryDockForRole(role).map(d => d.id)]
    for (const id of ids) assert.ok(TAB_AREA[id], `${role}: ${id} has no area`)
  }
  for (const area of Object.values(TAB_AREA)) assert.ok(BAR_AREAS.includes(area))
  assert.ok(groupedNavForRole('gerente').find(g => g.id === 'team').items.some(i => i.id === 'usuarios'))
})

test('staff self-service tabs stay open; gated tabs follow the list', () => {
  const floor = { role: 'bar_staff', acessos: ['floor', 'clock'] }
  for (const id of ['hoje', 'profile', 'salary', 'shifts']) assert.equal(canOpenTab(floor, id), true)
  assert.equal(canOpenTab(floor, 'mesas'), true)
  assert.equal(canOpenTab(floor, 'pos'), false)
  assert.equal(canOpenTab(floor, 'pedidos'), false)
  assert.equal(canOpenTab(limitedManager, 'salarios'), false)
  assert.equal(canOpenTab(limitedManager, 'custos'), false)
  assert.equal(canOpenTab(limitedManager, 'usuarios'), false)
  assert.equal(canOpenTab(limitedManager, 'senha'), false)
  assert.equal(canOpenTab(limitedManager, 'estoque'), true)
})

test('"Staff only" opens the staff app and own clock-in, nothing else; dock and home stay in the staff app', () => {
  const staffOnly = { id: 's9', role: 'bar_staff', acessos: presetAreas('staffOnly') }
  assert.equal(ACCESS_PRESETS[0].id, 'staffOnly')
  assert.equal(presetFor(presetAreas('staffOnly')), 'staffOnly')
  for (const id of STAFF_SELF_TABS) assert.equal(canOpenTab(staffOnly, id), true, id)
  assert.equal(canOpenTab(staffOnly, 'ponto'), true)
  for (const id of ['pos', 'mesas', 'pedidos', 'estoque', 'custos', 'salarios', 'staff', 'usuarios', 'fechamento', 'inicio']) {
    assert.equal(canOpenTab(staffOnly, id), false, id)
  }
  // Same list on the server: live tables and bar-staff actions refuse it.
  assert.equal(canAccessAny(staffOnly, LIVE_TABLE_AREA.staff_extras), false)
  assert.equal(canAccessAny(staffOnly, LIVE_TABLE_AREA.bar_registry), false)
  assert.equal(missingArea(staffOnly, staffActionAreas('POST', { action: 'saveGoals' })), 'team')
  assert.equal(missingArea(staffOnly, ['till']), 'till')
  const menu = filterNavGroups(groupedNavForRole('bar_staff'), staffOnly).flatMap(g => g.items.map(i => i.id))
  assert.ok(!menu.some(id => ['pos', 'mesas', 'pedidos'].includes(id)))
  assert.equal(firstOpenTab(staffOnly, ['hoje', ...menu], 'hoje'), 'hoje')
  const dock = dockForLogin('bar_staff', id => canOpenTab(staffOnly, id)).map(d => d.id)
  assert.deepEqual(dock, ['hoje', 'ponto', 'shifts', 'salary'])
  assert.deepEqual(dockForLogin('bar_staff').map(d => d.id), primaryDockForRole('bar_staff').map(d => d.id))
  assert.deepEqual(dockForLogin('caixa'), [])
})

test('filterNavGroups hides disallowed items and empty groups; no list keeps the menu as is', () => {
  const full = groupedNavForRole('gerente')
  assert.deepEqual(filterNavGroups(full, manager), full)
  const lim = filterNavGroups(full, limitedManager)
  assert.ok(!lim.some(g => g.id === 'money'))
  assert.ok(!lim.flatMap(g => g.items).some(i => ['salarios', 'drinkback', 'usuarios', 'senha'].includes(i.id)))
  const till = filterNavGroups(groupedNavForRole('caixa'), tillOnly).flatMap(g => g.items.map(i => i.id))
  assert.deepEqual(till, ['pos'])
  assert.equal(firstOpenTab({ role: 'caixa', acessos: ['floor'] }, ['pos', 'mesas'], 'pos'), 'mesas')
})

test('bar-staff actions need the right area', () => {
  assert.deepEqual(staffActionAreas('POST', { action: 'saveRegistry', kind: 'fixo' }), ['money'])
  assert.deepEqual(staffActionAreas('POST', { action: 'saveRegistry', kind: 'fornecedor' }), ['drinks'])
  assert.deepEqual(staffActionAreas('POST', { action: 'saveRegistry', kind: 'parceiro' }), ['clients'])
  // delete: the body's kind is ignored; only the stored row's kind (passed by the API) can relax money.
  assert.deepEqual(staffActionAreas('POST', { action: 'deleteRegistry', kind: 'fornecedor' }), ['money'])
  assert.deepEqual(staffActionAreas('POST', { action: 'deleteRegistry' }, { registryKind: 'fornecedor' }), ['drinks'])
  assert.deepEqual(staffActionAreas('POST', { action: 'saveRegistry', kind: 'fornecedor', id: 'r1' }, { registryKind: 'fixo' }), ['drinks', 'money'])
  assert.deepEqual(staffActionAreas('POST', { action: 'createStaff' }), ['users'])
  assert.deepEqual(staffActionAreas('POST', { action: 'createStaff', salario_hora: 1200 }), ['users', 'payroll'])
  assert.deepEqual(staffActionAreas('POST', { action: 'savePerson', salario_mes: 1 }), ['team', 'payroll'])
  assert.deepEqual(staffActionAreas('POST', { action: 'uploadStaffFile', kind: 'contrato' }), ['team|users', 'payroll'])
  assert.deepEqual(staffActionAreas('PATCH', { id: 'x', acessos: ['till'] }), ['users'])
  assert.deepEqual(staffActionAreas('PATCH', { id: 'x', nome: 'A' }), ['team|users'])
  assert.deepEqual(staffActionAreas('PATCH', { id: 'x', nome: 'A', transporte: 0 }), ['team|users', 'payroll'])
  assert.deepEqual(staffActionAreas('POST', { action: 'pairTablet' }), ['users'])
  assert.deepEqual(staffActionAreas('POST', { action: 'saveCloseSettings', fechou_noite: '2026-10-11' }), [])
  assert.deepEqual(staffActionAreas('POST', { action: 'saveCloseSettings', pedido_em: '2026-10-11' }), ['drinks'])
  assert.deepEqual(staffActionAreas('POST', { action: 'saveCloseSettings', dia_salario: 25 }), ['close'])
  for (const action of ['lockStatus', 'unlock', 'setLock', 'myAccess']) assert.deepEqual(staffActionAreas('POST', { action }), [])
  assert.deepEqual(staffActionAreas('GET', {}), [])
  assert.equal(registryArea('imposto'), 'money')
})

test('missingArea: owners and unlimited logins pass; limited ones are stopped at money/payroll/users', () => {
  assert.equal(missingArea(owner, ['money', 'payroll', 'users']), null)
  assert.equal(missingArea(manager, ['money', 'payroll', 'users']), null)
  assert.equal(missingArea(limitedManager, ['money']), 'money')
  assert.equal(missingArea(limitedManager, ['users', 'payroll']), 'users')
  assert.equal(missingArea(limitedManager, ['team|users']), null)
  assert.equal(canAccessAny(tillOnly, 'team|payroll|users'), false)
  assert.equal(LIVE_TABLE_AREA.bar_registry, 'money')
})

test('who may manage whom', () => {
  const caixa = { id: 'c9', role: 'caixa' }
  const otherManager = { id: 'g9', role: 'gerente' }
  assert.equal(canManageLogin(owner, caixa), true)
  assert.equal(canManageLogin(owner, otherManager), true)
  assert.equal(canManageLogin(owner, { id: 'o2', role: 'cliente' }), false)
  assert.equal(canManageLogin(manager, caixa), true)
  assert.equal(canManageLogin(manager, otherManager), false)
  assert.equal(canManageLogin(manager, manager), false)
  assert.equal(canManageLogin(limitedManager, caixa), false) // no users area
  assert.equal(canManageLogin(tillOnly, caixa), false)
  const usersManager = { id: 'g3', role: 'gerente', acessos: ['till', 'floor', 'users'] }
  assert.equal(canEditAccessOf(usersManager, caixa, ['till']), true)
  assert.equal(canEditAccessOf(usersManager, caixa, ['till', 'money']), false)
  assert.equal(canEditAccessOf(usersManager, caixa, null), false)
  assert.equal(canEditAccessOf(manager, caixa, null), true)
  assert.equal(canEditAccessOf(owner, otherManager, ['till']), true)
})

test('login id becomes a bar-scoped sign-in email; emails pass through', () => {
  assert.equal(loginEmailFor('Maria', 'b23a5f97-ad4c'), 'maria.b23a5f@staff.jbmtech.app')
  assert.equal(loginEmailFor('Ken@Bar.jp', 'x'), 'ken@bar.jp')
  assert.equal(loginEmailFor('a', 'x'), '')
  assert.equal(loginEmailFor('bad id', 'x'), '')
  assert.equal(loginEmailFor('x@y', 'x'), '')
})

console.log(`\n${n} tests passed`)
