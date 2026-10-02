/**
 * Isolated fictional books for Atomic Bar.
 * Stored only in this browser. Never written to a live database.
 */

import { tokyoNightKey } from './tokyo.js'
import { includedTaxBreakdown } from './consumptionTax.js'

export const LEDGER_KEY = 'atomic-bar-demo-ledger'
export const LEDGER_EVENT = 'atomic-demo-ledger'
export const DEMO_BAR_ID = 'demo-bar'
export const ANNEX_BAR_ID = 'demo-annex'
const VERSION = 2

const PRODUCT_SEED = [
  { id: 'demo-highball', nome: 'ハイボール', categoria: 'Whisky', price: 800, cost: 180, stock: 40, min: 12 },
  { id: 'demo-beer', nome: '生ビール', categoria: 'Beer', price: 700, cost: 210, stock: 28, min: 10 },
  { id: 'demo-sour', nome: 'レモンサワー', categoria: 'Sour', price: 750, cost: 160, stock: 4, min: 10 },
  { id: 'demo-shochu', nome: '焼酎ロック', categoria: 'Shochu', price: 900, cost: 240, stock: 16, min: 6 },
  { id: 'demo-wine', nome: '赤ワイン', categoria: 'Wine', price: 1200, cost: 420, stock: 3, min: 8 },
]

const HISTORY = [
  { offset: -6, method: 'cash', lines: [['demo-highball', 4], ['demo-beer', 3]] },
  { offset: -5, method: 'card', lines: [['demo-sour', 5], ['demo-wine', 2]] },
  { offset: -4, method: 'cash', lines: [['demo-shochu', 3], ['demo-highball', 2]] },
  { offset: -3, method: 'paypay', lines: [['demo-beer', 6], ['demo-sour', 2]] },
  { offset: -2, method: 'card', lines: [['demo-highball', 5], ['demo-wine', 1]] },
  { offset: -1, method: 'cash', lines: [['demo-shochu', 4], ['demo-beer', 2]] },
]

function memory() {
  if (!globalThis.__atomicDemoLedger) globalThis.__atomicDemoLedger = null
  return globalThis.__atomicDemoLedger
}

function persist(book) {
  globalThis.__atomicDemoLedger = book
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LEDGER_KEY, JSON.stringify(book))
  } catch {
    /* memory copy remains the source in this tab */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LEDGER_EVENT))
}

function addDays(key, delta) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + delta))
  return date.toISOString().slice(0, 10)
}

function productById(book, id) {
  return book.products.find(row => row.id === id)
}

function lineMoney(book, drinkId, qty) {
  const product = productById(book, drinkId)
  return {
    drinkId,
    nome: product.nome,
    qtd: qty,
    price: product.price,
    cost: product.cost,
    total: product.price * qty,
    cogs: product.cost * qty,
  }
}

function seedSales(today) {
  const book = { products: PRODUCT_SEED.map(row => ({ ...row })) }
  const sales = []
  for (let offset = -29; offset <= -7; offset += 1) {
    const drink = offset % 2 === 0 ? 'demo-highball' : 'demo-beer'
    const lines = [lineMoney(book, drink, 2)]
    sales.push({
      id: `demo-sale-d${Math.abs(offset)}`,
      barId: DEMO_BAR_ID,
      night: addDays(today, offset),
      method: offset % 3 === 0 ? 'cash' : 'card',
      lines,
      total: lines[0].total,
      cogs: lines[0].cogs,
      demo: true,
    })
  }
  HISTORY.forEach((night, index) => {
    const lines = night.lines.map(([id, qty]) => lineMoney(book, id, qty))
    sales.push({
      id: `demo-sale-h${index + 1}`,
      barId: DEMO_BAR_ID,
      night: addDays(today, night.offset),
      method: night.method,
      lines,
      total: lines.reduce((sum, line) => sum + line.total, 0),
      cogs: lines.reduce((sum, line) => sum + line.cogs, 0),
      demo: true,
    })
  })
  const todayLines = [
    lineMoney(book, 'demo-highball', 2),
    lineMoney(book, 'demo-sour', 1),
    lineMoney(book, 'demo-wine', 1),
  ]
  sales.push({
    id: 'demo-sale-today-cash',
    barId: DEMO_BAR_ID,
    night: today,
    method: 'cash',
    lines: [todayLines[0]],
    total: todayLines[0].total,
    cogs: todayLines[0].cogs,
    demo: true,
  })
  sales.push({
    id: 'demo-sale-today-card',
    barId: DEMO_BAR_ID,
    night: today,
    method: 'card',
    lines: [todayLines[1], todayLines[2]],
    total: todayLines[1].total + todayLines[2].total,
    cogs: todayLines[1].cogs + todayLines[2].cogs,
    demo: true,
  })
  const annex = [lineMoney(book, 'demo-beer', 2)]
  sales.push({
    id: 'demo-annex-today',
    barId: ANNEX_BAR_ID,
    night: today,
    method: 'card',
    lines: annex,
    total: annex[0].total,
    cogs: annex[0].cogs,
    demo: true,
  })
  return sales
}

