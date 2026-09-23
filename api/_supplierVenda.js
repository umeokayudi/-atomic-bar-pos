/** Supplier vs POS — single source of truth for APIs and scripts */
export function isSupplierVenda(v) {
  if (!v) return false
  if (v.origem === 'fornecedor') return true
  if (v.origem === 'pos') return false
  const obs = (v.obs || '').toLowerCase()
  if (obs.includes('balcão') || obs.includes('balcao') || obs.includes('square')) return false
  if (/(^|[^a-z])pos([^a-z]|$)/i.test(v.obs || '')) return false
  if (v.cast_id) return false
  return true
}

export function filterSupplierVendas(list) {
  return (list || []).filter(isSupplierVenda)
}
