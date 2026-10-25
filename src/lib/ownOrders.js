/**
 * Own orders: what a bar buys from its own suppliers. Kept in `bar_own_orders`, which only the bar's
 * owner/manager can read (sql/bar_own_orders.sql). Never written to pedidos, vendas or notificacoes,
 * so it never reaches JBM.
 */

export const OWN_ORDER_STATUS = ['ordered', 'received', 'cancelled']

/** Clean lines: a name and a quantity above zero; price is optional. */
export function cleanOwnItems(items = []) {
  return (items || [])
    .map(it => ({
      nome: String(it?.nome || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      qtd: Math.max(0, +it?.qtd || 0),
      preco: Math.max(0, +it?.preco || 0),
    }))
    .filter(it => it.nome && it.qtd > 0)
}

export function ownOrderTotal(items = []) {
  return Math.round(cleanOwnItems(items).reduce((a, it) => a + it.qtd * it.preco, 0))
}

/** Row ready to insert, or { error } naming the missing field. */
export function buildOwnOrder({ barId, fornecedor, data, items, obs }) {
  const supplier = String(fornecedor || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!supplier) return { error: 'supplier' }
  const itens = cleanOwnItems(items)
  if (!itens.length) return { error: 'items' }
  const row = { bar_id: barId, fornecedor: supplier, itens, total: ownOrderTotal(itens), status: 'ordered' }
  if (data) row.data = data
  const note = String(obs || '').trim().slice(0, 500)
  if (note) row.obs = note
  return { row }
}

/** Month list with totals; cancelled orders stay listed but do not count. */
export function ownOrdersSummary(rows = [], month = '') {
  const list = (rows || []).filter(r => !month || String(r.data || '').startsWith(month))
  const live = list.filter(r => r.status !== 'cancelled')
  return {
    list,
    count: live.length,
    total: live.reduce((a, r) => a + (+r.total || 0), 0),
    open: live.filter(r => r.status === 'ordered').length,
  }
}
