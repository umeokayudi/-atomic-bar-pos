/**
 * Navigation map: which screen belongs to which work area.
 * Pure data so it can be tested in Node and reused by the HQ shell, the bar portal and the AI layer.
 */

/** HQ (JBM admin / staff / funcionario) areas, in menu order (AI Center first). Ids are shell tab ids. */
export const HQ_AREAS = [
  { id: 'intelligence', labelKey: 'navArea.intelligence', ids: ['ai'] },
  { id: 'overview', labelKey: 'navArea.overview', ids: ['dashboard', 'billingHub'] },
  { id: 'operation', labelKey: 'navArea.operation', ids: ['sales', 'pedidos', 'products', 'bars'] },
  { id: 'supply', labelKey: 'navArea.supply', ids: ['purchases', 'fulfillment', 'procurement', 'suppliers'] },
  { id: 'finance', labelKey: 'navArea.finance', ids: ['cashflow', 'faturas', 'relatorio', 'ryoshusho', 'seikyusho'] },
  { id: 'people', labelKey: 'navArea.people', ids: ['payroll', 'profile', 'shifts', 'clock', 'goals', 'result', 'points', 'occurrences', 'rewards', 'salary'] },
  { id: 'growth', labelKey: 'navArea.growth', ids: ['crm', 'marketing', 'consultoria'] },
  { id: 'settings', labelKey: 'navArea.settings', ids: ['usuarios'] },
]

/** Screens that are administrative: they get the "Ask AI" button. */
export const HQ_ADMIN_TABS = new Set([
  'dashboard', 'billingHub', 'purchases', 'sales', 'pedidos', 'fulfillment', 'procurement', 'relatorio',
  'products', 'bars', 'usuarios', 'faturas', 'suppliers', 'cashflow', 'payroll', 'crm', 'marketing', 'consultoria',
])

/** Bar-portal tabs that are administrative (owner/manager); the till and the clock are not. */
export const BAR_ADMIN_TABS = new Set([
  'inicio', 'pedidos', 'entregas', 'faturas', 'espacos', 'vip', 'ordens', 'mesas', 'clientes', 'fechamento', 'metas', 'pagamentos',
  'salarios', 'eventos', 'staff', 'fornecedor', 'parceiro', 'drinkback', 'cartao', 'energia', 'aluguel', 'fixo',
  'variavel', 'contador', 'imposto', 'estoque', 'custos', 'precos', 'recibos',
])

/** AI module name for a screen id: the AI panel uses it to pick the data it loads. */
const MODULE_BY_TAB = {
  dashboard: 'overview', billingHub: 'reports', relatorio: 'reports', inicio: 'overview',
  sales: 'sales', pos: 'sales', fechamento: 'sales', recibos: 'sales',
  pedidos: 'supply', fulfillment: 'supply', procurement: 'supply', purchases: 'supply', suppliers: 'supply',
  fornecedor: 'supply', entregas: 'supply', estoque: 'stock', products: 'stock', precos: 'stock',
  cashflow: 'finance', faturas: 'finance', ryoshusho: 'finance', seikyusho: 'finance', pagamentos: 'finance',
  custos: 'finance', cartao: 'finance', energia: 'finance', aluguel: 'finance', fixo: 'finance', variavel: 'finance',
  contador: 'finance', imposto: 'finance',
  payroll: 'team', staff: 'team', salarios: 'team', metas: 'team', ponto: 'team', usuarios: 'team',
  crm: 'crm', clientes: 'crm', drinkback: 'crm', parceiro: 'crm',
  marketing: 'marketing', eventos: 'marketing',
  consultoria: 'consulting', bars: 'consulting',
  mesas: 'floor', espacos: 'floor', vip: 'floor', ordens: 'team',
  ai: 'overview',
}

export function aiModuleForTab(tab) {
  return MODULE_BY_TAB[tab] || 'overview'
}

/** Group the tabs a role may see into areas; unknown ids go to a trailing group so nothing disappears. */
export function groupTabs(allowedIds, areas = HQ_AREAS) {
  const allowed = new Set(allowedIds)
  const used = new Set()
  const groups = []
  for (const area of areas) {
    const ids = area.ids.filter(id => allowed.has(id))
    ids.forEach(id => used.add(id))
    if (ids.length) groups.push({ id: area.id, labelKey: area.labelKey, ids })
  }
  const rest = allowedIds.filter(id => !used.has(id))
  if (rest.length) groups.push({ id: 'more', labelKey: 'navArea.more', ids: rest })
  return groups
}

/** "/hq/cashflow" → "cashflow"; anything else → fallback. */
export function tabFromPath(pathname, prefix, allowedIds, fallback) {
  const parts = String(pathname || '').split('/').filter(Boolean)
  if (parts[0] === prefix && parts[1] && allowedIds.includes(parts[1])) return parts[1]
  return fallback
}

export function pathForTab(prefix, tab) {
  return `/${prefix}/${tab}`
}
