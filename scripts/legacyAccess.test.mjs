import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isJbmRole } from '../src/lib/access.js'
import {
  barBookScope,
  canLoadOverdueAlerts,
  canReadCompanyPurchases,
  canReadProductCost,
  seesHqProcurement,
  shellTabIds,
} from '../src/lib/legacyScope.js'
import {
  employeeTaskPayload,
  isProcurementHq,
  payloadHasFinance,
  supplierTaskView,
  supplierViewLeaksCost,
} from '../src/lib/procurementCore.js'

const read = (path) => readFileSync(path, 'utf8')

assert.equal(isJbmRole('funcionario'), false)
assert.equal(isJbmRole('staff'), false)
assert.equal(isJbmRole('fornecedor'), false)
assert.equal(isJbmRole('cliente'), false)
assert.equal(isJbmRole('admin'), true)
assert.equal(isJbmRole('jbm'), true)

assert.equal(isProcurementHq('funcionario'), false)
assert.equal(isProcurementHq('staff'), false)
assert.equal(seesHqProcurement('funcionario'), false)
assert.equal(seesHqProcurement('staff'), false)
assert.equal(seesHqProcurement('jbm'), true)
assert.equal(seesHqProcurement('admin'), true)

assert.deepEqual(shellTabIds('funcionario'), ['profile', 'shifts', 'clock', 'goals', 'result', 'points', 'occurrences', 'rewards', 'salary', 'procurement'])
assert.ok(!shellTabIds('funcionario').includes('purchases'))
assert.ok(!shellTabIds('funcionario').includes('relatorio'))
assert.ok(!shellTabIds('funcionario').includes('faturas'))
assert.ok(!shellTabIds('staff').includes('procurement'))
assert.ok(!shellTabIds('staff').includes('fulfillment'))
assert.ok(!shellTabIds('staff').includes('cashflow'))
assert.ok(!shellTabIds('staff').includes('faturas'))
assert.deepEqual(shellTabIds('jbm'), ['procurement', 'fulfillment', 'payroll'])
assert.ok(!shellTabIds('jbm').includes('purchases'))
assert.ok(!shellTabIds('jbm').includes('dashboard'))
assert.ok(shellTabIds('admin').includes('procurement'))
assert.deepEqual(shellTabIds('fornecedor'), [])
assert.deepEqual(shellTabIds('cliente'), [])

assert.equal(canLoadOverdueAlerts('funcionario'), false)
assert.equal(canLoadOverdueAlerts('staff'), false)
assert.equal(canLoadOverdueAlerts('jbm'), false)
assert.equal(canLoadOverdueAlerts('fornecedor'), false)
assert.equal(canLoadOverdueAlerts('cliente'), false)
assert.equal(canLoadOverdueAlerts('admin'), true)

assert.equal(canReadCompanyPurchases('staff'), false)
assert.equal(canReadCompanyPurchases('funcionario'), false)
assert.equal(canReadProductCost('staff'), false)
assert.equal(canReadProductCost('funcionario'), false)
assert.equal(canReadProductCost('fornecedor'), false)

assert.deepEqual(barBookScope('staff', ''), { kind: 'none' })
assert.deepEqual(barBookScope('staff', 'bar-a'), { kind: 'bar', barId: 'bar-a' })
assert.deepEqual(barBookScope('funcionario', 'bar-a'), { kind: 'none' })
assert.deepEqual(barBookScope('jbm', 'bar-a'), { kind: 'none' })
assert.deepEqual(barBookScope('admin', null), { kind: 'global' })

const employee = employeeTaskPayload({
  id: 't1',
  task_number: 'T-1',
  quantity_allocated: 2,
  quantity_purchased: 1,
  status: 'assigned',
  expected_unit_cost: 100,
  margin: 40,
  freight: 9,
  sale_price: 500,
  actual_total_cost: 200,
})
assert.equal(payloadHasFinance(employee), false)
assert.equal('margin' in employee, false)
assert.equal('freight' in employee, false)
assert.equal('sale_price' in employee, false)
assert.equal('actual_total_cost' in employee, false)

const supplier = supplierTaskView({
  task_number: 'T-2',
  quantity: 3,
  status: 'assigned',
  expected_unit_cost: 80,
  margin: 10,
  actual_total_cost: 240,
})
assert.equal(supplierViewLeaksCost(supplier), false)
assert.equal('expected_unit_cost' in supplier, false)
assert.equal('margin' in supplier, false)

const alerts = read('src/components/Notifications.jsx')
const overdue = alerts.slice(alerts.indexOf('export function useOverdueAlerts'), alerts.indexOf('export function useBarOverdueAlerts'))
assert.match(overdue, /canLoadOverdueAlerts/)
assert.match(overdue, /if \(!user \|\| !allowed\)/)
const queryAt = overdue.indexOf("supabase.from('faturas')")
const guardAt = overdue.indexOf('if (!user || !allowed)')
assert.ok(guardAt >= 0 && queryAt > guardAt)

const comprasApi = read('api/compras.js')
assert.match(comprasApi, /requireGlobalFinance/)
assert.doesNotMatch(comprasApi, /requireStaff\(/)

const loadCompras = read('src/lib/loadCompras.js')
assert.match(loadCompras, /if \(!allowCompanyLedger\) return \[\]/)

const app = read('src/App.jsx')
assert.match(app, /shellTabIds\(perfil\?\.role\)/)
assert.match(app, /activeTab/)
const employeeSlice = app.slice(app.indexOf('const EMPLOYEE_TABS'), app.indexOf('const STAFF_TABS'))
assert.match(employeeSlice, /procurement/)
assert.doesNotMatch(employeeSlice, /purchases/)

const sql = read('sql/pos_sale_security.sql')
const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.user_can_access_bar'), sql.indexOf('REVOKE ALL ON FUNCTION public.user_can_access_bar'))
assert.match(fn, /cliente/)
assert.match(fn, /gerente/)
assert.match(fn, /caixa/)
assert.match(fn, /bar_staff/)
assert.doesNotMatch(fn, /p\.role = 'admin' OR p\.bar_id = target_bar/)

for (const copy of ['migration.sql']) {
  const body = read(copy)
  const chunk = body.slice(body.indexOf('FUNCTION public.user_can_access_bar'), body.indexOf('REVOKE ALL ON FUNCTION public.user_can_access_bar'))
  assert.match(chunk, /bar_staff/, copy)
  assert.doesNotMatch(chunk, /p\.role = 'admin' OR p\.bar_id = target_bar/, copy)
}

const doors = read('src/lib/barDoors.js')
assert.match(doors, /role === 'admin' \|\| role === 'jbm' \|\| role === 'staff' \|\| role === 'funcionario'/)
assert.match(doors, /role === 'admin' \|\| role === 'jbm' \|\| role === 'funcionario' \|\| role === 'staff'/)

const financeRoutes = [
  'api/compras.js',
  'api/dashboard.js',
  'api/billing-hub.js',
  'api/admin-user.js',
  'api/_routeCashflowExport.js',
  'api/_routeHoldingAudit.js',
  'api/_routeHoldingModules.js',
  'api/holding/[[...fn]].js',
]
for (const path of financeRoutes) {
  const src = read(path)
  assert.match(src, /requireGlobalFinance/, path)
  assert.doesNotMatch(src, /requireStaffOrTrustedOrigin/, path)
}

const chat = read('api/chat.js')
const seikyu = chat.slice(chat.indexOf("body.module === 'seikyusho'"), chat.indexOf('handleSeikyushoRequest'))
assert.match(seikyu, /requireGlobalFinance/)

console.log('legacy access tests passed')
