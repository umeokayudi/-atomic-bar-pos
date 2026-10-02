import assert from 'node:assert/strict'
import { describeRuntime, assertMayWrite } from '../src/lib/stagingGate.js'
import { commit, createStore } from '../src/lib/operationalTransactions.js'
import { acceptStagingCommand } from '../src/lib/stagingOperations.js'
import { approveProposal, createProposal, executeProposal, groundNumbers } from '../src/lib/aiActionProposal.js'
import { PROTECTED_REFS } from '../src/lib/supabaseTarget.js'

const runtime = describeRuntime({})
assert.equal(runtime.operational, false)
assert.equal(runtime.writes, false)
assert.ok(runtime.blockers.some(item => /unidentified/i.test(item)))
assert.throws(() => assertMayWrite({}), /environment is unidentified|Operational writes are refused/)

const stagingRef = 'isolatedstagingproj'
const stagingJwt = `header.${Buffer.from(JSON.stringify({ ref: stagingRef, role: 'anon' })).toString('base64url')}.sig`.padEnd(80, 'x')
const stagingEnv = {
  VERCEL_ENV: 'preview',
  VITE_DEPLOY_CHANNEL: 'preview',
  VITE_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: stagingJwt,
  ATOMIC_STAGING_AUTHORIZED: '1',
}
const ready = describeRuntime(stagingEnv)
assert.equal(ready.runtime, 'STAGING')
assert.equal(ready.operational, true)
assert.throws(() => assertMayWrite(stagingEnv), err => err.code === 'STAGING_NOT_CONNECTED')

for (const ref of PROTECTED_REFS) {
  const blocked = describeRuntime({
    ...stagingEnv,
    VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
  })
  assert.equal(blocked.operational, false)
  assert.ok(blocked.blockers.some(item => /protected/i.test(item)))
}

const store = createStore({
  catalog: {
    highball: { price: 800, stock: { 'bar-a': 1, 'bar-b': 4 } },
    sour: { price: 700, stock: { 'bar-a': 2, 'bar-b': 2 } },
  },
  cash: {
    'bar-a': { status: 'open', float: 1000, in: 0, out: 0 },
    'bar-b': { status: 'open', float: 1000, in: 0, out: 0 },
  },
})

const foreign = commit(store, {
  type: 'pos-sale',
  role: 'gerente',
  actorBarId: 'bar-b',
  barId: 'bar-a',
  idempotencyKey: 'cross',
  lines: [{ sku: 'highball', qty: 1 }],
  method: 'card',
})
assert.equal(foreign.ok, false)
assert.equal(foreign.code, 'ISOLATION')
assert.equal(store.catalog.highball.stock['bar-a'], 1)

const cashierDiscount = commit(store, {
  type: 'discount',
  role: 'caixa',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'discount-caixa',
  rate: 0.1,
})
assert.equal(cashierDiscount.code, 'UNAUTHORIZED')

const sale = commit(store, {
  type: 'pos-sale',
  role: 'gerente',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'sale-1',
  lines: [{ sku: 'highball', qty: 1 }],
  method: 'card',
  clientTotal: 800,
})
assert.equal(sale.ok, true)
assert.equal(sale.sale.total, 800)
assert.equal(store.catalog.highball.stock['bar-a'], 0)
const replay = commit(store, {
  type: 'pos-sale',
  role: 'gerente',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'sale-1',
  lines: [{ sku: 'highball', qty: 1 }],
  method: 'card',
})
assert.equal(replay.replayed, true)
assert.equal(store.catalog.highball.stock['bar-a'], 0)

const second = commit(store, {
  type: 'pos-sale',
  role: 'gerente',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'sale-2',
  lines: [{ sku: 'highball', qty: 1 }],
  method: 'card',
})
assert.equal(second.code, 'STOCK')

const mismatch = commit(store, {
  type: 'pos-sale',
  role: 'gerente',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'sale-bad-total',
  lines: [{ sku: 'sour', qty: 1 }],
  method: 'card',
  clientTotal: 1,
})
assert.equal(mismatch.code, 'TOTAL')
assert.equal(store.catalog.sour.stock['bar-a'], 2)

const sourSale = commit(store, {
  type: 'pos-sale',
  role: 'caixa',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'sale-sour',
  lines: [{ sku: 'sour', qty: 1 }],
  method: 'other',
})
const pay = commit(store, {
  type: 'cash-payment',
  role: 'caixa',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'pay-1',
  saleId: sourSale.sale.id,
})
assert.equal(pay.ok, true)
assert.equal(store.cash['bar-a'].in, 700)
const payAgain = commit(store, {
  type: 'cash-payment',
  role: 'caixa',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'pay-2',
  saleId: sourSale.sale.id,
})
assert.equal(payAgain.code, 'DUPLICATE_PAYMENT')
assert.equal(store.cash['bar-a'].in, 700)

const closed = commit(store, {
  type: 'cash-close',
  role: 'gerente',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'close-1',
  counted: 1600,
})
assert.equal(closed.expected, 1700)
assert.equal(closed.variance, -100)

