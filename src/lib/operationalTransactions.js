/** In-memory transaction rules. No database client is imported or called. */

const SALE_ROLES = ['gerente', 'admin', 'cliente', 'caixa', 'bar_staff']
const DISCOUNT_ROLES = ['gerente', 'admin', 'cliente']
const CASH_ROLES = ['gerente', 'admin', 'cliente', 'caixa']
const CLOCK_ROLES = ['funcionario', 'bar_staff', 'gerente', 'admin']
const PURCHASE_ROLES = ['gerente', 'admin']
const SUPPLIER_ROLES = ['fornecedor', 'admin']

const NEXT_STATUS = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'in_transit',
  in_transit: 'delivered',
}

function fail(code, message) {
  return { ok: false, code, error: message, executed: false }
}

function audit(store, command, detail) {
  store.audit.push({
    action: command.type,
    barId: command.barId || null,
    actor: command.actorId || command.role || '',
    detail,
  })
}

function isolated(command) {
  if (command.role === 'admin') return false
  return Boolean(command.actorBarId && command.barId && command.actorBarId !== command.barId)
}

function remember(store, key, result) {
  store.idempotency[key] = result
  return result
}

export function createStore(seed = {}) {
  return {
    catalog: seed.catalog || {},
    sales: [],
    cash: seed.cash || {},
    punches: [],
    orders: seed.orders ? seed.orders.map(order => ({ ...order, lines: order.lines.map(line => ({ ...line })) })) : [],
    receipts: {},
    idempotency: {},
    audit: [],
  }
}

function lineMoney(store, command) {
  const lines = []
  for (const line of command.lines || []) {
    const product = store.catalog[line.sku]
    if (!product) return { error: fail('UNKNOWN_PRODUCT', 'The product is not in the server catalog.') }
    const qty = Math.round(+line.qty || 0)
    if (qty <= 0) return { error: fail('QUANTITY', 'Each line needs a quantity.') }
    const onHand = product.stock?.[command.barId] ?? 0
    if (qty > onHand) return { error: fail('STOCK', `Stock for ${line.sku} is ${onHand}.`) }
    lines.push({ sku: line.sku, qty, price: product.price, total: product.price * qty })
  }
  const list = lines.reduce((sum, line) => sum + line.total, 0)
  const rate = command.discountRate || 0
  const discount = Math.round(list * rate)
  const total = list - discount
  if (command.clientTotal != null && Number(command.clientTotal) !== total) {
    return { error: fail('TOTAL', 'The client total does not match the server total.') }
  }
  return { lines, list, discount, total }
}

