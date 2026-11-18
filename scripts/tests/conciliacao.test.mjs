import assert from 'node:assert/strict'
import { findMoneyIssues, decisionsByKey } from '../../src/lib/conciliacao.js'
import { moneyBuckets, invoiceMoney } from '../../src/lib/money.js'

// The numbers as they are in production on 2026-11-18. Nothing here is "fixed": the test only proves the
// screen shows them and that pending money is never counted as received.
const BAR = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'
const jun = { id: 'db9fb11a', bar_id: BAR, total: 465000, pago: 300000, status: 'parcial', data_emissao: '2026-06-30', periodo_inicio: '2026-06-01', periodo_fim: '2026-06-30' }
const jul = { id: '8a0f24ed', bar_id: BAR, total: 1757044, pago: 488350, status: 'parcial', data_emissao: '2026-07-31', periodo_inicio: '2026-07-01', periodo_fim: '2026-07-31' }
const pagamentos = [
  { id: '874b6319', fatura_id: '8a0f24ed', valor: 876910, metodo: 'Stripe', data: '2026-08-24', confirmado: false },
  { id: '9845c77f', fatura_id: 'db9fb11a', valor: 300000, metodo: 'Transfer', data: '2026-09-29', confirmado: true },
]
const ryoshusho = [
  { id: 'r4', numero: 'RY-202607-004', bar_id: BAR, data_emissao: '2026-07-10', periodo_inicio: '2026-06-01', periodo_fim: '2026-06-30', total: 2565926, itens: [{ nome: 'Jameson', qtd: 6 }], criado_em: '2026-07-10' },
  { id: 'r2', numero: 'RY-202610-002', bar_id: BAR, data_emissao: '2026-09-29', periodo_inicio: '2026-09-29', periodo_fim: '2026-09-29', total: 300000, itens: [{ nome: 'Pagamento — Transfer' }], criado_em: '2026-10-12' },
  { id: 'r3', numero: 'RY-202610-003', bar_id: BAR, data_emissao: '2026-09-29', periodo_inicio: '2026-09-29', periodo_fim: '2026-09-29', total: 300000, itens: [{ nome: 'Pagamento — Transfer' }], criado_em: '2026-10-25' },
]
const produtos = [{ id: 'p1', nome: 'TESTE-MUSE', ativo: true, custo: 100 }, { id: 'p2', nome: 'Jameson', ativo: true }]

const issues = findMoneyIssues({ faturas: [jun, jul], pagamentos, ryoshusho, produtos })
const of = k => issues.filter(i => i.kind === k)

// Receipt ¥2.565.926 × invoice ¥465.000: shown side by side, difference ¥2.100.926.
assert.equal(of('receipt_invoice').length, 1)
assert.equal(of('receipt_invoice')[0].left.valor, 2565926)
assert.equal(of('receipt_invoice')[0].right.valor, 465000)
assert.equal(of('receipt_invoice')[0].diff, 2100926)
// RY-202610-003 is flagged as a second receipt of RY-202610-002; neither is removed.
assert.equal(of('receipt_duplicate').length, 1)
assert.equal(of('receipt_duplicate')[0].left.ref, 'RY-202610-002')
assert.equal(of('receipt_duplicate')[0].right.ref, 'RY-202610-003')
// July "paid ¥488.350" has no payment row.
assert.equal(of('paid_no_row').length, 1)
assert.equal(of('paid_no_row')[0].diff, 488350)
// Stripe ¥876.910 waits for confirmation.
assert.equal(of('pending_credit').length, 1)
assert.equal(of('pending_credit')[0].diff, 876910)
assert.equal(of('test_item').length, 1)

// The four labels: pending is never received.
const b = moneyBuckets([jun, jul], pagamentos)
assert.equal(b.faturado, 465000 + 1757044)
assert.equal(b.recebido, 300000, 'only the confirmed transfer')
assert.equal(b.aReceber, 165000 + 1757044)
assert.equal(b.pendente, 876910 + 488350)
assert.equal(invoiceMoney(jul, pagamentos).received, 0)
// An amount "paid" with no row and no known direct credit is pending too, not received.
const other = { id: 'x', bar_id: 'other', total: 1000, pago: 400 }
assert.equal(invoiceMoney(other, []).received, 0)
assert.equal(invoiceMoney(other, []).pending, 400)

// Decisions: the newest text per item wins; the data itself is untouched.
const before = JSON.stringify({ jun, jul, pagamentos, ryoshusho })
const dec = decisionsByKey([
  { tabela: 'conciliacao', registro_id: 'paid_no_row:8a0f24ed', criado_em: '2026-11-19', depois: { decisao: 'A' } },
  { tabela: 'conciliacao', registro_id: 'paid_no_row:8a0f24ed', criado_em: '2026-11-20', depois: { decisao: 'B' } },
  { tabela: 'faturas', registro_id: 'x', criado_em: '2026-11-20' },
])
assert.equal(dec.size, 1)
assert.equal(dec.get('paid_no_row:8a0f24ed').depois.decisao, 'B')
assert.equal(JSON.stringify({ jun, jul, pagamentos, ryoshusho }), before)
console.log('conciliacao: ok')