function fresh(today = tokyoNightKey()) {
  const sales = seedSales(today)
  const cashIn = sales.filter(sale => sale.night === today && sale.method === 'cash').reduce((sum, sale) => sum + sale.total, 0)
  return {
    version: VERSION,
    night: today,
    demo: true,
    label: 'DEMO',
    venue: 'Atomic Bar',
    bars: [
      { id: DEMO_BAR_ID, nome: 'Atomic Bar', operable: true },
      { id: ANNEX_BAR_ID, nome: '南青山デモ', operable: false },
    ],
    announcements: [
      { id: 'demo-note-1', title: '金曜の仕込み', body: 'レモンサワーと赤ワインが発注点を下回っています。', demo: true },
    ],
    requests: [],
    reviews: [],
    audit: [],
    products: PRODUCT_SEED.map(row => ({ ...row })),
    sales,
    tickets: {},
    orders: [{
      id: 'PO-1042',
      supplier: '東京酒販デモ',
      status: 'pending',
      stockApplied: false,
      demo: true,
      lines: [
        { drinkId: 'demo-sour', nome: 'レモンサワー', ordered: 12, confirmed: null },
        { drinkId: 'demo-wine', nome: '赤ワイン', ordered: 6, confirmed: null },
      ],
    }],
    register: {
      status: 'open',
      float: 50000,
      movements: [{ id: 'demo-move-sales', direction: 'in', amount: cashIn, note: 'DEMO cash sales already on the books', at: `${today}T12:00:00+09:00` }],
      lastClose: null,
    },
    staff: [
      { id: 'demo-sato', name: '佐藤 美咲', rate: 1500, monthHours: 64, shiftStart: '18:00', shiftEnd: '23:00', shiftDate: today, tasks: ['カウンターを拭く', '開店前のグラスを揃える'] },
      { id: 'demo-tanaka', name: '田中 蓮', rate: 1400, monthHours: 48, shiftStart: '18:00', shiftEnd: '23:00', shiftDate: addDays(today, 1), tasks: ['レモンサワーを補充'] },
    ],
    punches: [],
    receiptNo: 1000,
    lastReceipt: null,
  }
}

export function resetLedger() {
  persist(fresh())
  return memory()
}

function read() {
  const today = tokyoNightKey()
  let book = memory()
  if (!book) {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(LEDGER_KEY)
        book = raw ? JSON.parse(raw) : null
      }
    } catch {
      book = null
    }
  }
  if (!book || book.version !== VERSION || book.night !== today || book.demo !== true) {
    book = fresh(today)
    persist(book)
  }
  return book
}

function write(book) {
  persist(book)
  return book
}

function previousMonthKey(night) {
  const [year, month] = String(night || '').split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 2, 1))
  return date.toISOString().slice(0, 7)
}

function monthTotals(monthKey, barId = DEMO_BAR_ID) {
  const book = read()
  const rows = book.sales.filter(sale => (sale.barId || DEMO_BAR_ID) === barId && sale.night.startsWith(monthKey))
  return { sales: sumSales(rows), cogs: sumCogs(rows) }
}

function yen(value) {
  return `¥${Math.round(value || 0).toLocaleString('ja-JP')}`
}

function sumSales(sales, pred = () => true) {
  return sales.filter(pred).reduce((sum, sale) => sum + sale.total, 0)
}

function sumCogs(sales, pred = () => true) {
  return sales.filter(pred).reduce((sum, sale) => sum + sale.cogs, 0)
}

function staffPunches(punches, staffId) {
  return punches.filter(row => row.staffId === staffId).slice().sort((a, b) => a.at.localeCompare(b.at))
}

function sessionHours(punches, staffId, now = Date.now()) {
  const rows = staffPunches(punches, staffId)
  let ms = 0
  let cursor = null
  let paused = false
  for (const row of rows) {
    const at = new Date(row.at).getTime()
    if (row.tipo === 'in') {
      cursor = at
      paused = false
    }
    if (row.tipo === 'break_start' && cursor != null && !paused) {
      ms += at - cursor
      paused = true
    }
    if (row.tipo === 'break_end' && paused) {
      paused = false
      cursor = at
    }
    if (row.tipo === 'out' && cursor != null) {
      if (!paused) ms += at - cursor
      cursor = null
      paused = false
    }
  }
  if (cursor != null && !paused) ms += now - cursor
  return Math.max(0, ms / 3600000)
}

function lastPunch(punches, staffId) {
  const rows = staffPunches(punches, staffId)
  return rows[rows.length - 1] || null
}

function shiftOpen(punches, staffId) {
  const rows = staffPunches(punches, staffId)
  if (!rows.some(row => row.tipo === 'in')) return false
  return lastPunch(punches, staffId)?.tipo !== 'out'
}

