import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  allocateLine, planDeadlines, deadlineMissed, purchaseIsComplete, canMarkPurchased,
  lineProgress, orderCovered, shipmentQty, resolveSalePrice, economics, forBar,
  barPayloadLeaksCost, forSupplier, forEmployee, attentionBuckets, applyReceive,
  assertTransition, supplierTaskView, supplierViewLeaksCost, isProcurementHq,
  canCallMyTasks, canReadTasksDirect, orderStatusAfterPlan, assertSalePrice,
  assertFallback, assertSameOrder, assertShipmentDestination, assertShipQuantity,
  assertOrderQty, assertReceive, assertBarArrival, assertFallbackTask, assertEmployeeCost,
  assertNotBarToBar, releaseOpen, visibleOrderLine,
} from '../src/lib/procurementCore.js'
import { tokyoWallToUtcMs } from '../src/lib/tokyo.js'

const settings = {
  transportHours: 4,
  warehouseHours: 2,
  prepHours: 12,
  bufferHours: 0,
  deliveryDays: [1, 2, 3, 4, 5],
  cutoff: '15:00',
}

const supplierA = {
  sourceId: 'src-a', sourceType: 'SUPPLIER', fornecedorId: 'sup-a', primary: true,
  leadHours: 24, purchasePrice: 4000, minimumQuantity: 1, availableQty: null, cutoff: '15:00',
}
const costco = {
  sourceId: 'src-costco', sourceType: 'PHYSICAL_STORE', primary: false,
  leadHours: 48, purchasePrice: 3800, minimumQuantity: 1, availableQty: null,
  assigneeId: 'joao', cutoff: '15:00',
}
const supplierB = {
  sourceId: 'src-b', sourceType: 'SUPPLIER', fornecedorId: 'sup-b', backup: true,
  leadHours: 12, purchasePrice: 4100, minimumQuantity: 1, availableQty: null, cutoff: '15:00',
}

function at(y, m, d, h, min = 0) {
  return new Date(tokyoWallToUtcMs(y, m, d, h, min))
}

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log('ok', name)
}

test('1 one supplier takes the whole line', () => {
  const { slices, unmet } = allocateLine({
    quantity: 30,
    candidates: [supplierA],
    now: at(2026, 9, 26, 10),
    requestedAt: at(2026, 10, 2, 18),
    settings,
  })
  assert.equal(slices.length, 1)
  assert.equal(slices[0].sourceId, 'src-a')
  assert.equal(slices[0].quantity, 30)
  assert.equal(unmet, 0)
})

test('2 split 20 supplier and 10 store', () => {
  const { slices, unmet } = allocateLine({
    quantity: 30,
    candidates: [{ ...supplierA, availableQty: 20 }, { ...costco, availableQty: 10 }],
    now: at(2026, 9, 26, 10),
    requestedAt: at(2026, 10, 5, 18),
    settings,
  })
  assert.deepEqual(slices.map(s => [s.sourceId, s.quantity]), [['src-a', 20], ['src-costco', 10]])
  assert.equal(unmet, 0)
})

test('3 reject falls through to backup', () => {
  const { slices } = allocateLine({
    quantity: 30,
    candidates: [supplierA, supplierB],
    rejectedSourceIds: ['src-a'],
    now: at(2026, 9, 26, 10),
    requestedAt: at(2026, 10, 5, 18),
    settings,
  })
  assert.equal(slices.length, 1)
  assert.equal(slices[0].fornecedorId, 'sup-b')
  assert.equal(slices[0].quantity, 30)
})

