import assert from 'node:assert/strict'
import {
  ANNEX_BAR_ID,
  DEMO_BAR_ID,
  advanceOrder,
  applyDiscount,
  approveDemoAction,
  closeRegister,
  closeTicket,
  composeDemoAnswer,
  confirmOrder,
  createPurchaseRequest,
  loadTicket,
  periodReport,
  punch,
  recordMovement,
  rejectOrder,
  resetLedger,
  sellDrink,
  snapshot,
} from '../src/lib/demoLedger.js'
import { demoTurn } from '../src/lib/aiAssistant.js'

resetLedger()
const before = snapshot()
assert.equal(before.demo, true)
assert.equal(before.venue, 'Atomic Bar')
assert.equal(before.today.sales, 3550)
assert.equal(before.today.cogs, 940)
assert.equal(before.today.gross, 2610)
assert.equal(before.cash.expected, 51600)
assert.equal(before.month.labor, 163200)
assert.equal(before.products.find(row => row.id === 'demo-beer').stock, 28)
assert.equal(before.products.filter(row => row.stock < row.min).length, 2)

const sale = sellDrink({ drinkId: 'demo-beer', qty: 1, method: 'cash' })
assert.equal(sale.ok, true)
assert.match(sale.receipt.id, /^DEMO-R-/)
assert.match(sale.receipt.note, /No live charge/)
const after = snapshot()
assert.equal(after.products.find(row => row.id === 'demo-beer').stock, 27)
assert.equal(after.today.sales, 4250)
assert.equal(after.cash.expected, 52300)

const card = sellDrink({ drinkId: 'demo-highball', qty: 1, method: 'card' })
assert.equal(card.ok, true)
assert.equal(snapshot().cash.expected, 52300)
assert.equal(snapshot().products.find(row => row.id === 'demo-highball').stock, 39)

const moved = recordMovement({ direction: 'out', amount: 300, note: 'DEMO paid-in change' })
assert.equal(moved.ok, true)
assert.equal(snapshot().cash.expected, 52000)
const closed = closeRegister(51800)
assert.equal(closed.ok, true)
assert.equal(closed.close.variance, -200)
assert.equal(snapshot().cash.status, 'closed')
const blockedCash = sellDrink({ drinkId: 'demo-beer', qty: 1, method: 'cash' })
assert.equal(blockedCash.ok, false)

const request = createPurchaseRequest()
assert.equal(request.ok, true)
assert.equal(request.created, false)
assert.equal(request.order.id, 'PO-1042')
const confirmed = confirmOrder('PO-1042', { 'demo-sour': 12, 'demo-wine': 6 })
assert.equal(confirmed.order.status, 'confirmed')
const preparingStock = snapshot().products.find(row => row.id === 'demo-sour').stock
assert.equal(advanceOrder('PO-1042').order.status, 'preparing')
assert.equal(snapshot().products.find(row => row.id === 'demo-sour').stock, preparingStock)
assert.equal(advanceOrder('PO-1042').order.status, 'in_transit')
assert.equal(snapshot().products.find(row => row.id === 'demo-sour').stock, preparingStock)
const delivered = advanceOrder('PO-1042')
assert.equal(delivered.order.status, 'delivered')
assert.equal(rejectOrder('PO-1042').ok, false)
assert.equal(snapshot().products.find(row => row.id === 'demo-sour').stock, 16)
assert.equal(snapshot().products.find(row => row.id === 'demo-wine').stock, 9)

assert.equal(punch('in', '2026-10-02T09:00:00.000Z').ok, true)
assert.equal(punch('out', '2026-10-02T13:00:00.000Z').ok, true)
const sato = snapshot(Date.parse('2026-10-02T13:00:00.000Z')).staff[0]
assert.ok(Math.abs(sato.sessionHours - 4) < 0.02)
assert.equal(sato.earnings, Math.round((64 + 4) * 1500))

const answer = composeDemoAnswer('How much did we sell today?')
assert.match(answer.text, /DEMO/)
assert.match(answer.text, /¥5,050/)
assert.equal(answer.live, false)
assert.equal(answer.chart.points.at(-1).value, 5050)

const reorder = demoTurn('What should we reorder?')
assert.equal(reorder.live, false)
assert.equal(reorder.fromModel, false)
assert.match(reorder.text, /was not created/)
assert.equal(/PO-|was created/.test(reorder.text), false)
assert.equal(reorder.draft.status, 'not_created')

assert.equal(periodReport({ from: snapshot().night, to: snapshot().night, barId: DEMO_BAR_ID }).sales, snapshot().today.sales)
assert.equal(periodReport({ from: snapshot().night, to: snapshot().night, barId: ANNEX_BAR_ID }).sales, 1400)
assert.notEqual(periodReport({ from: snapshot().night, to: snapshot().night, barId: ANNEX_BAR_ID }).sales, snapshot().today.sales)
const opened = loadTicket({ p_space: 'demo-space-empty' })
const emptyClose = closeTicket({ p_ticket: opened.data.id })
assert.match(emptyClose.error.message, /empty/)

const denied = applyDiscount({ p_ticket: 'none', p_rate: 0.1, p_role: 'caixa' })
assert.match(denied.error.message, /manager/)

resetLedger()
assert.equal(punch('in', '2026-10-02T09:00:00.000Z', 'demo-tanaka').ok, true)
assert.equal(punch('break_start', '2026-10-02T10:00:00.000Z', 'demo-tanaka').ok, true)
assert.equal(punch('break_end', '2026-10-02T10:30:00.000Z', 'demo-tanaka').ok, true)
assert.equal(punch('out', '2026-10-02T13:00:00.000Z', 'demo-tanaka').ok, true)
const tanaka = snapshot(Date.parse('2026-10-02T13:00:00.000Z')).staff.find(row => row.id === 'demo-tanaka')
assert.ok(Math.abs(tanaka.sessionHours - 3.5) < 0.02)

resetLedger()
const pending = snapshot().orders.filter(row => !['delivered', 'rejected'].includes(row.status)).length
const approved = approveDemoAction('create-purchase')
assert.equal(approved.executed, false)
assert.equal(approved.verified, true)
assert.equal(snapshot().orders.filter(row => !['delivered', 'rejected'].includes(row.status)).length, pending)
const question = composeDemoAnswer('Prepare a purchase request for low stock.')
assert.match(question.text, /was not created/)
assert.equal(question.review.status, 'draft')

console.log('demo ledger tests passed')