export function snapshot(now = Date.now()) {
  const book = read()
  const today = book.night
  const month = today.slice(0, 7)
  const own = book.sales.filter(sale => (sale.barId || DEMO_BAR_ID) === DEMO_BAR_ID)
  const todaySales = own.filter(sale => sale.night === today)
  const monthSales = own.filter(sale => sale.night.startsWith(month))
  const sales = sumSales(todaySales)
  const cogs = sumCogs(todaySales)
  const gross = sales - cogs
  const monthRevenue = sumSales(monthSales)
  const monthCogs = sumCogs(monthSales)
  const people = book.staff.map(person => {
    const extra = sessionHours(book.punches, person.id, now)
    const hours = person.monthHours + extra
    return {
      ...person,
      sessionHours: extra,
      hours,
      earnings: Math.round(hours * person.rate),
      clockedIn: shiftOpen(book.punches, person.id),
      onBreak: lastPunch(book.punches, person.id)?.tipo === 'break_start',
    }
  })
  const laborMonth = people.reduce((sum, person) => sum + person.earnings, 0)
  const laborToday = people.reduce((sum, person) => sum + Math.round(person.sessionHours * person.rate), 0)
  const nights = []
  for (let offset = -6; offset <= 0; offset += 1) {
    const night = addDays(today, offset)
    nights.push({ label: night.slice(5), night, value: sumSales(own, sale => sale.night === night) })
  }
  const productMap = new Map()
  for (const sale of own) {
    for (const line of sale.lines) {
      const row = productMap.get(line.drinkId) || { nome: line.nome, sales: 0, cogs: 0, qty: 0 }
      row.sales += line.total
      row.cogs += line.cogs
      row.qty += line.qtd
      productMap.set(line.drinkId, row)
    }
  }
  const products = [...productMap.entries()].map(([id, row]) => ({
    id,
    nome: row.nome,
    sales: row.sales,
    cogs: row.cogs,
    qty: row.qty,
    gross: row.sales - row.cogs,
  })).sort((a, b) => b.gross - a.gross)
  const methods = {}
  for (const sale of own) methods[sale.method] = (methods[sale.method] || 0) + sale.total
  const float = book.register.float
  const inn = book.register.movements.filter(row => row.direction === 'in').reduce((sum, row) => sum + row.amount, 0)
  const out = book.register.movements.filter(row => row.direction === 'out').reduce((sum, row) => sum + row.amount, 0)
  const expected = float + inn - out
  const low = book.products.filter(row => row.stock < row.min)
  const attention = [
    ...low.map(row => ({ label: row.nome, value: `Low · ${row.stock} / reorder ${row.min}` })),
    ...book.orders.filter(row => !['delivered', 'rejected'].includes(row.status)).map(row => ({ label: row.id, value: `${row.status} · ${row.supplier}` })),
    { label: 'Register', value: book.register.status === 'open' ? `Open · expected ${yen(expected)}` : `Closed · variance ${yen(book.register.lastClose?.variance || 0)}` },
  ]
  return {
    demo: true,
    night: today,
    venue: book.venue,
    today: { sales, cogs, gross, orders: todaySales.length, cmv: sales ? cogs / sales : null, ticket: todaySales.length ? Math.round(sales / todaySales.length) : null },
    month: { sales: monthRevenue, cogs: monthCogs, gross: monthRevenue - monthCogs, labor: laborMonth, laborToday },
    cash: { ...book.register, expected },
    products: book.products.map(row => ({ ...row })),
    ranking: products,
    payments: methods,
    trend: nights,
    staff: people,
    orders: book.orders.map(row => ({ ...row, lines: row.lines.map(line => ({ ...line })) })),
    attention,
    lastReceipt: book.lastReceipt,
    announcements: book.announcements || [],
    requests: book.requests || [],
    audit: (book.audit || []).slice(0, 12),
    bars: book.bars || [],
  }
}

export function menuRows() {
  const book = read()
  return book.products.map(row => ({
    id: row.id,
    bar_id: DEMO_BAR_ID,
    nome: row.nome,
    categoria: row.categoria,
    preco_venda: row.price,
    custo: row.cost,
    estoque: row.stock,
    minimo: row.min,
    ativo: true,
    demo: true,
  }))
}

export function salesRows() {
  const book = read()
  return book.sales.filter(sale => (sale.barId || DEMO_BAR_ID) === DEMO_BAR_ID).map(sale => ({
    id: sale.id,
    bar_id: DEMO_BAR_ID,
    total: sale.total,
    refunded: false,
    card_fee: 0,
    card_fee_reversed: false,
    criado_em: `${sale.night}T20:00:00+09:00`,
    data: sale.night,
    metodo_pagamento: sale.method,
    obs: 'DEMO',
    drink_back_agent_id: null,
    demo: true,
  }))
}

function ticketById(book, ticketId) {
  return Object.values(book.tickets).find(ticket => ticket.id === ticketId) || null
}

function lineCharge(line, ticketRate) {
  const rate = line.discountRate != null ? line.discountRate : (ticketRate || 0)
  const list = line.price * line.qtd
  const discount = Math.round(list * rate)
  return { list, discount, total: list - discount, rate }
}