test('4 missed deadline is an exception and fallback can leave that source', () => {
  const requestedAt = at(2026, 10, 2, 18)
  assert.equal(deadlineMissed({ requestedAt, expectedAt: at(2026, 10, 3, 9) }), true)
  const held = { id: 't1', status: 'exception', quantityAllocated: 30 }
  assert.equal(lineProgress(30, [held]).allocated, 30)
  const released = { ...held, status: 'cancelled' }
  const again = allocateLine({
    quantity: 30,
    candidates: [supplierA, supplierB],
    rejectedSourceIds: ['src-a'],
    now: at(2026, 9, 28, 10),
    requestedAt,
    settings,
  })
  assert.equal(lineProgress(30, [released]).allocated, 0)
  assert.equal(again.slices[0].sourceId, 'src-b')
})

test('5 online purchase needs buyer, cost, time and source before it counts', () => {
  const task = { id: 'buy-1', status: 'purchasing', quantityAllocated: 5 }
  const incomplete = { taskId: 'buy-1', buyerId: 'joao', quantity: 5, unitCost: 3800, sourceId: null, purchasedAt: at(2026, 9, 26, 11) }
  assert.equal(purchaseIsComplete(incomplete), false)
  assert.equal(canMarkPurchased(task, [incomplete]), false)
  const done = { ...incomplete, sourceId: 'amazon', purchasedAt: at(2026, 9, 26, 11).toISOString(), receiptNote: 'AMZ-1' }
  assert.equal(canMarkPurchased(task, [done]), true)
  const inbound = applyReceive({ allocated: 5, received: 0, incoming: 5, toBar: false })
  assert.equal(inbound.status, 'received')
  assert.equal(inbound.atBar, undefined)
})

test('6 physical purchase records cost and warehouse receipt is not bar stock', () => {
  const task = { id: 'buy-2', status: 'purchasing', quantityAllocated: 10, quantityAtBar: 0 }
  const purchase = {
    taskId: 'buy-2', buyerId: 'joao', sourceId: 'costco', quantity: 10,
    unitCost: 3800, purchasedAt: at(2026, 9, 26, 15).toISOString(),
  }
  assert.equal(canMarkPurchased(task, [purchase]), true)
  const inbound = applyReceive({ allocated: 10, received: 0, incoming: 10, toBar: false })
  assert.equal(inbound.status, 'received')
  assert.equal(lineProgress(10, [{ ...task, quantityPurchased: 10, quantityAtBar: 0 }]).covered, false)
})

test('7 consolidation reaches the bar only on the warehouse shipment', () => {
  const shipments = [
    { id: 'in-a', status: 'delivered', toType: 'WAREHOUSE', items: [{ quantity: 20 }] },
    { id: 'in-c', status: 'delivered', toType: 'WAREHOUSE', items: [{ quantity: 10 }] },
    { id: 'out', status: 'delivered', toType: 'BAR', items: [{ quantity: 20 }, { quantity: 10 }] },
  ]
  assert.equal(shipmentQty(shipments, { toType: 'WAREHOUSE' }), 30)
  assert.equal(shipmentQty(shipments, { toType: 'BAR' }), 30)
  const lines = [{ quantity: 30, tasks: [{ status: 'completed', quantityAllocated: 30, quantityAtBar: 30 }] }]
  assert.equal(orderCovered(lines), true)
})

test('8 two bars keep different sale prices for one product', () => {
  const catalog = 5000
  const a = resolveSalePrice({
    prices: [{ salePrice: 59400, minimumQuantity: 1, active: true }],
    catalogPrice: catalog, qty: 1,
  })
  const b = resolveSalePrice({
    prices: [{ salePrice: 61000, minimumQuantity: 1, active: true }],
    catalogPrice: catalog, qty: 1,
  })
  const fallback = resolveSalePrice({ prices: [], catalogPrice: catalog, qty: 1 })
  assert.equal(a, 59400)
  assert.equal(b, 61000)
  assert.equal(fallback, 5000)
  assert.notEqual(a, b)
})

