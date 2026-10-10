import assert from 'node:assert/strict'
import { HQ_AREAS, HQ_ADMIN_TABS, aiModuleForTab, groupTabs, pathForTab, tabFromPath } from '../src/lib/navigation.js'
import {
  buildClientRows, campaignLift, campaignRow, clientSignals, invoiceOwed, kpiDelta, planProgress, sortClientRows, validateCampaign,
} from '../src/lib/growth.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`) }

test('every HQ area id is unique and every admin tab has an area', () => {
  const ids = HQ_AREAS.flatMap(a => a.ids)
  assert.equal(new Set(ids).size, ids.length)
  for (const tab of HQ_ADMIN_TABS) assert.ok(ids.includes(tab), `${tab} has no area`)
})

test('groupTabs keeps unknown tabs in a trailing group instead of dropping them', () => {
  const g = groupTabs(['cashflow', 'dashboard', 'legacyThing'])
  assert.deepEqual(g.map(x => x.id), ['overview', 'finance', 'more'])
  assert.deepEqual(g.at(-1).ids, ['legacyThing'])
})

test('URL routing: /hq/<tab> only for allowed tabs, round trip', () => {
  assert.equal(tabFromPath('/hq/cashflow', 'hq', ['cashflow'], 'dashboard'), 'cashflow')
  assert.equal(tabFromPath('/hq/usuarios', 'hq', ['cashflow'], 'dashboard'), 'dashboard')
  assert.equal(tabFromPath('/', 'hq', ['cashflow'], 'dashboard'), 'dashboard')
  assert.equal(tabFromPath(pathForTab('hq', 'crm'), 'hq', ['crm'], 'x'), 'crm')
})

test('AI module per screen', () => {
  assert.equal(aiModuleForTab('cashflow'), 'finance')
  assert.equal(aiModuleForTab('mesas'), 'floor')
  assert.equal(aiModuleForTab('nope'), 'overview')
})

const today = '2026-10-10'
const bars = [{ id: 'a', nome: 'Alpha' }, { id: 'b', nome: 'Beta' }]
const sales = [
  { bar_id: 'a', total: 1000, data: '2026-10-01' },
  { bar_id: 'a', total: 500, data: '2026-09-01' }, // previous 30d window
  { bar_id: 'b', total: 200, data: '2026-08-01' }, // outside both
]
const invoices = [
  { bar_id: 'a', total: 3000, pago: 1000, status: 'parcial', vencimento: '2026-10-01' },
  { bar_id: 'a', total: 999, pago: 0, status: 'pago', vencimento: '2026-01-01' },
  { bar_id: 'b', valor: 400, pago: 0, status: 'pendente', data_vencimento: '2026-12-01' },
]

test('invoice owed ignores paid invoices and uses valor when total is missing', () => {
  assert.equal(invoiceOwed(invoices[0]), 2000)
  assert.equal(invoiceOwed(invoices[1]), 0)
  assert.equal(invoiceOwed(invoices[2]), 400)
})

test('client rows: revenue windows, growth, receivable and overdue', () => {
  const rows = buildClientRows({ bars, sales, invoices, orders: [{ bar_id: 'b', status: 'pendente', data_pedido: '2026-10-05' }], today, days: 30 })
  const a = rows.find(r => r.id === 'a')
  const b = rows.find(r => r.id === 'b')
  assert.equal(a.revenue, 1000)
  assert.equal(a.prevRevenue, 500)
  assert.equal(a.growthPct, 100)
  assert.equal(a.receivable, 2000)
  assert.equal(a.overdue, 2000)
  assert.equal(b.revenue, 0)
  assert.equal(b.growthPct, null, 'no base → no invented growth')
  assert.equal(b.lastOrder, '2026-10-05')
  assert.equal(b.openOrders, 1)
  assert.equal(b.overdue, 0)
  assert.deepEqual(clientSignals(a), ['overdue'])
  assert.deepEqual(clientSignals(b), [])
  assert.equal(sortClientRows(rows, 'name')[0].nome, 'Alpha')
})

test('campaign validation and row normalisation', () => {
  assert.equal(validateCampaign({ nome: '' }), 'growth.errName')
  assert.equal(validateCampaign({ nome: 'x', inicio: '2026-10-10', fim: '2026-10-01' }), 'growth.errDates')
  assert.equal(validateCampaign({ nome: 'x', orcamento: '-1' }), 'growth.errBudget')
  assert.equal(validateCampaign({ nome: 'x', orcamento: '' }), '')
  const row = campaignRow({ nome: ' Happy hour ', orcamento: '', bar_id: '' })
  assert.equal(row.nome, 'Happy hour')
  assert.equal(row.orcamento, null)
  assert.equal(row.bar_id, null)
})

test('campaign lift compares the window with the same number of days before', () => {
  const s = [
    { bar_id: 'a', total: 300, data: '2026-10-02' },
    { bar_id: 'a', total: 100, data: '2026-09-29' },
    { bar_id: 'b', total: 999, data: '2026-10-02' },
  ]
  const lift = campaignLift(s, { bar_id: 'a', inicio: '2026-10-01', fim: '2026-10-03' }, today)
  assert.deepEqual(lift, { days: 3, during: 300, before: 100, pct: 200 })
  assert.equal(campaignLift(s, { bar_id: 'a', inicio: null }), null)
})

test('plan progress and KPI delta', () => {
  const p = planProgress([{ status: 'done' }, { status: 'todo', prazo: '2026-10-01' }, { status: 'doing' }], today)
  assert.deepEqual(p, { total: 3, done: 1, overdue: 1, pct: 33 })
  assert.deepEqual(kpiDelta(100, 150), { delta: 50, pct: 50 })
  assert.deepEqual(kpiDelta(0, 10), { delta: 10, pct: null })
  assert.equal(kpiDelta(undefined, 10), null)
})

console.log(`\n${n} passed`)