function ticketPayload(ticket) {
  const priced = ticket.items.map(line => ({ line, money: lineCharge(line, ticket.discountRate) }))
  const list = priced.reduce((sum, row) => sum + row.money.list, 0)
  const discount = priced.reduce((sum, row) => sum + row.money.discount, 0)
  const total = list - discount
  const tax = includedTaxBreakdown(total)
  const cogs = ticket.items.reduce((sum, line) => sum + line.cost * line.qtd, 0)
  return {
    id: ticket.id,
    items: ticket.items.map(line => ({
      id: line.id,
      qtd: line.qtd,
      for_cast: false,
      drink_menu_id: line.drinkId,
      nome: line.nome,
    })),
    listSubtotal: list,
    discount,
    subtotal: total,
    total,
    tax: tax.tax,
    taxNote: 'Included 10% consumption tax. Not added on top.',
    cogs,
    fee: 0,
    net: total,
    commission: 0,
    blocked: '',
    lines: ticket.items.map(line => ({
      id: line.id,
      nome: line.nome,
      unit_price: line.price,
      mode: 'unit',
      discountRate: line.discountRate ?? null,
    })),
    demo: true,
  }
}

export function loadTicket({ p_space: spaceId } = {}) {
  const book = read()
  if (!spaceId) return { data: null, error: { message: 'Choose a DEMO table' } }
  if (!book.tickets[spaceId]) {
    book.tickets[spaceId] = { id: `demo-ticket-${spaceId}`, spaceId, items: [], discountRate: 0 }
    write(book)
  }
  return { data: ticketPayload(book.tickets[spaceId]), error: null }
}

export function previewTicket({ p_ticket: ticketId } = {}) {
  const book = read()
  const ticket = ticketById(book, ticketId)
  if (!ticket) return { data: { total: 0, subtotal: 0, lines: [], fee: 0, net: 0, commission: 0 }, error: null }
  return { data: ticketPayload(ticket), error: null }
}

export function ticketItem({ p_ticket: ticketId, p_item: itemId, p_qtd: qty = 1, p_drink: drinkId } = {}) {
  const book = read()
  const ticket = ticketById(book, ticketId)
  if (!ticket) return { data: null, error: { message: 'Open a DEMO table first' } }
  if (itemId) {
    const line = ticket.items.find(row => row.id === itemId)
    if (!line) return { data: null, error: { message: 'DEMO line was not found' } }
    const next = Math.round(+qty || 0)
    if (next <= 0) ticket.items = ticket.items.filter(row => row.id !== itemId)
    else {
      const product = productById(book, line.drinkId)
      if (next > product.stock) return { data: null, error: { message: `DEMO stock for ${product.nome} is ${product.stock}` } }
      line.qtd = next
    }
  } else if (drinkId) {
    const product = productById(book, drinkId)
    if (!product) return { data: null, error: { message: 'DEMO drink was not found' } }
    const add = Math.max(1, Math.round(+qty || 1))
    const existing = ticket.items.find(row => row.drinkId === drinkId)
    const next = (existing?.qtd || 0) + add
    if (next > product.stock) return { data: null, error: { message: `DEMO stock for ${product.nome} is ${product.stock}` } }
    if (existing) existing.qtd = next
    else ticket.items.push({ id: `demo-line-${Math.random().toString(36).slice(2, 8)}`, drinkId, nome: product.nome, qtd: add, price: product.price, cost: product.cost })
  }
  write(book)
  return { data: ticketPayload(ticket), error: null }
}

export function applyDiscount({ p_ticket: ticketId, p_rate: rate, p_item: itemId, p_role: role } = {}) {
  const book = read()
  if (role && !['gerente', 'admin', 'cliente'].includes(role)) {
    return { data: null, error: { message: 'DEMO discounts require a manager' } }
  }
  const ticket = ticketById(book, ticketId)
  if (!ticket) return { data: null, error: { message: 'Open a DEMO table first' } }
  const allowed = [0, 0.1, 0.2]
  const next = allowed.includes(+rate) ? +rate : 0
  if (itemId) {
    const line = ticket.items.find(row => row.id === itemId)
    if (!line) return { data: null, error: { message: 'DEMO line was not found' } }
    line.discountRate = next
    ticket.discountRate = 0
  } else {
    ticket.discountRate = next
    ticket.items.forEach(line => { line.discountRate = null })
  }
  audit(book, 'discount', itemId ? `line ${itemId} ${next}` : `ticket ${next}`)
  write(book)
  return { data: ticketPayload(ticket), error: null }
}

