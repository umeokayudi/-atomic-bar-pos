/**
 * Legacy JBM books (compras, vendas, faturas, ryoshusho, catalog cost).
 * Procurement HQ stays admin|jbm. Company ledgers stay admin.
 * A linked bar does not turn staff or funcionario into that bar's portal.
 */

export const BAR_PORTAL_ROLES = ['cliente', 'gerente', 'caixa', 'bar_staff']

export function canReadGlobalLegacyFinance(role) {
  return role === 'admin'
}

export function canLoadOverdueAlerts(role) {
  return role === 'admin'
}

export function canReadCompanyPurchases(role) {
  return role === 'admin'
}

export function canReadSuppliers(role) {
  return role === 'admin'
}

export function canReadProductCost(role) {
  return role === 'admin'
}

/** @returns {{ kind: 'global' } | { kind: 'bar', barId: string } | { kind: 'none' }} */
export function barBookScope(role, barId) {
  if (role === 'admin') return { kind: 'global' }
  if (role === 'staff' && barId) return { kind: 'bar', barId }
  return { kind: 'none' }
}

export function shellTabIds(role) {
  if (role === 'admin') {
    return [
      'dashboard', 'billingHub', 'purchases', 'sales', 'pedidos', 'fulfillment', 'procurement',
      'relatorio', 'ryoshusho', 'seikyusho', 'products', 'bars', 'usuarios', 'faturas', 'suppliers', 'cashflow',
      'payroll', 'crm', 'marketing', 'consultoria', 'ai',
    ]
  }
  if (role === 'jbm') return ['procurement', 'fulfillment', 'payroll']
  if (role === 'funcionario') {
    return ['profile', 'shifts', 'clock', 'goals', 'result', 'points', 'occurrences', 'rewards', 'salary', 'procurement']
  }
  if (role === 'staff') return ['purchases', 'sales', 'relatorio', 'ryoshusho', 'products']
  return []
}

export function seesHqProcurement(role) {
  return role === 'admin' || role === 'jbm'
}
