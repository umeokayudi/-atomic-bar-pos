/**
 * Central de Conciliação (Missão Máxima 4.5): finds what does not add up in the money records and shows it
 * side by side. It NEVER changes a value, never confirms a receipt, never removes a duplicate. Each item
 * waits for a decision the owner writes down ("decisão do dono"), kept in the activity log.
 * Pure functions (tested in scripts/tests/conciliacao.test.mjs).
 */
import { invoiceMoney, invoicePeriod, invoiceTotal } from './money.js'
import { duplicateReceipts } from './receipts.js'

const day = v => String(v || '').slice(0, 10)
const isPaymentReceipt = r => {
  const it = Array.isArray(r?.itens) ? r.itens[0] : null
  return !!(r?.pagamento_ref || it?.ref || /^pagamento|^payment|入金/i.test(String(it?.nome || it?.descricao || '')))
}
const TEST_NAME = /(^|[\s_-])(teste?|test|dummy|sample|sandbox)([\s_-]|$)/i

/**
 * @returns {Array<{key,kind,barId,left:{label,valor,ref,data},right:{label,valor,ref,data}|null,diff:number}>}
 * kinds: receipt_invoice (receipt total ≠ invoice total for the same bar and period), receipt_duplicate,
 *        paid_no_row (invoice shows "paid" with no payment row), pending_credit (payment not confirmed),
 *        test_item (test product still active).
 */
export function findMoneyIssues({ faturas = [], pagamentos = [], ryoshusho = [], produtos = [] } = {}) {
  const issues = []

  // 1. Receipt × invoice for the same bar and period.
  for (const r of ryoshusho || []) {
    if (isPaymentReceipt(r)) continue
    const rs = day(r.periodo_inicio), re = day(r.periodo_fim || r.periodo_inicio)
    if (!rs) continue
    const same = (faturas || []).filter(f => {
      if (f.bar_id !== r.bar_id) return false
      const p = invoicePeriod(f)
      return p.start.slice(0, 7) <= re.slice(0, 7) && rs.slice(0, 7) <= p.end.slice(0, 7)
    })
    if (!same.length) continue
    const invTotal = same.reduce((a, f) => a + invoiceTotal(f), 0)
    const diff = Math.round((+r.total || 0) - invTotal)
    if (Math.abs(diff) < 1) continue
    issues.push({
      key: `receipt_invoice:${r.id}`, kind: 'receipt_invoice', barId: r.bar_id, diff,
      left: { label: 'receipt', ref: r.numero, valor: +r.total || 0, data: day(r.data_emissao) },
      right: { label: 'invoice', ref: same.map(f => String(f.id).slice(0, 8)).join(', '), valor: invTotal, data: day(same[0].data_emissao) },
    })
  }

  // 2. Receipts issued twice for one payment.
  const dup = duplicateReceipts(ryoshusho || [])
  for (const r of ryoshusho || []) {
    const first = dup.get(r.id)
    if (!first) continue
    issues.push({
      key: `receipt_duplicate:${r.id}`, kind: 'receipt_duplicate', barId: r.bar_id, diff: +r.total || 0,
      left: { label: 'receipt', ref: first.numero, valor: +first.total || 0, data: day(first.data_emissao) },
      right: { label: 'receipt', ref: r.numero, valor: +r.total || 0, data: day(r.data_emissao) },
    })
  }

  // 3 and 4. Per invoice: "paid" with no payment row, and credits waiting for confirmation.
  for (const f of faturas || []) {
    const m = invoiceMoney(f, pagamentos)
    const noRow = Math.round(m.unrecorded + m.directUnrecorded)
    if (noRow > 0) {
      issues.push({
        key: `paid_no_row:${f.id}`, kind: 'paid_no_row', barId: f.bar_id, diff: noRow,
        left: { label: 'invoice_paid', ref: String(f.id).slice(0, 8), valor: +f.pago || 0, data: day(f.data_emissao) },
        right: { label: 'confirmed_rows', ref: '', valor: Math.round((+f.pago || 0) - noRow), data: '' },
      })
    }
    for (const p of (pagamentos || []).filter(p => p.fatura_id === f.id && !p.confirmado)) {
      issues.push({
        key: `pending_credit:${p.id}`, kind: 'pending_credit', barId: f.bar_id, diff: +p.valor || 0,
        left: { label: 'payment', ref: p.metodo || '', valor: +p.valor || 0, data: day(p.data), nota: p.notas || '' },
        right: { label: 'invoice', ref: String(f.id).slice(0, 8), valor: invoiceTotal(f), data: day(f.data_emissao) },
      })
    }
  }

  // 5. Test products still active (they stay; they are only kept out of lists, totals and reports).
  for (const p of produtos || []) {
    if (p.ativo === false || !TEST_NAME.test(String(p.nome || ''))) continue
    issues.push({
      key: `test_item:${p.id}`, kind: 'test_item', barId: null, diff: 0,
      left: { label: 'product', ref: p.nome, valor: +p.custo || 0, data: '' }, right: null,
    })
  }
  return issues
}

/** Latest written decision per issue key, from the activity log rows (tabela = 'conciliacao'). */
export function decisionsByKey(auditRows = []) {
  const out = new Map()
  const rows = [...(auditRows || [])].filter(r => r.tabela === 'conciliacao')
    .sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')))
  for (const r of rows) out.set(String(r.registro_id), r)
  return out
}