export function closeTicket({ p_ticket: ticketId, p_payment: method = 'cash' } = {}) {
  const book = read()
  const ticket = ticketById(book, ticketId)
  if (!ticket || !ticket.items.length) return { data: null, error: { message: 'DEMO ticket is empty' } }
  for (const line of ticket.items) {
    const product = productById(book, line.drinkId)
    if (!product || line.qtd > product.stock) {
      return { data: null, error: { message: `DEMO stock for ${line.nome} is ${product?.stock ?? 0}` } }
    }
  }
  if (method === 'cash' && book.register.status !== 'open') {
    return { data: null, error: { message: 'Open the DEMO register before taking cash' } }
  }
  const view = ticketPayload(ticket)
  for (const line of ticket.items) productById(book, line.drinkId).stock -= line.qtd
  const sale = {
    id: `demo-sale-${book.receiptNo + 1}`,
    night: book.night,
    method,
    lines: ticket.items.map(line => ({ ...line, total: line.price * line.qtd, cogs: line.cost * line.qtd })),
    total: view.total,
    cogs: view.cogs,
    demo: true,
  }
  book.sales.push(sale)
  if (method === 'cash') {
    book.register.movements.push({
      id: `demo-move-${book.receiptNo + 1}`,
      direction: 'in',
      amount: view.total,
      note: 'DEMO cash sale',
      at: new Date().toISOString(),
    })
  }
  book.receiptNo += 1
  const receipt = {
    demo: true,
    id: `DEMO-R-${book.receiptNo}`,
    night: book.night,
    method,
    lines: ticket.items.map(line => ({ nome: line.nome, qtd: line.qtd, total: line.price * line.qtd })),
    listSubtotal: view.listSubtotal,
    discount: view.discount,
    tax: view.tax,
    total: view.total,
    note: 'Fictional DEMO receipt. No live charge was sent.',
  }
  book.lastReceipt = receipt
  delete book.tickets[ticket.spaceId]
  write(book)
  return { data: { ok: true, receipt }, error: null }
}

export function sellDrink({ drinkId, qty = 1, method = 'cash', spaceId = 'demo-space-direct' } = {}) {
  const opened = loadTicket({ p_space: spaceId })
  if (opened.error) return { ok: false, error: opened.error.message }
  const added = ticketItem({ p_ticket: opened.data.id, p_drink: drinkId, p_qtd: qty })
  if (added.error) return { ok: false, error: added.error.message }
  const closed = closeTicket({ p_ticket: opened.data.id, p_payment: method })
  if (closed.error) return { ok: false, error: closed.error.message }
  return { ok: true, receipt: closed.data.receipt }
}

export function recordMovement({ direction = 'in', amount, note = 'DEMO movement' } = {}) {
  const book = read()
  if (book.register.status !== 'open') return { ok: false, error: 'Open the DEMO register first' }
  const value = Math.round(+amount || 0)
  if (value <= 0) return { ok: false, error: 'Enter an amount' }
  if (direction !== 'in' && direction !== 'out') return { ok: false, error: 'Choose cash in or cash out' }
  book.register.movements.push({ id: `demo-move-${Date.now()}`, direction, amount: value, note, at: new Date().toISOString() })
  write(book)
  return { ok: true }
}

export function openRegister(float = 50000) {
  const book = read()
  if (book.register.status === 'open') return { ok: false, error: 'DEMO register is already open' }
  const value = Math.round(+float || 0)
  book.register = { status: 'open', float: value, movements: [], lastClose: book.register.lastClose }
  write(book)
  return { ok: true }
}

export function closeRegister(counted) {
  const book = read()
  if (book.register.status !== 'open') return { ok: false, error: 'DEMO register is already closed' }
  const view = snapshot()
  const value = Math.round(+counted || 0)
  book.register.status = 'closed'
  book.register.lastClose = {
    expected: view.cash.expected,
    counted: value,
    variance: value - view.cash.expected,
    at: new Date().toISOString(),
  }
  write(book)
  return { ok: true, close: book.register.lastClose }
}

export function createPurchaseRequest() {
  const book = read()
  const open = book.orders.find(order => !['delivered', 'rejected'].includes(order.status))
  if (open) return { ok: true, created: false, order: open }
  const lines = book.products.filter(row => row.stock < row.min).map(row => ({
    drinkId: row.id,
    nome: row.nome,
    ordered: Math.max(row.min - row.stock, 1),
    confirmed: null,
  }))
  if (!lines.length) return { ok: false, error: 'Nothing is below the DEMO reorder point' }
  const order = {
    id: `PO-${1043 + book.orders.length}`,
    supplier: '東京酒販デモ',
    status: 'pending',
    stockApplied: false,
    demo: true,
    lines,
  }
  book.orders.unshift(order)
  write(book)
  return { ok: true, created: true, order }
}

export function confirmOrder(id, quantities = {}) {
  const book = read()
  const order = book.orders.find(row => row.id === id)
  if (!order) return { ok: false, error: 'DEMO order was not found' }
  if (order.status !== 'pending') return { ok: false, error: 'Confirm quantities only while the DEMO order is pending' }
  order.lines = order.lines.map(line => ({
    ...line,
    confirmed: quantities[line.drinkId] != null ? Math.round(+quantities[line.drinkId] || 0) : line.ordered,
  }))
  order.status = 'confirmed'
  audit(book, 'supplier-accept', id)
  write(book)
  return { ok: true, order }
}

const NEXT_STATUS = { pending: 'confirmed', confirmed: 'preparing', preparing: 'in_transit', in_transit: 'delivered' }

