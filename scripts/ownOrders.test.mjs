import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { barNoteFromObs, orderDetailsFromObs, withBarNote } from '../src/lib/orderMeta.js'
import { buildOwnOrder, cleanOwnItems, ownOrderTotal, ownOrdersSummary } from '../src/lib/ownOrders.js'

// JBM's own notes (upstream supplier names) never show in the bar; the bar's own notes do.
assert.equal(barNoteFromObs('Costco jul/2026 — entrega bar Atomic'), '')
assert.equal(barNoteFromObs('Rebuild jul/2026 — Liquor Mountain'), '')
assert.equal(barNoteFromObs(null), '')
assert.equal(withBarNote('urgent\n\n deliver after 18h '), 'Bar: urgent\nBar: deliver after 18h')
assert.equal(withBarNote('   '), '')
assert.equal(barNoteFromObs(withBarNote('urgent\ndeliver after 18h')), 'urgent\ndeliver after 18h')
assert.equal(barNoteFromObs('Costco run\nBar: urgent\nCast: Aiko|1'), 'urgent')
assert.equal(barNoteFromObs(`${withBarNote('urgent')} · AI`), 'urgent · AI')
// HQ still sees everything
assert.equal(orderDetailsFromObs('Costco run\nBar: urgent'), 'Costco run\nBar: urgent')

// Own orders
assert.deepEqual(cleanOwnItems([{ nome: '  Lemons ', qtd: '3', preco: '100' }, { nome: '', qtd: 2 }, { nome: 'Ice', qtd: 0 }]), [{ nome: 'Lemons', qtd: 3, preco: 100 }])
assert.equal(ownOrderTotal([{ nome: 'A', qtd: 2, preco: 150 }, { nome: 'B', qtd: 1, preco: '' }]), 300)
assert.deepEqual(buildOwnOrder({ barId: 'b', fornecedor: ' ', items: [{ nome: 'A', qtd: 1 }] }), { error: 'supplier' })
assert.deepEqual(buildOwnOrder({ barId: 'b', fornecedor: 'Shop', items: [] }), { error: 'items' })
const built = buildOwnOrder({ barId: 'b', fornecedor: ' Shop  X ', data: '2026-10-25', items: [{ nome: 'A', qtd: 2, preco: 50 }], obs: ' hi ' })
assert.deepEqual(built.row, { bar_id: 'b', fornecedor: 'Shop X', itens: [{ nome: 'A', qtd: 2, preco: 50 }], total: 100, status: 'ordered', data: '2026-10-25', obs: 'hi' })
const sum = ownOrdersSummary([
  { data: '2026-10-01', total: 100, status: 'ordered' },
  { data: '2026-10-05', total: 50, status: 'received' },
  { data: '2026-10-06', total: 999, status: 'cancelled' },
  { data: '2026-09-30', total: 70, status: 'received' },
], '2026-10')
assert.equal(sum.list.length, 3)
assert.equal(sum.count, 2)
assert.equal(sum.total, 150)
assert.equal(sum.open, 1)

// Own orders never touch JBM tables and only the bar's own owner/manager can read them.
const ui = readFileSync(new URL('../src/components/OwnOrders.jsx', import.meta.url), 'utf8')
for (const table of ['pedidos', 'vendas', 'faturas', 'notificacoes']) assert.equal(ui.includes(`from('${table}')`), false, table)
const sql = readFileSync(new URL('../sql/bar_own_orders.sql', import.meta.url), 'utf8')
assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
assert.match(sql, /p\.role IN \('cliente', 'gerente'\)/)
assert.doesNotMatch(sql.split('-- Rollback:')[0].replace(/^--.*$/gm, ''), /'admin'|'jbm'/)

// The bar's supply page writes bar notes tagged and never prints raw pedidos.obs.
const tab = readFileSync(new URL('../src/components/BarOrdersTab.jsx', import.meta.url), 'utf8')
assert.match(tab, /p_obs: withBarNote\(obs\)/)
assert.equal(tab.includes('orderDetailsFromObs'), false)

console.log('ownOrders tests passed')
