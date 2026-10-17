import assert from 'node:assert/strict'
import {
  normalizeAction,
  parseAgentJson,
  pick,
  scopeForRole,
  executeAction,
  agentSystemPrompt,
} from '../api/_aiActions.js'

const BAR_A = '11111111-1111-4111-8111-111111111111'
const BAR_B = '22222222-2222-4222-8222-222222222222'
const JAMESON = 'aaaaaaaa-0000-4000-8000-000000000001'
const JIM = 'aaaaaaaa-0000-4000-8000-000000000002'
const FAT_A = 'fa000001-0000-4000-8000-000000000000'
const FAT_B = 'fb000001-0000-4000-8000-000000000000'
const PED = 'cc000001-0000-4000-8000-000000000000'

function ctx(scope, extra = {}) {
  return {
    scope,
    barId: scope === 'bar' ? BAR_A : null,
    userId: 'user-1',
    today: '2026-10-10',
    bars: scope === 'bar'
      ? [{ id: BAR_A, nome: 'Atomic' }]
      : [{ id: BAR_A, nome: 'Atomic' }, { id: BAR_B, nome: 'Blue Bar' }],
    produtos: [
      { id: JAMESON, nome: 'Jameson 700ml', preco_venda: 2500 },
      { id: JIM, nome: 'Jim Beam 700ml', preco_venda: 1800 },
    ],
    fornecedores: [{ id: 'f1', nome: 'Kakuyasu', pagamento: 'Transfer' }],
    faturas: scope === 'bar'
      ? [{ id: FAT_A, bar_id: BAR_A, bar_nome: 'Atomic', total: 10000, pago: 4000, status: 'parcial' }]
      : [
        { id: FAT_A, bar_id: BAR_A, bar_nome: 'Atomic', total: 10000, pago: 4000, status: 'parcial' },
        { id: FAT_B, bar_id: BAR_B, bar_nome: 'Blue Bar', valor: 5000, pago: 0, status: 'pendente' },
      ],
    pedidos: [{ id: PED, bar_id: BAR_A, bar_nome: 'Atomic', status: 'pendente', total_estimado: 9000, criado_por: 'u2' }],
    compras: [{ id: 'dd000001-0000-4000-8000-000000000000', fornecedor: 'Kakuyasu', data: '2026-10-01', total_real: 30000, status_pagamento: 'pendente' }],
    ...extra,
  }
}

// Who can use actions
assert.equal(scopeForRole({ role: 'admin' }), 'hq')
assert.equal(scopeForRole({ role: 'cliente', bar_id: BAR_A }), 'bar')
assert.equal(scopeForRole({ role: 'gerente', bar_id: BAR_A }), 'bar')
assert.equal(scopeForRole({ role: 'cliente' }), null, 'bar account without bar')
assert.equal(scopeForRole({ role: 'caixa', bar_id: BAR_A }), null, 'till cannot')
assert.equal(scopeForRole({ role: 'bar_staff', bar_id: BAR_A }), null, 'staff cannot')
assert.equal(scopeForRole({ role: 'funcionario' }), null)
assert.equal(scopeForRole(null), null)

// Name matching
assert.equal(pick(ctx('hq').produtos, 'jameson', { label: 'P' }).row.id, JAMESON)
assert.match(pick(ctx('hq').produtos, '700ml', { label: 'P' }).error, /ambiguous/)
assert.match(pick(ctx('hq').produtos, 'Hibiki', { label: 'P' }).error, /not found/)
assert.equal(pick(ctx('hq').faturas, 'fb000001', { label: 'F' }).row.id, FAT_B)

// Bar order: bar forced to own bar, even if the model names another one
let n = normalizeAction(ctx('bar'), { type: 'create_pedido', params: { bar: 'Blue Bar', itens: [{ produto: 'Jameson', qtd: 6 }] } })
assert.equal(n.ok, true)
assert.equal(n.params.bar_id, BAR_A)
assert.deepEqual(n.params.itens, [{ produto_id: JAMESON, qtd: 6 }])
assert.equal(n.write.total, 15000)

// Re-normalizing the confirmed params gives the same result (execute path)
const again = normalizeAction(ctx('bar'), { type: 'create_pedido', params: n.params })
assert.deepEqual(again.params, n.params)

// HQ order for a named bar
n = normalizeAction(ctx('hq'), { type: 'create_pedido', params: { bar: 'blue', itens: [{ produto: 'Jim Beam', qtd: 2 }] } })
assert.equal(n.params.bar_id, BAR_B)
assert.equal(normalizeAction(ctx('hq'), { type: 'create_pedido', params: { bar: 'Atomic', itens: [{ produto: 'Jim Beam', qtd: 0 }] } }).ok, false)
assert.equal(normalizeAction(ctx('hq'), { type: 'create_pedido', params: { bar: 'Atomic', itens: [] } }).ok, false)

// Bar accounts cannot use HQ-only actions
for (const type of ['set_pedido_status', 'create_compra', 'mark_compra_paid']) {
  const r = normalizeAction(ctx('bar'), { type, params: {} })
  assert.equal(r.ok, false, type)
  assert.match(r.error, /cannot/)
}
assert.equal(normalizeAction(ctx('hq'), { type: 'drop_table', params: {} }).ok, false)

