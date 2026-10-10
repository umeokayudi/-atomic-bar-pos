/**
 * Pure helpers for Clients/CRM, Marketing and Consulting. No Supabase here so they can be unit tested.
 *
 * Metric formulas (also shown in the UI):
 * - revenue(bar, window)  = Σ vendas.total of supply sales (isSupplierVenda) with data in the window.
 * - growth %              = (revenue last N days − revenue previous N days) / revenue previous N days × 100;
 *                           null when the previous window is 0 (no base to compare).
 * - receivable(bar)       = Σ max(0, (faturas.total || faturas.valor) − faturas.pago) over invoices not paid.
 * - overdue(bar)          = the same sum limited to invoices whose due date (vencimento || data_vencimento) < today.
 * - lastOrder(bar)        = max(pedidos.data_pedido, vendas.data) for that bar.
 */

export const PAID_STATUSES = ['pago', 'paga', 'paid']

export function isoDay(d) {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}

export function invoiceOwed(f) {
  if (!f || PAID_STATUSES.includes(f.status)) return 0
  return Math.max(0, (+f.total || +f.valor || 0) - (+f.pago || 0))
}

export function invoiceDue(f) {
  return f?.vencimento || f?.data_vencimento || null
}

export function saleDay(v) {
  return v?.data || v?.data_venda || (v?.criado_em ? String(v.criado_em).slice(0, 10) : null)
}

/**
 * Build one CRM row per client bar.
 * sales: supply sales already filtered (isSupplierVenda); invoices: faturas; orders: pedidos.
 */
export function buildClientRows({ bars = [], sales = [], invoices = [], orders = [], today = isoDay(new Date()), days = 90 }) {
  const curFrom = addDays(today, -(days - 1))
  const prevFrom = addDays(curFrom, -days)
  const rows = new Map(bars.map(b => [b.id, {
    id: b.id, nome: b.nome, cor: b.cor || null,
    revenue: 0, prevRevenue: 0, salesCount: 0, receivable: 0, overdue: 0, overdueCount: 0,
    lastOrder: null, openOrders: 0,
  }]))
  for (const v of sales) {
    const r = rows.get(v.bar_id)
    const day = saleDay(v)
    if (!r || !day) continue
    const total = +v.total || 0
    if (day >= curFrom && day <= today) { r.revenue += total; r.salesCount += 1 } else if (day >= prevFrom && day < curFrom) r.prevRevenue += total
    if (!r.lastOrder || day > r.lastOrder) r.lastOrder = day
  }
  for (const f of invoices) {
    const r = rows.get(f.bar_id)
    if (!r) continue
    const owed = invoiceOwed(f)
    if (!owed) continue
    r.receivable += owed
    const due = invoiceDue(f)
    if (due && due < today) { r.overdue += owed; r.overdueCount += 1 }
  }
  for (const o of orders) {
    const r = rows.get(o.bar_id)
    if (!r) continue
    if (o.data_pedido && (!r.lastOrder || o.data_pedido > r.lastOrder)) r.lastOrder = o.data_pedido
    if (!['entregue', 'delivered', 'cancelado', 'cancelled', 'faturado'].includes(o.status)) r.openOrders += 1
  }
  return [...rows.values()].map(r => ({
    ...r,
    growthPct: r.prevRevenue > 0 ? Math.round(((r.revenue - r.prevRevenue) / r.prevRevenue) * 1000) / 10 : null,
    daysSinceOrder: r.lastOrder ? Math.round((new Date(`${today}T00:00:00`) - new Date(`${r.lastOrder}T00:00:00`)) / 86400000) : null,
  }))
}

/** Signals worth a call: overdue money, falling revenue, or no order for a while. Facts only, no scores. */
export function clientSignals(row, { quietDays = 21, dropPct = -20 } = {}) {
  const out = []
  if (row.overdue > 0) out.push('overdue')
  if (row.growthPct != null && row.growthPct <= dropPct) out.push('falling')
  if (row.daysSinceOrder == null || row.daysSinceOrder >= quietDays) out.push('quiet')
  return out
}

export function sortClientRows(rows, key = 'revenue') {
  const list = [...rows]
  const num = v => (v == null ? -Infinity : v)
  if (key === 'name') return list.sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
  if (key === 'quiet') return list.sort((a, b) => num(b.daysSinceOrder ?? 1e9) - num(a.daysSinceOrder ?? 1e9))
  return list.sort((a, b) => num(b[key]) - num(a[key]))
}

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'done', 'cancelled']
export const CAMPAIGN_CHANNELS = ['in_store', 'instagram', 'line', 'x', 'email', 'event', 'other']

/** Validate a campaign form before it is sent. Returns an error key or ''. */
export function validateCampaign(c) {
  if (!String(c?.nome || '').trim()) return 'growth.errName'
  if (c.inicio && c.fim && c.fim < c.inicio) return 'growth.errDates'
  if (c.orcamento !== '' && c.orcamento != null && (Number.isNaN(+c.orcamento) || +c.orcamento < 0)) return 'growth.errBudget'
  return ''
}

/** Normalise a campaign form into a row for marketing_campaigns. */
export function campaignRow(c) {
  return {
    bar_id: c.bar_id || null,
    nome: String(c.nome).trim(),
    canal: c.canal || 'in_store',
    status: c.status || 'draft',
    inicio: c.inicio || null,
    fim: c.fim || null,
    produtos: c.produtos?.trim() || null,
    oferta: c.oferta?.trim() || null,
    objetivo: c.objetivo?.trim() || null,
    orcamento: c.orcamento === '' || c.orcamento == null ? null : +c.orcamento,
    resultado_notas: c.resultado_notas?.trim() || null,
    atualizado_em: new Date().toISOString(),
  }
}

/** Revenue of a bar inside a campaign window vs the same number of days right before it. */
export function campaignLift(sales, campaign, today = isoDay(new Date())) {
  if (!campaign?.inicio) return null
  const end = campaign.fim && campaign.fim < today ? campaign.fim : today
  if (end < campaign.inicio) return null
  const len = Math.round((new Date(`${end}T00:00:00`) - new Date(`${campaign.inicio}T00:00:00`)) / 86400000) + 1
  const beforeFrom = addDays(campaign.inicio, -len)
  let during = 0
  let before = 0
  for (const v of sales) {
    if (campaign.bar_id && v.bar_id !== campaign.bar_id) continue
    const d = saleDay(v)
    if (!d) continue
    if (d >= campaign.inicio && d <= end) during += +v.total || 0
    else if (d >= beforeFrom && d < campaign.inicio) before += +v.total || 0
  }
  return { days: len, during, before, pct: before > 0 ? Math.round(((during - before) / before) * 1000) / 10 : null }
}

/** Progress of a consulting plan: done / total tasks, overdue open tasks. */
export function planProgress(tasks = [], today = isoDay(new Date())) {
  const total = tasks.length
  const done = tasks.filter(t => t.status === 'done').length
  const overdue = tasks.filter(t => t.status !== 'done' && t.prazo && t.prazo < today).length
  return { total, done, overdue, pct: total ? Math.round((done / total) * 100) : 0 }
}

/** Baseline vs current KPI, both plain numbers. Returns delta and % (null without a base). */
export function kpiDelta(base, current) {
  const b = +base
  const c = +current
  if (!Number.isFinite(b) || !Number.isFinite(c)) return null
  return { delta: c - b, pct: b !== 0 ? Math.round(((c - b) / Math.abs(b)) * 1000) / 10 : null }
}

export function isMissingTable(error) {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /does not exist|could not find the table/i.test(error.message || ''))
}