export function advanceOrder(id) {
  const book = read()
  const order = book.orders.find(row => row.id === id)
  if (!order) return { ok: false, error: 'DEMO order was not found' }
  const next = NEXT_STATUS[order.status]
  if (!next) return { ok: false, error: 'DEMO order is already delivered' }
  if (order.status === 'pending') {
    order.lines = order.lines.map(line => ({ ...line, confirmed: line.confirmed ?? line.ordered }))
  }
  order.status = next
  if (next !== 'delivered' && order.stockApplied) return { ok: false, error: 'DEMO stock was already received' }
  if (next === 'delivered' && !order.stockApplied) {
    for (const line of order.lines) {
      const product = productById(book, line.drinkId)
      if (product) product.stock += line.confirmed ?? line.ordered
    }
    order.stockApplied = true
  }
  audit(book, 'supplier-status', `${id} ${next}`)
  write(book)
  return { ok: true, order }
}

export function periodReport({ from, to, barId = DEMO_BAR_ID } = {}) {
  const book = read()
  const start = from || book.night
  const end = to || book.night
  const rows = book.sales.filter(sale => (sale.barId || DEMO_BAR_ID) === barId && sale.night >= start && sale.night <= end)
  if (!rows.length) {
    return { demo: true, barId, from: start, to: end, sales: null, cogs: null, gross: null, cmv: null, reason: 'No DEMO sales in this range.' }
  }
  const sales = sumSales(rows)
  const cogs = sumCogs(rows)
  const nights = []
  let cursor = start
  while (cursor <= end && nights.length < 31) {
    nights.push({ label: cursor.slice(5), value: sumSales(rows, sale => sale.night === cursor) })
    cursor = addDays(cursor, 1)
  }
  return { demo: true, barId, from: start, to: end, sales, cogs, gross: sales - cogs, cmv: sales ? cogs / sales : null, orders: rows.length, trend: nights, reason: '' }
}

export function approveDemoAction(action) {
  const book = read()
  audit(book, 'review-approved', action)
  if (action !== 'create-purchase') {
    write(book)
    return { ok: false, status: 'draft', executed: false, verified: false, error: 'This DEMO review cannot be executed.' }
  }
  const open = book.orders.find(order => !['delivered', 'rejected'].includes(order.status))
  if (open) {
    audit(book, 'review-verified', `${open.id} already open`)
    write(book)
    return { ok: true, status: 'verified', executed: false, verified: true, orderId: open.id, reason: 'An open DEMO request already exists. Nothing new was created.' }
  }
  const lines = book.products.filter(row => row.stock < row.min).map(row => ({
    drinkId: row.id,
    nome: row.nome,
    ordered: Math.max(row.min - row.stock, 1),
    confirmed: null,
  }))
  if (!lines.length) {
    write(book)
    return { ok: false, status: 'approved', executed: false, verified: false, error: 'Nothing is below the DEMO reorder point.' }
  }
  const order = {
    id: `PO-${1043 + book.orders.length}`,
    supplier: '東京酒販デモ',
    status: 'pending',
    stockApplied: false,
    demo: true,
    lines,
  }
  book.orders.unshift(order)
  audit(book, 'review-executed', order.id)
  const found = book.orders.find(row => row.id === order.id)
  audit(book, 'review-verified', found ? found.id : 'missing')
  write(book)
  return { ok: true, status: found ? 'verified' : 'executed', executed: true, verified: Boolean(found), orderId: order.id, reason: 'DEMO purchase request created in this browser. Nothing was sent to a supplier.' }
}

function audit(book, action, detail) {
  book.audit = book.audit || []
  book.audit.unshift({ id: `audit-${book.audit.length + 1}`, action, detail, at: new Date().toISOString(), demo: true })
}

export function punch(tipo, at = new Date().toISOString(), staffId = 'demo-sato') {
  const book = read()
  const allowed = ['in', 'out', 'break_start', 'break_end']
  if (!allowed.includes(tipo)) return { ok: false, error: 'Choose clock in, break, or clock out' }
  const open = shiftOpen(book.punches, staffId)
  const onBreak = lastPunch(book.punches, staffId)?.tipo === 'break_start'
  if (tipo === 'in' && open) return { ok: false, error: 'DEMO shift is already open' }
  if (tipo === 'out' && !open) return { ok: false, error: 'Clock in before clocking out' }
  if (tipo === 'out' && onBreak) return { ok: false, error: 'End the break before clocking out' }
  if (tipo === 'break_start' && (!open || onBreak)) return { ok: false, error: 'Start a break only during an open shift' }
  if (tipo === 'break_end' && !onBreak) return { ok: false, error: 'There is no open break' }
  book.punches.push({ id: `demo-punch-${book.punches.length + 1}`, staffId, tipo, at, demo: true })
  audit(book, 'clock', `${staffId} ${tipo}`)
  write(book)
  return { ok: true }
}

export function submitRequest({ kind = 'leave', note = '', date = '' } = {}) {
  const book = read()
  if (!['leave', 'shift'].includes(kind)) return { ok: false, error: 'Choose leave or a shift change' }
  if (!String(note).trim()) return { ok: false, error: 'Add a short note' }
  const request = { id: `req-${(book.requests || []).length + 1}`, kind, note: String(note).trim(), date, status: 'pending', demo: true }
  book.requests = book.requests || []
  book.requests.unshift(request)
  audit(book, 'request', `${kind} pending`)
  write(book)
  return { ok: true, request }
}