test('9 a bar payload has no purchase cost or margin', () => {
  const view = forBar({
    orderId: 'o1',
    publicCode: 'BAR-2026-01048',
    lines: [{
      productId: 'hennessy', name: 'Hennessy', quantity: 30, atBar: 0, salePrice: 59400,
      expectedUnitCost: 4000, margin: 1200, freight: 300,
      shipments: [{ code: 'DEL-2026-00001', status: 'in_transit', expectedAt: at(2026, 10, 2, 18).toISOString() }],
    }],
  })
  assert.equal(view.lines[0].salePrice, 59400)
  assert.equal(barPayloadLeaksCost(view), false)
})

test('10 supplier A cannot see supplier B tasks', () => {
  const tasks = [
    { id: '1', fornecedorId: 'sup-a', taskNumber: 'BUY-1', productId: 'h', quantityAllocated: 20, status: 'assigned', expectedUnitCost: 4000, salePrice: 59400 },
    { id: '2', fornecedorId: 'sup-b', taskNumber: 'BUY-2', productId: 'h', quantityAllocated: 10, status: 'assigned', expectedUnitCost: 4100, salePrice: 59400 },
  ]
  const mine = forSupplier(tasks, 'sup-a')
  assert.equal(mine.length, 1)
  assert.equal(mine[0].taskNumber, 'BUY-1')
  assert.equal(mine[0].salePrice, undefined)
  assert.equal(forEmployee(tasks.map(t => ({ ...t, assignedTo: t.fornecedorId === 'sup-a' ? 'joao' : 'ana' })), 'joao').length, 1)
})

test('11 partial receipt does not cover the line', () => {
  const progress = lineProgress(30, [
    { status: 'partially_received', quantityAllocated: 30, quantityPurchased: 30, quantityAtBar: 10 },
  ])
  assert.equal(progress.covered, false)
  assert.equal(progress.atBar, 10)
  assert.equal(applyReceive({ allocated: 30, received: 10, incoming: 5, toBar: true }).status, 'partially_received')
})

test('12 one order can have two deliveries', () => {
  const shipments = [
    { id: 'd1', status: 'delivered', toType: 'BAR', items: [{ quantity: 20 }] },
    { id: 'd2', status: 'in_transit', toType: 'BAR', items: [{ quantity: 10 }] },
  ]
  assert.equal(shipments.length, 2)
  assert.equal(shipmentQty(shipments, { toType: 'BAR' }), 20)
  assert.equal(orderCovered([{ quantity: 30, tasks: [{ status: 'in_transit', quantityAllocated: 30, quantityAtBar: 20 }] }]), false)
})

test('13 deadlines use Asia/Tokyo, not UTC midnight', () => {
  const need = at(2026, 10, 2, 18)
  assert.equal(need.toISOString(), '2026-10-02T09:00:00.000Z')
  const plan = planDeadlines({
    requestedAt: need,
    transportHours: 0, warehouseHours: 0, prepHours: 0, leadHours: 0, bufferHours: 0,
  })
  assert.equal(plan.buyBy.toISOString(), '2026-10-02T09:00:00.000Z')
})

test('14 buy-by walks back from the requested Tokyo instant', () => {
  const plan = planDeadlines({
    requestedAt: at(2026, 10, 2, 18),
    transportHours: 4,
    warehouseHours: 2,
    prepHours: 12,
    leadHours: 24,
    bufferHours: 0,
    cutoff: '15:00',
    deliveryDays: [1, 2, 3, 4, 5],
  })
  assert.equal(plan.deliverBy.toISOString(), at(2026, 10, 2, 18).toISOString())
  assert.equal(plan.departBy.toISOString(), at(2026, 10, 2, 14).toISOString())
  assert.equal(plan.consolidateBy.toISOString(), at(2026, 10, 2, 12).toISOString())
  assert.equal(plan.readyBy.toISOString(), at(2026, 10, 2, 0).toISOString())
  assert.equal(plan.buyBy.toISOString(), at(2026, 10, 1, 0).toISOString())

  const weekend = planDeadlines({
    requestedAt: at(2026, 10, 5, 10),
    leadHours: 24,
    cutoff: '15:00',
    deliveryDays: [1, 2, 3, 4, 5],
  })
  assert.equal(weekend.buyBy.toISOString(), at(2026, 10, 2, 15).toISOString())
})