const clock = commit(store, {
  type: 'clock',
  role: 'funcionario',
  actorId: 'sato',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'in-1',
  tipo: 'in',
})
assert.equal(clock.ok, true)
const clockAgain = commit(store, {
  type: 'clock',
  role: 'funcionario',
  actorId: 'sato',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'in-2',
  tipo: 'in',
})
assert.equal(clockAgain.code, 'DUPLICATE_CLOCK')

const request = commit(store, {
  type: 'purchase-request',
  role: 'gerente',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'po-1',
  lines: [{ sku: 'sour', qty: 2 }],
})
let status = 'pending'
for (const next of ['confirmed', 'preparing', 'in_transit', 'delivered']) {
  const step = commit(store, {
    type: 'supplier-status',
    role: 'fornecedor',
    actorBarId: 'bar-a',
    barId: 'bar-a',
    idempotencyKey: `step-${next}`,
    orderId: request.order.id,
    status: next,
  })
  assert.equal(step.status, next)
  status = next
}
assert.equal(status, 'delivered')
const before = store.catalog.sour.stock['bar-a']
const receipt = commit(store, {
  type: 'stock-receipt',
  role: 'fornecedor',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'receipt-1',
  orderId: request.order.id,
})
assert.equal(receipt.executed, true)
assert.equal(store.catalog.sour.stock['bar-a'], before + 2)
const receiptAgain = commit(store, {
  type: 'stock-receipt',
  role: 'fornecedor',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'receipt-2',
  orderId: request.order.id,
})
assert.equal(receiptAgain.executed, false)
assert.equal(store.catalog.sour.stock['bar-a'], before + 2)

const early = commit(createStore({
  catalog: { sour: { price: 700, stock: { 'bar-a': 1 } } },
  orders: [{ id: 'po-early', barId: 'bar-a', status: 'preparing', lines: [{ sku: 'sour', qty: 1 }] }],
}), {
  type: 'stock-receipt',
  role: 'gerente',
  actorBarId: 'bar-a',
  barId: 'bar-a',
  idempotencyKey: 'early',
  orderId: 'po-early',
})
assert.equal(early.code, 'STATUS')

const grounded = groundNumbers('Sales are 3550 and CMV is 26.5.', [3550, 26.5])
assert.equal(grounded.grounded, true)
const invented = groundNumbers('Sales are 999999.', [3550])
assert.equal(invented.grounded, false)

const proposal = createProposal({
  action: 'create-purchase',
  sources: ['DEMO ledger'],
  rationale: 'Sour on hand is 4.',
  impact: 'No order is created yet.',
  figures: [4],
  risk: 'low',
})
assert.equal(proposal.approval, 'draft')
assert.equal(proposal.executed, false)
const approved = approveProposal(proposal)
assert.equal(approved.approval, 'approved')
assert.equal(approved.executed, false)
const executed = executeProposal(approved, runtime)
assert.equal(executed.executed, false)
assert.equal(executed.verification, 'staging_required')
const inventedProposal = createProposal({
  action: 'create-purchase',
  sources: ['DEMO ledger'],
  rationale: 'Order 999 units.',
  figures: [4],
})
assert.equal(inventedProposal.ok, false)

const opStore = createStore({
  catalog: { highball: { price: 800, stock: { 'bar-a': 3, 'bar-b': 3 } } },
  cash: { 'bar-a': { status: 'open', float: 0, in: 0, out: 0 } },
})
const demoCall = acceptStagingCommand({
  type: 'pos-sale',
  role: 'admin',
  barId: 'bar-b',
  clientTotal: 1,
  idempotencyKey: 'demo-key',
  lines: [{ sku: 'highball', qty: 1 }],
  method: 'card',
}, { runtime: { runtime: 'LOCAL_DEMO' } }, opStore)
assert.equal(demoCall.status, 503)
assert.equal(opStore.catalog.highball.stock['bar-a'], 3)

const stagingCtx = {
  runtime: { runtime: 'STAGING' },
  user: { id: 'user-1' },
  perfil: { role: 'gerente', bar_id: 'bar-a' },
}
const forged = acceptStagingCommand({
  type: 'pos-sale',
  role: 'admin',
  barId: 'bar-b',
  clientTotal: 1,
  idempotencyKey: 'forged',
  lines: [{ sku: 'highball', qty: 1 }],
  method: 'card',
}, stagingCtx, opStore)
assert.equal(forged.status, 403)
assert.equal(opStore.catalog.highball.stock['bar-a'], 3)

const sold = acceptStagingCommand({
  type: 'pos-sale',
  idempotencyKey: 'sale-ok',
  lines: [{ sku: 'highball', qty: 1 }],
  method: 'card',
  clientTotal: 1,
}, stagingCtx, opStore)
assert.equal(sold.status, 200)
assert.equal(sold.body.sale.total, 800)
assert.equal(sold.body.sale.barId, 'bar-a')
assert.equal(opStore.catalog.highball.stock['bar-a'], 2)

const unconnected = acceptStagingCommand({ type: 'clock', idempotencyKey: 'c' }, stagingCtx)
assert.equal(unconnected.status, 503)
assert.equal(unconnected.body.code, 'STAGING_NOT_CONNECTED')

console.log('readiness tests passed')
