/**
 * 領収書 (receipts) for invoice payments: one receipt per payment, numbers in sequence with no gaps or
 * repeats (RY-YYYYMM-NNN across all bars), each receipt names the invoice it settles, and the issuer data
 * comes from HQ → Company (live-store table jbm_company) instead of a placeholder.
 */
import { buildPaymentRyoshushoHtml, calcTaxFromZeikomi, printRyoshushoHtml } from './ryoshushoPrint.js'
import { invoicePeriod } from './money.js'

export const COMPANY_ROW_ID = 'jbm'
const PLACEHOLDER_REG = /^T1234567890123$/

export async function loadCompany(supabase) {
  try {
    const { data } = await supabase.from('jbm_company').select('*').eq('id', COMPANY_ROW_ID).maybeSingle()
    return data || null
  } catch {
    return null
  }
}

/** Issuer block for the receipt; missing fields stay empty (never the old placeholder number). */
export function companyEmitente(company) {
  const reg = String(company?.registro || '').trim()
  return {
    nome: String(company?.nome || '').trim() || 'JBM Drinks',
    endereco: String(company?.endereco || '').trim(),
    tel: String(company?.tel || '').trim(),
    registro: PLACEHOLDER_REG.test(reg) ? '' : reg,
  }
}

export function companyMissing(company) {
  const e = companyEmitente(company)
  return ['endereco', 'tel', 'registro'].filter(k => !e[k])
}

/** Stable key of what the receipt pays: one confirmed payment row, or an invoice's older balance. */
export function receiptRefOf(item) {
  return String(item?.key || '')
}

function refOfRow(r) {
  if (r?.pagamento_ref) return r.pagamento_ref
  const it = Array.isArray(r?.itens) ? r.itens[0] : null
  return it?.ref || ''
}

/**
 * An existing receipt for the same payment: same ref, or (older rows without a ref) same bar,
 * same amount and same invoice period.
 */
export function findDuplicate(existing = [], { barId, item }) {
  const ref = receiptRefOf(item)
  const { start, end } = invoicePeriod(item?.fatura)
  const valor = Math.round(+item?.valor || 0)
  return (existing || []).find(r => {
    if (r.bar_id !== barId) return false
    const rref = refOfRow(r)
    if (rref) return rref === ref
    return Math.round(+r.total || 0) === valor &&
      String(r.periodo_inicio || '').slice(0, 10) === start &&
      String(r.periodo_fim || '').slice(0, 10) === end
  }) || null
}

/** Next number for the month: the highest RY-YYYYMM-NNN of any bar + 1. */
export function nextNumber(numbers = [], date = new Date()) {
  const d = typeof date === 'string' ? new Date(date + 'T12:00:00') : date
  const prefix = `RY-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-`
  let max = 0
  for (const n of numbers || []) {
    const s = String(n || '')
    if (!s.startsWith(prefix)) continue
    const seq = parseInt(s.slice(prefix.length), 10)
    if (Number.isFinite(seq) && seq > max) max = seq
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function invoiceLabel(f) {
  const { start, end } = invoicePeriod(f)
  return start && end ? `請求書 ${start}～${end}` : '請求書'
}

/**
 * Prints the receipt for one payment. If that payment already has a receipt, the same one is printed
 * again (same number) instead of making a second receipt.
 */
export async function issuePaymentReceipt(supabase, { bar, item, dataEmissao, company }) {
  const ref = receiptRefOf(item)
  const { start, end } = invoicePeriod(item.fatura)
  const emitente = companyEmitente(company)
  const { data: rows, error: listErr } = await supabase.from('ryoshusho').select('*')
  if (listErr) throw listErr
  const dup = findDuplicate(rows || [], { barId: bar.id, item })
  const numero = dup?.numero || nextNumber((rows || []).map(r => r.numero), dataEmissao)
  const html = buildPaymentRyoshushoHtml({
    numero,
    dataEmissao: dup?.data_emissao || dataEmissao,
    barNome: bar.nome,
    valor: dup ? (+dup.total || item.valor) : item.valor,
    metodo: item.metodo,
    notas: item.notas,
    periodoInicio: start,
    periodoFim: end,
    descricao: `飲料代金のお支払い（${invoiceLabel(item.fatura)}）`,
    emitente,
  })
  printRyoshushoHtml(html, `ryoshusho-${numero}`)
  if (dup) return { numero, reused: true }

  const { total, subtotal, tax } = calcTaxFromZeikomi(item.valor)
  const base = {
    numero,
    bar_id: bar.id,
    data_emissao: dataEmissao,
    periodo_inicio: start || dataEmissao,
    periodo_fim: end || dataEmissao,
    subtotal,
    consumo_tax: tax,
    total,
    emitente_nome: emitente.nome,
    emitente_endereco: emitente.endereco,
    emitente_tel: emitente.tel,
    emitente_registro: emitente.registro,
    itens: [{ nome: `Pagamento — ${item.metodo || '—'} · ${invoiceLabel(item.fatura)}`, qtd: 1, preco: total, ref, fatura_id: item.fatura?.id || null }],
  }
  // fatura_id / pagamento_ref come from sql/money_structure.sql; without them the ref still lives in itens.
  let withCols = true
  let row = base
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase.from('ryoshusho').insert(withCols ? { ...row, fatura_id: item.fatura?.id || null, pagamento_ref: ref } : row)
    if (!error) return { numero: row.numero, reused: false }
    const msg = String(error.message || '')
    if (withCols && /fatura_id|pagamento_ref/i.test(msg) && !/duplicate/i.test(msg)) { withCols = false; continue }
    // Another bar took this number at the same time (unique index): take the next one.
    if (error.code === '23505' && /numero/i.test(msg)) { row = { ...row, numero: nextNumber([row.numero], dataEmissao) }; continue }
    throw error
  }
  throw new Error('Could not save the receipt number')
}