test('purchased is not a bare status flip', () => {
  assert.throws(() => assertTransition('purchasing', 'purchased'))
  assert.doesNotThrow(() => assertTransition('waiting_purchase', 'start_purchase'))
  assert.throws(() => assertTransition('waiting_purchase', 'complete'))
})

test('attention lanes come from tasks, not placeholders', () => {
  const now = at(2026, 10, 2, 12)
  const buckets = attentionBuckets({
    now,
    tasks: [{
      id: 'late-1', status: 'waiting_purchase', sourceType: 'SUPPLIER',
      buyBy: at(2026, 10, 1, 15), quantityAllocated: 5, quantityAtBar: 0,
    }, {
      id: 'ok-1', status: 'completed', sourceType: 'SUPPLIER',
      buyBy: at(2026, 10, 1, 15), quantityAllocated: 5, quantityAtBar: 5,
    }],
    shipments: [{ id: 'ship-1', status: 'in_transit', expectedAt: at(2026, 10, 2, 18) }],
  })
  assert.deepEqual(buckets.late, ['late-1'])
  assert.equal(buckets.deliveryToday.includes('ship-1'), true)
  assert.equal(buckets.incomplete.includes('ok-1'), false)
})

test('real cost and margin stay off the four books', () => {
  const row = economics({ unitCost: 4000, qty: 1, freight: 300, fees: 0, salePrice: 5500 })
  assert.equal(row.real, 4300)
  assert.equal(row.margin, 1200)
})

test('primary that misses the deadline loses to a backup that meets it', () => {
  const { slices } = allocateLine({
    quantity: 30,
    candidates: [
      { ...supplierA, leadHours: 200 },
      { ...supplierB, leadHours: 12 },
    ],
    now: at(2026, 10, 1, 12),
    requestedAt: at(2026, 10, 2, 18),
    settings: { ...settings, transportHours: 0, warehouseHours: 0, prepHours: 0, bufferHours: 0 },
  })
  assert.equal(slices[0].sourceId, 'src-b')
  assert.equal(slices[0].late, false)
})

test('supplier tracking hides purchase cost, freight and margin', () => {
  const view = supplierTaskView({
    task_number: 'BUY-1', quantity: 20, status: 'assigned', buy_by_at: '2026-10-01T00:00:00.000Z',
    expected_unit_cost: 4000, actual_total_cost: 86000, margin: 1200, freight: 300, sale_price: 59400,
  })
  assert.equal(supplierViewLeaksCost(view), false)
  assert.equal(view.taskNumber, 'BUY-1')
  const mine = forSupplier([
    { id: '1', fornecedorId: 'sup-a', taskNumber: 'BUY-1', quantityAllocated: 20, status: 'assigned', expectedUnitCost: 4000, salePrice: 59400 },
  ], 'sup-a')
  assert.equal(supplierViewLeaksCost(mine), false)
})

test('funcionario is not procurement HQ and a supplier cannot open my tasks', () => {
  assert.equal(isProcurementHq('funcionario'), false)
  assert.equal(isProcurementHq('fornecedor'), false)
  assert.equal(isProcurementHq('admin'), true)
  assert.equal(isProcurementHq('jbm'), true)
  assert.equal(canCallMyTasks('fornecedor'), false)
  assert.equal(canCallMyTasks('funcionario'), true)
  assert.equal(canReadTasksDirect('admin'), true)
  assert.equal(canReadTasksDirect('fornecedor'), false)
  assert.equal(canReadTasksDirect('funcionario'), false)
})

test('a partial allocation leaves the order pending', () => {
  assert.equal(orderStatusAfterPlan({ made: 1, unmet: 10 }), 'pendente')
  assert.equal(orderStatusAfterPlan({ made: 1, unmet: 0 }), 'confirmado')
})

