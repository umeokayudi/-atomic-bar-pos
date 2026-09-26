/**
 * Procurement rules shared by the UI and the node tests.
 * The database functions in sql/procurement.sql are the writers.
 * Tokyo has no DST (UTC+9). Elapsed hours are wall-clock hours, then the
 * buy deadline snaps to a configured cutoff and allowed delivery days.
 */

import { tokyoParts, tokyoWallToUtcMs, TOKYO_OFFSET_HOURS } from './tokyo.js'

export const SOURCE_TYPES = [
  'SUPPLIER', 'ONLINE', 'PHYSICAL_STORE', 'EMPLOYEE', 'PARTNER', 'WAREHOUSE', 'DIRECT',
]

export const TASK_STATUSES = [
  'draft', 'planned', 'assigned', 'waiting_purchase', 'purchasing', 'purchased',
  'in_transit', 'received', 'partially_received', 'completed', 'cancelled', 'exception',
]

const ACTIVE = new Set([
  'draft', 'planned', 'assigned', 'waiting_purchase', 'purchasing', 'purchased',
  'in_transit', 'received', 'partially_received', 'exception',
])

export function addHours(date, hours) {
  return new Date(new Date(date).getTime() + (Number(hours) || 0) * 3600000)
}

export function isoDow(year, month, day) {
  const js = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return js === 0 ? 7 : js
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function tokyoKey(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`
}

function parseCutoff(cutoff) {
  if (!cutoff) return { hour: 23, minute: 59 }
  const [h, m] = String(cutoff).split(':').map(n => +n || 0)
  return { hour: h, minute: m }
}

function atTokyo(year, month, day, hour, minute) {
  return new Date(tokyoWallToUtcMs(year, month, day, hour, minute, 0, 0))
}

function previousTokyoDate(year, month, day) {
  const noon = tokyoWallToUtcMs(year, month, day, 12) - 86400000
  return tokyoParts(new Date(noon))
}

/**
 * Walk backward from the bar's requested instant.
 * Returns UTC Dates. buyBy is the last safe purchase instant.
 */
export function planDeadlines({
  requestedAt,
  transportHours = 0,
  warehouseHours = 0,
  prepHours = 0,
  leadHours = 0,
  bufferHours = 0,
  cutoff = null,
  deliveryDays = null,
  closures = [],
} = {}) {
  if (!requestedAt) return { deliverBy: null, departBy: null, consolidateBy: null, readyBy: null, buyBy: null }
  const deliverBy = addHours(requestedAt, -bufferHours)
  const departBy = addHours(deliverBy, -transportHours)
  const consolidateBy = addHours(departBy, -warehouseHours)
  const readyBy = addHours(consolidateBy, -prepHours)
  let buyBy = addHours(readyBy, -leadHours)
  const cut = parseCutoff(cutoff)
  const days = Array.isArray(deliveryDays) && deliveryDays.length ? deliveryDays.map(Number) : null
  const closed = new Set(closures || [])

  for (let i = 0; i < 21; i += 1) {
    const p = tokyoParts(buyBy)
    const key = tokyoKey(p.year, p.month, p.day)
    const dow = isoDow(p.year, p.month, p.day)
    const blocked = (days && !days.includes(dow)) || closed.has(key)
    if (blocked) {
      const prev = previousTokyoDate(p.year, p.month, p.day)
      buyBy = atTokyo(prev.year, prev.month, prev.day, cut.hour, cut.minute)
      continue
    }
    if (p.hour > cut.hour || (p.hour === cut.hour && p.minute > cut.minute)) {
      buyBy = atTokyo(p.year, p.month, p.day, cut.hour, cut.minute)
      continue
    }
    break
  }

  return { deliverBy, departBy, consolidateBy, readyBy, buyBy }
}

function rankTuple(row) {
  return [
    row.meets ? 0 : 1,
    row.primary ? 0 : row.backup ? 1 : 2,
    row.priority ?? 100,
    row.leadHours ?? 1e9,
    row.purchasePrice ?? 1e12,
  ]
}

function lower(a, b) {
  const ra = rankTuple(a)
  const rb = rankTuple(b)
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] !== rb[i]) return ra[i] - rb[i]
  }
  return 0
}

/**
 * Split one order line across sources. A null availableQty means no cap.
 * Sources that miss the requested deadline lose to any source that meets it.
 * If nobody meets it, the best source is still returned with late: true.
 */
export function allocateLine({
  quantity,
  candidates = [],
  now = new Date(),
  requestedAt = null,
  settings = {},
  closures = [],
  rejectedSourceIds = [],
} = {}) {
  const rejected = new Set(rejectedSourceIds)
  const ranked = candidates
    .filter(c => c && c.active !== false && c.available !== false && !rejected.has(c.sourceId))
    .map(c => {
      const deadlines = requestedAt ? planDeadlines({
        requestedAt,
        transportHours: c.transportHours ?? settings.transportHours ?? 0,
        warehouseHours: c.warehouseHours ?? settings.warehouseHours ?? 0,
        prepHours: c.prepHours ?? settings.prepHours ?? 0,
        leadHours: c.leadHours ?? settings.leadHours ?? 0,
        bufferHours: settings.bufferHours ?? 0,
        cutoff: c.cutoff ?? settings.cutoff ?? null,
        deliveryDays: c.deliveryDays ?? settings.deliveryDays ?? null,
        closures,
      }) : null
      const meets = !deadlines?.buyBy || deadlines.buyBy.getTime() >= new Date(now).getTime()
      return { ...c, deadlines, meets }
    })
    .sort(lower)

  const feasible = ranked.filter(c => c.meets)
  const pool = feasible.length ? feasible : ranked
  const forcedLate = feasible.length === 0 && pool.length > 0
  const slices = []
  let remaining = +quantity || 0
  const used = new Set()

  for (const row of pool) {
    if (remaining <= 0) break
    if (used.has(row.sourceId)) continue
    const moq = row.minimumQuantity ?? 1
    const cap = row.availableQty == null ? remaining : Math.min(remaining, +row.availableQty || 0)
    if (cap < moq || cap <= 0) continue
    slices.push({
      sourceId: row.sourceId,
      sourceType: row.sourceType || null,
      fornecedorId: row.fornecedorId || null,
      quantity: cap,
      late: forcedLate || !row.meets,
      expectedUnitCost: row.purchasePrice ?? null,
      purchaseUrl: row.purchaseUrl || null,
      deadlines: row.deadlines,
      assigneeId: row.assigneeId || null,
    })
    remaining -= cap
    used.add(row.sourceId)
  }

  return { slices, unmet: remaining, forcedLate }
}

export function deadlineMissed({ requestedAt, expectedAt } = {}) {
  if (!requestedAt || !expectedAt) return false
  return new Date(expectedAt).getTime() > new Date(requestedAt).getTime()
}

export function purchaseIsComplete(purchase) {
  if (!purchase) return false
  return !!(
    purchase.buyerId
    && purchase.purchasedAt
    && purchase.sourceId
    && +purchase.quantity > 0
    && purchase.unitCost != null
    && +purchase.unitCost > 0
  )
}

export function purchasedQty(taskId, purchases = []) {
  return purchases
    .filter(p => p.taskId === taskId && purchaseIsComplete(p))
    .reduce((sum, p) => sum + (+p.quantity || 0), 0)
}

export function canMarkPurchased(task, purchases = []) {
  if (!task || task.status === 'cancelled') return false
  return purchasedQty(task.id, purchases) >= (+task.quantityAllocated || 0)
}

const TRANSITIONS = {
  plan: ['draft'],
  assign: ['draft', 'planned'],
  queue: ['planned', 'assigned'],
  start_purchase: ['assigned', 'waiting_purchase'],
  ship: ['purchased', 'received', 'partially_received'],
  receive_partial: ['purchased', 'in_transit', 'received'],
  receive: ['purchased', 'in_transit', 'partially_received', 'received'],
  complete: ['received'],
  cancel: ACTIVE,
  exception: ACTIVE,
}

export function assertTransition(status, action) {
  const allowed = TRANSITIONS[action]
  if (!allowed) throw new Error(`invalid action ${action}`)
  const ok = allowed instanceof Set ? allowed.has(status) : allowed.includes(status)
  if (!ok || status === 'completed' || status === 'cancelled') {
    if (action !== 'exception' && action !== 'cancel') {
      throw new Error(`invalid transition from ${status} via ${action}`)
    }
    if (status === 'completed' || status === 'cancelled') {
      throw new Error(`invalid transition from ${status} via ${action}`)
    }
  }
}

export function applyReceive({ allocated, received, incoming, toBar = false }) {
  const next = (+received || 0) + (+incoming || 0)
  const atBar = toBar ? next : (+received || 0)
  let status = 'partially_received'
  if (next <= 0) status = 'purchased'
  else if (next >= (+allocated || 0)) status = toBar ? 'completed' : 'received'
  return { received: next, atBar: toBar ? next : undefined, status }
}

export function lineProgress(ordered, tasks = []) {
  const live = tasks.filter(t => t.status !== 'cancelled')
  const allocated = live.reduce((s, t) => s + (+t.quantityAllocated || 0), 0)
  const purchased = live.reduce((s, t) => s + (+t.quantityPurchased || 0), 0)
  const atBar = live.reduce((s, t) => s + (+t.quantityAtBar || 0), 0)
  return {
    ordered: +ordered || 0,
    allocated,
    purchased,
    atBar,
    covered: atBar >= (+ordered || 0) && (+ordered || 0) > 0,
  }
}

export function orderCovered(lines = []) {
  return lines.length > 0 && lines.every(line => lineProgress(line.quantity, line.tasks).covered)
}

export function shipmentQty(shipments = [], { toType = null, statuses = ['delivered'] } = {}) {
  return shipments
    .filter(s => (!toType || s.toType === toType) && statuses.includes(s.status))
    .flatMap(s => s.items || [])
    .reduce((sum, item) => sum + (+item.quantity || 0), 0)
}

export function resolveSalePrice({ prices = [], catalogPrice = null, at = new Date(), qty = 1 } = {}) {
  const when = new Date(at).getTime()
  const matches = prices.filter(row => {
    if (row.active === false) return false
    if (row.validFrom && new Date(row.validFrom).getTime() > when) return false
    if (row.validUntil && new Date(row.validUntil).getTime() < when) return false
    if ((row.minimumQuantity ?? 1) > qty) return false
    return row.salePrice != null
  })
  matches.sort((a, b) => (b.minimumQuantity ?? 1) - (a.minimumQuantity ?? 1) || String(b.validFrom || '').localeCompare(String(a.validFrom || '')))
  if (matches.length) return +matches[0].salePrice
  return catalogPrice == null ? null : +catalogPrice
}

export function economics({ unitCost = 0, qty = 0, freight = 0, fees = 0, salePrice = 0 } = {}) {
  const purchase = (+unitCost || 0) * (+qty || 0)
  const real = purchase + (+freight || 0) + (+fees || 0)
  const revenue = (+salePrice || 0) * (+qty || 0)
  return {
    purchase,
    freight: +freight || 0,
    fees: +fees || 0,
    real,
    revenue,
    margin: revenue - real,
    unitReal: qty ? real / qty : 0,
  }
}

const BAR_HIDDEN = ['expectedUnitCost', 'actualUnitCost', 'actualTotalCost', 'purchasePrice', 'freight', 'fees', 'margin', 'sourceName', 'fornecedorId']

export function forBar(progress) {
  const lines = (progress?.lines || []).map(line => ({
    productId: line.productId,
    name: line.name,
    quantity: line.quantity,
    atBar: line.atBar || 0,
    salePrice: line.salePrice ?? null,
    shipments: (line.shipments || []).map(s => ({
      code: s.code,
      status: s.status,
      expectedAt: s.expectedAt || null,
    })),
  }))
  return { orderId: progress?.orderId || null, publicCode: progress?.publicCode || null, lines }
}

export function barPayloadLeaksCost(payload) {
  const text = JSON.stringify(payload)
  return BAR_HIDDEN.some(key => Object.prototype.hasOwnProperty.call(flattenKeys(payload), key)) || /"margin"|"freight"|"unitCost"/i.test(text)
}

function flattenKeys(value, acc = {}) {
  if (!value || typeof value !== 'object') return acc
  for (const [key, child] of Object.entries(value)) {
    acc[key] = true
    if (child && typeof child === 'object') flattenKeys(child, acc)
  }
  return acc
}

export function forSupplier(tasks = [], supplierId) {
  return tasks
    .filter(task => task.fornecedorId === supplierId && task.status !== 'cancelled')
    .map(task => supplierTaskView(task))
}

const SUPPLIER_HIDDEN = [
  'expectedUnitCost', 'expected_unit_cost', 'actualUnitCost', 'actual_unit_cost',
  'actualTotalCost', 'actual_total_cost', 'margin', 'freight', 'fees',
  'logisticsCost', 'logistics_cost', 'salePrice', 'sale_price', 'realCost', 'real_cost',
]

export function supplierTaskView(task) {
  return {
    taskNumber: task.taskNumber || task.task_number,
    quantity: task.quantityAllocated ?? task.quantity,
    status: task.status,
    buyByAt: task.buyByAt || task.buy_by_at || null,
  }
}

export function supplierViewLeaksCost(payload) {
  return Object.keys(flattenKeys(payload)).some(key => SUPPLIER_HIDDEN.includes(key))
}

export function isProcurementHq(role) {
  return role === 'admin' || role === 'jbm'
}

export function canCallMyTasks(role) {
  return role === 'admin' || role === 'jbm' || role === 'funcionario'
}

export function canReadTasksDirect(role) {
  return isProcurementHq(role)
}

export function orderStatusAfterPlan({ made = 0, unmet = 0, current = 'pendente' } = {}) {
  if (current !== 'pendente') return current
  if (made > 0 && unmet === 0) return 'confirmado'
  return 'pendente'
}

export function assertSalePrice(price, productId, barId) {
  if (price == null || +price <= 0) {
    throw new Error(`sale price not configured for product ${productId} and bar ${barId}`)
  }
  return +price
}

const FALLBACK_OK = new Set(['draft', 'planned', 'assigned', 'waiting_purchase', 'purchasing', 'exception'])

export function assertFallback(status) {
  if (!FALLBACK_OK.has(status)) {
    throw new Error('cannot fallback a task after purchase or shipment')
  }
}

export function assertSameOrder(tasks = []) {
  const ids = new Set(tasks.map(task => task.orderId))
  if (ids.size > 1) throw new Error('shipment tasks must belong to the same order')
}

export function assertShipmentDestination({ destType, destBarId, orderBarId }) {
  if (destType === 'BAR' && destBarId !== orderBarId) {
    throw new Error('shipment destination bar does not match order bar')
  }
}

export function availableToShip({ fromType, quantityPurchased = 0, quantityReceived = 0, already = 0 } = {}) {
  const base = fromType === 'WAREHOUSE' ? +quantityReceived || 0 : +quantityPurchased || 0
  return base - (+already || 0)
}

export function assertShipQuantity(input) {
  const quantity = +input.quantity || 0
  if (quantity <= 0) throw new Error('quantity required')
  const available = availableToShip(input)
  if (quantity > available) throw new Error('shipment quantity exceeds what was purchased')
  return available
}

export function forEmployee(tasks = [], userId) {
  return tasks.filter(task => task.assignedTo === userId && task.status !== 'cancelled')
}

export function attentionBuckets({ tasks = [], shipments = [], now = new Date() } = {}) {
  const today = tokyoKey(...Object.values(tokyoParts(now)).slice(0, 3))
  const tomorrowParts = tokyoParts(addHours(now, 24))
  const tomorrow = tokyoKey(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day)
  const open = tasks.filter(t => !['completed', 'cancelled'].includes(t.status))
  const dayOf = (value) => {
    if (!value) return ''
    const p = tokyoParts(value)
    return tokyoKey(p.year, p.month, p.day)
  }
  const buckets = {
    late: [],
    dueToday: [],
    dueTomorrow: [],
    waitingPurchase: [],
    waitingSupplier: [],
    waitingEmployee: [],
    purchased: [],
    inTransit: [],
    awaitingReceipt: [],
    problem: [],
    deliveryToday: [],
    incomplete: [],
  }
  for (const task of open) {
    const due = dayOf(task.buyBy || task.requestedAt)
    if (task.status === 'exception' || task.late) buckets.problem.push(task.id)
    if (task.buyBy && new Date(task.buyBy).getTime() < new Date(now).getTime() && !['received', 'partially_received'].includes(task.status)) buckets.late.push(task.id)
    if (due === today) buckets.dueToday.push(task.id)
    if (due === tomorrow) buckets.dueTomorrow.push(task.id)
    if (['assigned', 'waiting_purchase', 'purchasing'].includes(task.status)) buckets.waitingPurchase.push(task.id)
    if (task.sourceType === 'SUPPLIER' && ['assigned', 'waiting_purchase'].includes(task.status)) buckets.waitingSupplier.push(task.id)
    if (task.assignedTo && ['EMPLOYEE', 'ONLINE', 'PHYSICAL_STORE', 'DIRECT'].includes(task.sourceType) && ['assigned', 'waiting_purchase', 'purchasing'].includes(task.status)) buckets.waitingEmployee.push(task.id)
    if (task.status === 'purchased') buckets.purchased.push(task.id)
    if (task.status === 'in_transit') buckets.inTransit.push(task.id)
    if (['purchased', 'in_transit', 'partially_received'].includes(task.status)) buckets.awaitingReceipt.push(task.id)
    if ((+task.quantityAtBar || 0) < (+task.quantityAllocated || 0)) buckets.incomplete.push(task.id)
  }
  for (const ship of shipments) {
    if (['cancelled', 'delivered'].includes(ship.status)) continue
    if (dayOf(ship.expectedAt) === today) buckets.deliveryToday.push(ship.id)
  }
  return buckets
}

export const TOKYO_OFFSET = TOKYO_OFFSET_HOURS