// Bar cannot pay another bar's invoice (it is not in its context)
assert.equal(normalizeAction(ctx('bar'), { type: 'register_fatura_payment', params: { fatura_ref: FAT_B } }).ok, false)

// Invoice payment: default is what is left; over-payment is refused
n = normalizeAction(ctx('bar'), { type: 'register_fatura_payment', params: { fatura_ref: 'fa000001' } })
assert.equal(n.ok, true)
assert.equal(n.params.valor, 6000)
assert.equal(n.write.confirmed, false, 'bar payment waits for JBM')
assert.equal(normalizeAction(ctx('hq'), { type: 'register_fatura_payment', params: { fatura_ref: 'fa000001', valor: 7000 } }).ok, false)
assert.equal(normalizeAction(ctx('hq'), { type: 'register_fatura_payment', params: { fatura_ref: 'fa000001', valor: 1000 } }).write.confirmed, true)

// Order status: no delivery from the AI, no repeat confirmation
assert.equal(normalizeAction(ctx('hq'), { type: 'set_pedido_status', params: { pedido_ref: 'cc000001', status: 'entregue' } }).ok, false)
assert.equal(normalizeAction(ctx('hq'), { type: 'set_pedido_status', params: { pedido_ref: 'cc000001', status: 'confirmado' } }).ok, true)
const confirmed = ctx('hq', { pedidos: [{ id: PED, bar_nome: 'Atomic', status: 'confirmado' }] })
assert.equal(normalizeAction(confirmed, { type: 'set_pedido_status', params: { pedido_id: PED, status: 'confirmado' } }).ok, false)

// Purchase
n = normalizeAction(ctx('hq'), { type: 'create_compra', params: { fornecedor: 'kakuyasu', total: 12000, pago: true } })
assert.equal(n.ok, true)
assert.equal(n.params.fornecedor, 'Kakuyasu')
assert.equal(n.params.data, '2026-10-10')
assert.equal(n.params.pagamento, 'Transfer')
assert.equal(normalizeAction(ctx('hq'), { type: 'create_compra', params: { fornecedor: 'X', total: -5 } }).ok, false)
assert.equal(normalizeAction(ctx('hq'), { type: 'mark_compra_paid', params: { compra_ref: 'dd000001' } }).ok, true)

// Stock movement
n = normalizeAction(ctx('bar'), { type: 'stock_move', params: { produto: 'Jim Beam', qtd: 3, tipo: 'saida' } })
assert.equal(n.ok, true)
assert.equal(n.params.bar_id, BAR_A)
assert.equal(normalizeAction(ctx('bar'), { type: 'stock_move', params: { produto: 'Jim Beam', qtd: 3, tipo: 'delete' } }).ok, false)

// Model output parsing
assert.deepEqual(parseAgentJson('```json\n{"reply":"ok","actions":[{"type":"x"}]}\n```'), { reply: 'ok', actions: [{ type: 'x' }] })
assert.deepEqual(parseAgentJson('plain text'), { reply: 'plain text', actions: [] })

// Bar prompt only lists bar actions
const barPrompt = agentSystemPrompt(ctx('bar'))
assert.ok(barPrompt.includes('create_pedido'))
assert.ok(!barPrompt.includes('create_compra'))

// Execute: falls back to plain inserts when submit_bar_order is missing; stops on real RPC errors
function fakeDb(rpcError) {
  const calls = []
  const chain = (table) => {
    const q = {
      insert(row) { calls.push(['insert', table, row]); return q },
      update(row) { calls.push(['update', table, row]); return q },
      delete() { calls.push(['delete', table]); return q },
      select() { return q },
      eq() { return q },
      single() { return Promise.resolve({ data: { id: 'new-pedido' }, error: null }) },
      then(res, rej) { return Promise.resolve({ data: table === 'perfis' ? [{ id: 'admin1' }] : null, error: null }).then(res, rej) },
    }
    return q
  }
  return { calls, from: chain, rpc: async () => ({ data: null, error: rpcError }) }
}
const barCtx = ctx('bar')
const order = normalizeAction(barCtx, { type: 'create_pedido', params: { itens: [{ produto: 'Jameson', qtd: 2 }] } })
let db = fakeDb({ code: 'PGRST202', message: 'Could not find the function' })
const out = await executeAction(db, barCtx, order)
assert.equal(out.id, 'new-pedido')
assert.ok(db.calls.some(c => c[0] === 'insert' && c[1] === 'pedidos' && c[2].bar_id === BAR_A && c[2].status === 'pendente'))
assert.ok(db.calls.some(c => c[0] === 'insert' && c[1] === 'pedidos_itens'))
db = fakeDb({ code: 'P0001', message: 'sale price not configured' })
await assert.rejects(() => executeAction(db, barCtx, order), /sale price/)
assert.ok(!db.calls.some(c => c[1] === 'pedidos'))

console.log('aiActions tests passed')