test('a missing sale price rejects the order', () => {
  assert.throws(() => assertSalePrice(null, 'hennessy', 'bar-a'), /sale price not configured/)
  assert.throws(() => assertSalePrice(0, 'hennessy', 'bar-a'), /sale price not configured/)
  assert.equal(assertSalePrice(59400, 'hennessy', 'bar-a'), 59400)
})

test('fallback stops after the goods are purchased or moving', () => {
  assert.throws(() => assertFallback('purchased'), /cannot fallback/)
  assert.throws(() => assertFallback('received'), /cannot fallback/)
  assert.throws(() => assertFallback('in_transit'), /cannot fallback/)
  assert.doesNotThrow(() => assertFallback('exception'))
  assert.doesNotThrow(() => assertFallback('purchasing'))
})

test('a shipment stays inside one order and the destination bar', () => {
  assert.throws(() => assertSameOrder([{ orderId: 'o1' }, { orderId: 'o2' }]), /same order/)
  assert.doesNotThrow(() => assertSameOrder([{ orderId: 'o1' }, { orderId: 'o1' }]))
  assert.throws(() => assertShipmentDestination({ destType: 'BAR', destBarId: 'bar-b', orderBarId: 'bar-a' }), /does not match/)
  assert.doesNotThrow(() => assertShipmentDestination({ destType: 'WAREHOUSE', destBarId: null, orderBarId: 'bar-a' }))
  assert.doesNotThrow(() => assertShipmentDestination({ destType: 'BAR', destBarId: 'bar-a', orderBarId: 'bar-a' }))
})

test('warehouse outbound uses quantity received, not quantity purchased', () => {
  assert.throws(() => assertShipQuantity({ fromType: 'WAREHOUSE', quantityPurchased: 20, quantityReceived: 0, quantity: 10 }))
  assert.throws(() => assertShipQuantity({ fromType: 'WAREHOUSE', quantityPurchased: 20, quantityReceived: 8, quantity: 10 }))
  assert.equal(assertShipQuantity({ fromType: 'WAREHOUSE', quantityPurchased: 20, quantityReceived: 20, quantity: 10 }), 20)
  assert.equal(assertShipQuantity({ fromType: 'SUPPLIER', quantityPurchased: 20, quantityReceived: 0, quantity: 20 }), 20)
})