export function rejectOrder(id, reason = 'DEMO supplier declined') {
  const book = read()
  const order = book.orders.find(row => row.id === id)
  if (!order) return { ok: false, error: 'DEMO order was not found' }
  if (order.status !== 'pending') return { ok: false, error: 'Only a pending DEMO order can be rejected' }
  order.status = 'rejected'
  order.rejectReason = reason
  audit(book, 'supplier-reject', `${id} ${reason}`)
  write(book)
  return { ok: true, order }
}

export function composeDemoAnswer(question) {
  const snap = snapshot()
  const q = String(question || '').toLowerCase()
  const fictional = 'DEMO. Fictional Atomic Bar ledger. These figures are not live business results.'
  const sources = ['DEMO ledger', 'Fictional Atomic Bar', 'Not a live result']
  const followups = [
    'How much did we sell today?',
    'Which drinks generated the most gross profit?',
    'What should we reorder?',
    'How much did labor cost this month?',
  ]
  if (/variance|cash clos|register/.test(q)) {
    const close = snap.cash.lastClose
    return {
      text: close
        ? `${fictional} The DEMO register closed with counted ${yen(close.counted)} against expected ${yen(close.expected)}. Variance is ${yen(close.variance)}.`
        : `${fictional} The DEMO register is still open, so there is no close variance yet. Expected cash is ${yen(snap.cash.expected)}.`,
      detail: 'Variance is counted cash minus expected cash. Expected cash is the float plus cash in minus cash out.',
      kpis: [
        { label: 'Expected', value: yen(snap.cash.expected), note: 'DEMO' },
        { label: 'Variance', value: close ? yen(close.variance) : '—', note: close ? 'DEMO close' : 'Not closed' },
      ],
      chart: null,
      bars: null,
      comparison: null,
      table: { columns: ['Movement', 'Amount'], rows: snap.cash.movements.map(row => [row.note, yen(row.direction === 'out' ? -row.amount : row.amount)]) },
      evidence: [{ label: 'Expected cash', formula: 'Opening float + cash in − cash out' }],
      followups,
      sources: [...sources, `Period ${snap.today ? 'today' : 'DEMO'}`],
      illustrative: true,
      live: false,
    }
  }
  if (/compare|last month|versus last|vs last/.test(q)) {
    const month = snap.month
    const previousKey = previousMonthKey(read().night)
    const previous = monthTotals(previousKey)
    return {
      text: `${fictional} DEMO sales this month are ${yen(month.sales)}. DEMO sales in ${previousKey} are ${yen(previous.sales)}.`,
      detail: 'Both figures are summed from the same fictional sales records. They are not live books.',
      kpis: [
        { label: 'This month', value: yen(month.sales), note: 'DEMO' },
        { label: previousKey, value: yen(previous.sales), note: 'DEMO' },
      ],
      chart: null,
      bars: { title: 'DEMO month comparison', points: [{ label: 'This month', value: month.sales }, { label: previousKey, value: previous.sales }] },
      comparison: null,
      table: null,
      evidence: [{ label: 'Source', formula: 'Sum of DEMO sale totals whose night falls in the month' }],
      followups,
      sources,
      illustrative: true,
      live: false,
    }
  }
  if (/lowest margin|low margin/.test(q)) {
    const ranked = [...snap.products].map(row => ({ ...row, margin: row.price ? (row.price - row.cost) / row.price : 0 })).sort((a, b) => a.margin - b.margin)
    const worst = ranked[0]
    return {
      text: `${fictional} The lowest menu margin is ${worst?.nome || '—'} at ${worst ? `${(worst.margin * 100).toFixed(1)}%` : '—'}.`,
      detail: 'Margin is (menu price − cost) ÷ menu price on the DEMO drink list.',
      kpis: ranked.slice(0, 3).map(row => ({ label: row.nome, value: `${(row.margin * 100).toFixed(1)}%`, note: 'DEMO margin' })),
      chart: null,
      bars: { title: 'DEMO margin by drink', points: ranked.map(row => ({ label: row.nome, value: Math.round(row.margin * 1000) })) },
      comparison: null,
      table: { columns: ['Drink', 'Price', 'Cost', 'Margin'], rows: ranked.map(row => [row.nome, yen(row.price), yen(row.cost), `${(row.margin * 100).toFixed(1)}%`]) },
      evidence: [{ label: 'Margin', formula: '(price − cost) ÷ price' }],
      followups,
      sources,
      illustrative: true,
      live: false,
    }
  }
  if (/reorder|purchase|stock|low|restock|replenish/.test(q)) {
    const rows = snap.products.filter(row => row.stock < row.min)
    return {
      text: `${fictional} A purchase order was not created. ${rows.length} drinks are below the reorder point in the DEMO stock book.`,
      detail: 'The reply only reads the local DEMO ledger. It does not send a supplier order.',
      kpis: rows.slice(0, 4).map(row => ({ label: row.nome, value: `${row.stock}`, note: `DEMO · reorder at ${row.min}` })),
      chart: null,
      bars: { title: 'DEMO stock versus reorder point', points: snap.products.map(row => ({ label: row.nome, value: row.stock, marker: row.min })) },
      comparison: null,
      table: { columns: ['Drink', 'On hand', 'Reorder at'], rows: rows.map(row => [row.nome, String(row.stock), String(row.min)]) },
      evidence: [{ label: 'Rule', formula: 'Low when on-hand is below the DEMO reorder point' }],
      followups,
      sources,
      illustrative: true,
      live: false,
      review: { action: 'create-purchase', status: 'draft', title: 'Purchase request', note: 'Approve to create the DEMO request in this browser. It is not sent.' },
    }
  }
  if (/labor|payroll|hours|shift|staff/.test(q)) {
    return {
      text: `${fictional} Labor this month is ${yen(snap.month.labor)}, including simulated punches in this browser.`,
      detail: 'Month hours were seeded. Clock actions add only the hours punched in this DEMO session.',
      kpis: snap.staff.map(person => ({ label: person.name, value: yen(person.earnings), note: `DEMO · ${person.hours.toFixed(1)}h` })),
      chart: null,
      bars: { title: 'DEMO labor cost', points: snap.staff.map(person => ({ label: person.name, value: person.earnings })) },
      comparison: null,
      table: { columns: ['Name', 'Hours', 'Rate', 'Earnings'], rows: snap.staff.map(person => [person.name, person.hours.toFixed(1), yen(person.rate), yen(person.earnings)]) },
      evidence: [{ label: 'Earnings', formula: '(seeded month hours + DEMO session hours) × hourly rate' }],
      followups,
      sources,
      illustrative: true,
      live: false,
    }
  }
  if (/profit|margin|drink|product/.test(q)) {
    return {
      text: `${fictional} Highest gross profit in the DEMO book is ${snap.ranking[0]?.nome || '—'} at ${yen(snap.ranking[0]?.gross || 0)}.`,
      detail: 'Gross profit is menu sales minus the drink cost. It does not subtract labor.',
      kpis: snap.ranking.slice(0, 3).map(row => ({ label: row.nome, value: yen(row.gross), note: 'DEMO gross profit' })),
      chart: null,
      bars: { title: 'DEMO gross profit by drink', points: snap.ranking.map(row => ({ label: row.nome, value: row.gross })) },
      comparison: null,
      table: { columns: ['Drink', 'Sales', 'Cost', 'Gross profit'], rows: snap.ranking.map(row => [row.nome, yen(row.sales), yen(row.cogs), yen(row.gross)]) },
      evidence: [{ label: 'Gross profit', formula: 'Sum of (price − cost) × quantity on DEMO sales' }],
      followups,
      sources,
      illustrative: true,
      live: false,
    }
  }
  const cmv = snap.today.cmv == null ? '—' : `${(snap.today.cmv * 100).toFixed(1)}%`
  return {
    text: `${fictional} Today’s DEMO sales are ${yen(snap.today.sales)}. Estimated gross profit is ${yen(snap.today.gross)}. CMV is ${cmv}. Labor this month is ${yen(snap.month.labor)}.`,
    detail: 'Today includes seeded closed tickets plus any sale completed in this browser.',
    kpis: [
      { label: 'Sales today', value: yen(snap.today.sales), note: 'DEMO' },
      { label: 'Gross profit', value: yen(snap.today.gross), note: 'DEMO' },
      { label: 'CMV', value: cmv, note: 'DEMO' },
      { label: 'Labor this month', value: yen(snap.month.labor), note: 'DEMO' },
    ],
    chart: { title: 'DEMO sales trend', points: snap.trend.map(point => ({ label: point.label, value: point.value })) },
    bars: {
      title: 'DEMO revenue versus costs this month',
      points: [
        { label: 'Revenue', value: snap.month.sales },
        { label: 'CMV', value: snap.month.cogs },
        { label: 'Labor', value: snap.month.labor },
      ],
    },
    comparison: {
      title: 'DEMO payment mix',
      columns: ['Method', 'Amount'],
      rows: Object.entries(snap.payments).map(([method, amount]) => [method, yen(amount)]),
    },
    table: null,
    evidence: [
      { label: 'Gross profit', formula: `${yen(snap.today.sales)} sales − ${yen(snap.today.cogs)} drink cost` },
      { label: 'CMV', formula: `${yen(snap.today.cogs)} ÷ ${yen(snap.today.sales)}` },
    ],
    followups,
    sources,
    illustrative: true,
    live: false,
  }
}

export function subscribeLedger(listener) {
  if (typeof window === 'undefined') return () => {}
  const handler = () => listener(snapshot())
  window.addEventListener(LEDGER_EVENT, handler)
  return () => window.removeEventListener(LEDGER_EVENT, handler)
}

export { yen as formatDemoYen }
