/** Preview of route_pedido. The database function is the one that writes. */

function leadOf(rule, product, supplier) {
  return product?.lead_time_hours ?? supplier?.default_lead_time_hours ?? 72
}

export function candidateScore(rule, product) {
  return [
    rule?.is_primary ? 0 : rule?.is_backup ? 1 : 2,
    rule?.priority ?? 100,
    leadOf(rule, product),
    product?.purchase_price ?? 1e12,
  ]
}

function better(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

export function routeItems({ items = [], rules = [], products = [], suppliers = [], rejectedSupplierIds = [] } = {}) {
  const rejected = new Set(rejectedSupplierIds)
  const supplierById = new Map(suppliers.map(s => [s.id, s]))
  const assignments = new Map()
  const missed = []

  for (const item of items) {
    const qty = +item.qtd || +item.quantity || 0
    let best = null
    let bestScore = null
    for (const rule of rules) {
      if (!rule.active || rule.product_id !== item.produto_id) continue
      if (rejected.has(rule.supplier_id)) continue
      const supplier = supplierById.get(rule.supplier_id)
      if (supplier && supplier.ativo === false) continue
      const product = products.find(p => p.supplier_id === rule.supplier_id && p.product_id === item.produto_id && p.active !== false)
      if (product && product.available === false) continue
      const moq = product?.minimum_order_quantity ?? 1
      if (qty < moq) continue
      const score = candidateScore(rule, product)
      if (!best || better(score, bestScore)) {
        best = { rule, product, supplier }
        bestScore = score
      }
    }
    if (!best) {
      missed.push(item)
      continue
    }
    const key = best.rule.supplier_id
    const row = assignments.get(key) || {
      supplier_id: key,
      supplier_name: best.supplier?.nome || '',
      items: [],
    }
    row.items.push({
      order_item_id: item.id,
      produto_id: item.produto_id,
      nome: item.nome,
      quantity: qty,
    })
    assignments.set(key, row)
  }

  return { assignments: [...assignments.values()], missed }
}