test('sql keeps isolation and does not invent a second catalog', () => {
  const sql = readFileSync(new URL('../sql/procurement.sql', import.meta.url), 'utf8')
  assert.equal(/USING\s*\(\s*true\s*\)/i.test(sql), false)
  assert.equal(/service_role/i.test(sql), false)
  assert.equal(/CREATE TABLE[^;]*\bbars\b/i.test(sql), false)
  assert.equal(/INSERT INTO public\.produtos/i.test(sql), false)
  assert.equal(/Hennessy|Costco|Demo POS/i.test(sql), false)
  assert.match(sql, /submit_bar_order/)
  assert.match(sql, /task_economics/)
  assert.match(sql, /procurement_sources/)
  assert.match(sql, /procurement_tasks/)
  assert.match(sql, /purchase_transactions/)
  assert.match(sql, /shipments/)
  assert.match(sql, /bar_product_prices/)
  assert.match(sql, /order_supplier_assignments/)
  assert.match(sql, /CREATE POLICY ptask_read_hq/)
  assert.match(sql, /USING \(\(SELECT public\.is_procurement_hq\(\)\)\)/)
  assert.equal(/CREATE POLICY ptask_read ON/i.test(sql), false)
  assert.match(sql, /cannot fallback a task after purchase or shipment/)
  assert.match(sql, /shipment tasks must belong to the same order/)
  assert.match(sql, /shipment destination bar does not match order bar/)
  assert.match(sql, /quantity_received - already/)
  assert.match(sql, /sale price not configured for product/)
  assert.match(sql, /made > 0 AND unmet = 0/)
  assert.match(sql, /get_procurement_tasks_hq/)
  assert.match(sql, /p\.role IN \('admin', 'jbm', 'funcionario'\)/)
  assert.match(sql, /audience = 'jbm' AND public\.is_procurement_hq\(\)/)
  assert.equal(/audience = 'jbm' AND public\.is_jbm\(\)/.test(sql), false)
  assert.equal(/WITH CHECK\s*\(\s*true\s*\)/i.test(sql), false)
  const policy = sql.slice(sql.indexOf('CREATE POLICY ptask_read_hq'), sql.indexOf('DROP POLICY IF EXISTS purchases_read'))
  assert.equal(/assigned_to|my_supplier_ids|fornecedor/.test(policy), false)

  const board = readFileSync(new URL('../src/components/ProcurementBoard.jsx', import.meta.url), 'utf8')
  const orders = readFileSync(new URL('../src/components/BarOrdersTab.jsx', import.meta.url), 'utf8')
  const supplier = readFileSync(new URL('../src/components/SupplierPortal.jsx', import.meta.url), 'utf8')
  assert.equal(board.includes("from('procurement_tasks')"), false)
  assert.match(board, /get_procurement_tasks_hq/)
  assert.equal(orders.includes('route_pedido'), false)
  assert.equal(orders.includes(".from('pedidos').insert"), false)
  assert.equal(orders.includes(".from('pedidos_itens').insert"), false)
  assert.match(orders, /procurement\.notConfigured/)
  assert.equal(supplier.includes("from('procurement_tasks')"), false)
  assert.match(supplier, /get_procurement_tracking/)
  assert.match(sql, /received exceeds purchased/)
  assert.match(sql, /at bar exceeds received/)
  assert.match(sql, /shipment between bars is not allowed/)
  assert.match(sql, /unit cost is fixed for this task/)
  assert.match(sql, /procurement_tasks_qty_chk/)
  assert.match(sql, /procurement_stock_moves/)
  assert.match(sql, /release_open_quantity/)
  assert.match(sql, /_audit_bar_price/)
  assert.match(sql, /user_can_access_bar\(p_bar_id\)/)
  assert.match(sql, /user_can_access_bar\(dest\.bar_id\)/)
  assert.equal(/GRANT INSERT ON public\.procurement_stock_moves/i.test(sql), false)
  assert.equal(/GRANT INSERT, UPDATE, DELETE ON public\.procurement_tasks/i.test(sql), false)
  const myTasks = board.slice(board.indexOf('function MyTasks'), board.indexOf('function HqBoard'))
  assert.equal(/freight|fees|unit_cost:/.test(myTasks), false)
})

test('cross-bar shipment and a foreign bar order are rejected', () => {
  assert.throws(() => assertNotBarToBar({ fromType: 'BAR', destType: 'BAR' }), /between bars/)
  assert.throws(() => assertShipmentDestination({ destType: 'BAR', destBarId: 'bar-b', orderBarId: 'bar-a' }), /does not match/)
  assert.doesNotThrow(() => assertNotBarToBar({ fromType: 'WAREHOUSE', destType: 'BAR' }))
})

test('supplier and employee each see only their own slice', () => {
  const line = {
    product: 'drink',
    quantity: 10,
    atBar: 6,
    salePrice: 5000,
    tasks: [
      { fornecedorId: 'sup-a', assignedTo: 'joao', taskNumber: 'BUY-A', quantityAllocated: 6, quantityAtBar: 6, status: 'completed', expectedUnitCost: 100, salePrice: 5000 },
      { fornecedorId: 'sup-b', assignedTo: 'ana', taskNumber: 'BUY-B', quantityAllocated: 4, quantityAtBar: 0, status: 'assigned', expectedUnitCost: 90, salePrice: 5000 },
    ],
  }
  const supplier = visibleOrderLine(line, { audience: 'supplier', supplierId: 'sup-a' })
  assert.equal(supplier.quantity, 6)
  assert.equal(supplier.atBar, undefined)
  assert.equal(supplier.salePrice, undefined)
  assert.equal(supplierViewLeaksCost(supplier), false)
  assert.equal(visibleOrderLine(line, { audience: 'supplier', supplierId: 'sup-b' }).quantity, 4)
  const employee = visibleOrderLine(line, { audience: 'employee', userId: 'joao' })
  assert.equal(employee.quantity, 6)
  assert.equal(visibleOrderLine(line, { audience: 'employee', userId: 'nobody' }), null)
})