export function commit(store, command = {}) {
  if (!command.idempotencyKey) return fail('IDEMPOTENCY', 'An idempotency key is required.')
  const prior = store.idempotency[command.idempotencyKey]
  if (prior) return { ...prior, replayed: true }
  if (isolated(command)) return remember(store, command.idempotencyKey, fail('ISOLATION', 'This bar is outside the actor scope.'))

  if (command.type === 'discount') {
    if (!DISCOUNT_ROLES.includes(command.role)) return remember(store, command.idempotencyKey, fail('UNAUTHORIZED', 'Discounts require a manager.'))
    if (![0, 0.1, 0.2].includes(+command.rate)) return remember(store, command.idempotencyKey, fail('RATE', 'The discount rate is not allowed.'))
    audit(store, command, `rate ${command.rate}`)
    return remember(store, command.idempotencyKey, { ok: true, executed: true, rate: +command.rate })
  }

  if (command.type === 'pos-sale') {
    if (!SALE_ROLES.includes(command.role)) return remember(store, command.idempotencyKey, fail('UNAUTHORIZED', 'This role cannot sell.'))
    if (command.method === 'cash') {
      const drawer = store.cash[command.barId]
      if (!drawer || drawer.status !== 'open') return remember(store, command.idempotencyKey, fail('REGISTER', 'Open the register before taking cash.'))
    }
    const priced = lineMoney(store, command)
    if (priced.error) return remember(store, command.idempotencyKey, priced.error)
    for (const line of priced.lines) store.catalog[line.sku].stock[command.barId] -= line.qty
    const sale = {
      id: `sale-${command.idempotencyKey}`,
      barId: command.barId,
      method: command.method || 'other',
      total: priced.total,
      paid: false,
    }
    store.sales.push(sale)
    audit(store, command, sale.id)
    return remember(store, command.idempotencyKey, { ok: true, executed: true, sale })
  }

  if (command.type === 'cash-payment') {
    if (!CASH_ROLES.includes(command.role)) return remember(store, command.idempotencyKey, fail('UNAUTHORIZED', 'This role cannot take cash.'))
    const sale = store.sales.find(row => row.id === command.saleId && row.barId === command.barId)
    if (!sale) return remember(store, command.idempotencyKey, fail('SALE', 'The sale was not found in this bar.'))
    if (sale.paid) return remember(store, command.idempotencyKey, fail('DUPLICATE_PAYMENT', 'This sale is already paid.'))
    const drawer = store.cash[command.barId]
    if (!drawer || drawer.status !== 'open') return remember(store, command.idempotencyKey, fail('REGISTER', 'The register is closed.'))
    sale.paid = true
    sale.method = 'cash'
    drawer.in += sale.total
    audit(store, command, sale.id)
    return remember(store, command.idempotencyKey, { ok: true, executed: true, saleId: sale.id, expected: drawer.float + drawer.in - drawer.out })
  }

  if (command.type === 'cash-movement') {
    if (!CASH_ROLES.includes(command.role)) return remember(store, command.idempotencyKey, fail('UNAUTHORIZED', 'This role cannot move cash.'))
    const drawer = store.cash[command.barId]
    if (!drawer || drawer.status !== 'open') return remember(store, command.idempotencyKey, fail('REGISTER', 'The register is closed.'))
    const amount = Math.round(+command.amount || 0)
    if (amount <= 0) return remember(store, command.idempotencyKey, fail('AMOUNT', 'The amount must be positive.'))
    if (command.direction === 'out') drawer.out += amount
    else drawer.in += amount
    audit(store, command, `${command.direction} ${amount}`)
    return remember(store, command.idempotencyKey, { ok: true, executed: true, expected: drawer.float + drawer.in - drawer.out })
  }

  if (command.type === 'cash-close') {
    if (!CASH_ROLES.includes(command.role)) return remember(store, command.idempotencyKey, fail('UNAUTHORIZED', 'This role cannot close the register.'))
    const drawer = store.cash[command.barId]
    if (!drawer || drawer.status !== 'open') return remember(store, command.idempotencyKey, fail('REGISTER', 'The register is already closed.'))
    const expected = drawer.float + drawer.in - drawer.out
    const counted = Math.round(+command.counted || 0)
    drawer.status = 'closed'
    drawer.variance = counted - expected
    audit(store, command, `variance ${drawer.variance}`)
    return remember(store, command.idempotencyKey, { ok: true, executed: true, expected, variance: drawer.variance })
  }

  if (command.type === 'clock') {
    if (!CLOCK_ROLES.includes(command.role)) return remember(store, command.idempotencyKey, fail('UNAUTHORIZED', 'This role cannot punch the clock.'))
    const open = [...store.punches].reverse().find(row => row.actorId === command.actorId && row.tipo === 'in' && !row.closed)
    if (command.tipo === 'in') {
      if (open) return remember(store, command.idempotencyKey, fail('DUPLICATE_CLOCK', 'This shift is already open.'))
      store.punches.push({ actorId: command.actorId, barId: command.barId, tipo: 'in', closed: false })
    } else if (command.tipo === 'out') {
      if (!open) return remember(store, command.idempotencyKey, fail('CLOCK', 'There is no open shift.'))
      open.closed = true
      store.punches.push({ actorId: command.actorId, barId: command.barId, tipo: 'out', closed: true })
    } else return remember(store, command.idempotencyKey, fail('CLOCK', 'The punch type is not supported.'))
    audit(store, command, command.tipo)
    return remember(store, command.idempotencyKey, { ok: true, executed: true, tipo: command.tipo })
  }

  if (command.type === 'purchase-request') {
    if (!PURCHASE_ROLES.includes(command.role)) return remember(store, command.idempotencyKey, fail('UNAUTHORIZED', 'This role cannot request a purchase.'))
    const order = {
      id: `po-${command.idempotencyKey}`,
      barId: command.barId,
      status: 'pending',
      lines: (command.lines || []).map(line => ({ sku: line.sku, qty: Math.round(+line.qty || 0) })),
    }
    store.orders.push(order)
    audit(store, command, order.id)
    return remember(store, command.idempotencyKey, { ok: true, executed: true, order })
  }

  if (command.type === 'supplier-status') {
    if (!SUPPLIER_ROLES.includes(command.role)) return remember(store, command.idempotencyKey, fail('UNAUTHORIZED', 'This role cannot update the supplier order.'))
    const order = store.orders.find(row => row.id === command.orderId)
    if (!order) return remember(store, command.idempotencyKey, fail('ORDER', 'The order was not found.'))
    if (order.barId !== command.barId && command.role !== 'admin') {
      return remember(store, command.idempotencyKey, fail('ISOLATION', 'The order belongs to another bar.'))
    }
    const next = NEXT_STATUS[order.status]
    if (next !== command.status) return remember(store, command.idempotencyKey, fail('STATUS', 'That status transition is not allowed.'))
    order.status = next
    audit(store, command, `${order.id} ${next}`)
    return remember(store, command.idempotencyKey, { ok: true, executed: true, status: next })
  }

  if (command.type === 'stock-receipt') {
    if (!SUPPLIER_ROLES.includes(command.role) && !PURCHASE_ROLES.includes(command.role)) {
      return remember(store, command.idempotencyKey, fail('UNAUTHORIZED', 'This role cannot receive stock.'))
    }
    const order = store.orders.find(row => row.id === command.orderId && row.barId === command.barId)
    if (!order) return remember(store, command.idempotencyKey, fail('ORDER', 'The order was not found in this bar.'))
    if (order.status !== 'delivered') return remember(store, command.idempotencyKey, fail('STATUS', 'Stock is received only after delivery.'))
    if (store.receipts[order.id]) {
      return remember(store, command.idempotencyKey, { ok: true, executed: false, replayed: true, receipt: store.receipts[order.id] })
    }
    for (const line of order.lines) {
      if (!store.catalog[line.sku]) return remember(store, command.idempotencyKey, fail('UNKNOWN_PRODUCT', 'The product is not in the server catalog.'))
    }
    for (const line of order.lines) {
      const product = store.catalog[line.sku]
      product.stock[command.barId] = (product.stock[command.barId] || 0) + line.qty
    }
    store.receipts[order.id] = { orderId: order.id, lines: order.lines }
    audit(store, command, order.id)
    return remember(store, command.idempotencyKey, { ok: true, executed: true, receipt: store.receipts[order.id] })
  }

  return remember(store, command.idempotencyKey, fail('UNKNOWN', 'The operation is not supported.'))
}