test('partial purchase, receipt, warehouse ship and direct ship keep the caps', () => {
  assert.equal(assertReceive({ purchased: 10, received: 4, incoming: 2 }), 6)
  assert.throws(() => assertReceive({ purchased: 10, received: 4, incoming: 7 }), /received exceeds purchased/)
  assert.throws(() => assertReceive({ purchased: 0, received: 0, incoming: 1 }), /purchase record required/)
  const warehouse = assertBarArrival({ fromType: 'WAREHOUSE', purchased: 10, received: 6, atBar: 0, incoming: 6 })
  assert.deepEqual(warehouse, { received: 6, atBar: 6 })
  assert.throws(() => assertBarArrival({ fromType: 'WAREHOUSE', purchased: 10, received: 6, atBar: 0, incoming: 7 }), /at bar exceeds received/)
  const direct = assertBarArrival({ fromType: 'SUPPLIER', purchased: 4, received: 0, atBar: 0, incoming: 4 })
  assert.deepEqual(direct, { received: 4, atBar: 4 })
  assert.throws(() => assertBarArrival({ fromType: 'DIRECT', purchased: 4, received: 0, atBar: 0, incoming: 5 }), /received exceeds purchased/)
  assert.throws(() => assertShipQuantity({ fromType: 'WAREHOUSE', quantityPurchased: 10, quantityReceived: 6, already: 4, quantity: 3 }))
  assert.equal(releaseOpen({ allocated: 10, purchased: 6, release: 4 }).allocated, 6)
  assert.throws(() => releaseOpen({ allocated: 10, purchased: 6, release: 5 }), /exceeds the task/)
})

test('invalid quantity, a cost override, and fallback after a partial purchase', () => {
  assert.throws(() => assertOrderQty(0), /invalid order line/)
  assert.throws(() => assertOrderQty(-2), /invalid order line/)
  assert.throws(() => assertOrderQty(1.5), /invalid order line/)
  assert.equal(assertOrderQty(3), 3)
  assert.throws(() => assertEmployeeCost({ expected: 4000, offered: 1000 }), /unit cost is fixed/)
  assert.throws(() => assertEmployeeCost({ expected: null, offered: 1000 }), /unit cost is fixed/)
  assert.equal(assertEmployeeCost({ expected: 4000, offered: 4000 }), 4000)
  assert.throws(() => assertFallbackTask({ status: 'purchasing', quantityPurchased: 4 }), /cannot fallback/)
  assert.doesNotThrow(() => assertFallbackTask({ status: 'purchasing', quantityPurchased: 0 }))
})

test('the order stays open until every line is at the bar', () => {
  const lines = [
    { quantity: 10, tasks: [{ status: 'completed', quantityAllocated: 6, quantityAtBar: 6 }, { status: 'purchased', quantityAllocated: 4, quantityAtBar: 4 }] },
    { quantity: 2, tasks: [{ status: 'in_transit', quantityAllocated: 2, quantityAtBar: 0 }] },
  ]
  assert.equal(orderCovered(lines), false)
  lines[1].tasks[0].quantityAtBar = 2
  lines[1].tasks[0].status = 'completed'
  assert.equal(orderCovered(lines), true)
})

console.log(`\n${passed} procurement tests passed`)
