/** Access + cost books. POS till ≠ JBM invoice ≠ staff wages. */

export const ROLES = {
  admin: 'admin',
  funcionario: 'funcionario',
  cliente: 'cliente',
  gerente: 'gerente',
  caixa: 'caixa',
  bar_staff: 'bar_staff',
}

export const JBM_ROLES = [ROLES.admin, ROLES.funcionario]
export const BAR_ROLES = [ROLES.cliente, ROLES.gerente, ROLES.caixa, ROLES.bar_staff]
export const BAR_ROLES_NEED_BAR = BAR_ROLES

export function isJbmRole(role) {
  return JBM_ROLES.includes(role) || role === 'staff'
}

export function isSupplierRole(role) {
  return role === 'fornecedor'
}

export function isGerente(role) {
  return role === ROLES.cliente || role === ROLES.gerente
}

export function isBarRole(role) {
  return BAR_ROLES.includes(role)
}

export function needsBarLink(role) {
  return BAR_ROLES_NEED_BAR.includes(role)
}

export function defaultBarTab(role) {
  if (role === ROLES.caixa) return 'pos'
  if (role === ROLES.bar_staff) return 'ponto'
  return 'inicio'
}

const GERENTE_NAV = [
  { id: 'inicio', labelKey: 'nav.portalHome', icon: '🏠' },
  { id: 'pos', labelKey: 'nav.portalPos', icon: '🧾' },
  { id: 'pedidos', labelKey: 'nav.portalOrders', icon: '🛒' },
  { id: 'entregas', labelKey: 'nav.portalDeliveries', icon: '📦' },
  { id: 'faturas', labelKey: 'nav.portalInvoices', icon: '📄' },
  { id: 'espacos', labelKey: 'nav.portalSpaces', icon: '🪑' },
  { id: 'clientes', labelKey: 'nav.portalGuests', icon: '🥂' },
  { id: 'ponto', labelKey: 'nav.portalClock', icon: '🕒' },
  { id: 'fechamento', labelKey: 'nav.portalClose', icon: '📒' },
  { id: 'metas', labelKey: 'nav.portalGoals', icon: '🎯' },
  { id: 'pagamentos', labelKey: 'nav.portalPay', icon: '📅' },
  { id: 'salarios', labelKey: 'nav.portalSalary', icon: '💴' },
  { id: 'eventos', labelKey: 'nav.portalEvents', icon: '🎂' },
  { id: 'ia', labelKey: 'nav.portalAi', icon: '✨' },
  { id: 'staff', labelKey: 'house.staffTitle', icon: '👤' },
  { id: 'fornecedor', labelKey: 'house.suppliers', icon: '🚚' },
  { id: 'parceiro', labelKey: 'house.partners', icon: '🤝' },
  { id: 'drinkback', labelKey: 'house.drinkBackNav', icon: '🥂' },
  { id: 'cartao', labelKey: 'house.card', icon: '💳' },
  { id: 'energia', labelKey: 'house.power', icon: '⚡' },
  { id: 'aluguel', labelKey: 'house.rent', icon: '🏢' },
  { id: 'fixo', labelKey: 'house.fixedCosts', icon: '📌' },
  { id: 'variavel', labelKey: 'house.variableCosts', icon: '📈' },
  { id: 'contador', labelKey: 'house.accountant', icon: '🧮' },
  { id: 'imposto', labelKey: 'house.tax', icon: '🏛' },
  { id: 'estoque', labelKey: 'nav.portalInventory', icon: '🍾' },
  { id: 'custos', labelKey: 'nav.portalCosts', icon: '📚' },
  { id: 'precos', labelKey: 'nav.portalPrices', icon: '🏷' },
  { id: 'recibos', labelKey: 'nav.portalReceipts', icon: '🖨' },
]

const NAV_GROUPS = [
  { id: 'tonight', labelKey: 'nav.groupTonight', ids: ['inicio', 'pos', 'pedidos', 'entregas', 'faturas', 'espacos', 'clientes', 'ponto', 'fechamento'] },
  { id: 'numbers', labelKey: 'nav.groupNumbers', ids: ['metas', 'pagamentos', 'salarios', 'eventos', 'ia'] },
  { id: 'house', labelKey: 'nav.groupHouse', ids: ['staff', 'fornecedor', 'parceiro', 'drinkback', 'cartao', 'energia', 'aluguel', 'fixo', 'variavel', 'contador', 'imposto'] },
  { id: 'supply', labelKey: 'nav.groupSupply', ids: ['estoque'] },
  { id: 'office', labelKey: 'nav.groupOffice', ids: ['custos', 'precos', 'recibos'] },
]

const CAIXA_NAV = [
  { id: 'pos', labelKey: 'nav.portalPos', icon: '🧾' },
]

const STAFF_NAV = [
  { id: 'ponto', labelKey: 'nav.portalClock', icon: '🕒' },
  { id: 'pos', labelKey: 'nav.portalPos', icon: '🧾' },
  { id: 'pedidos', labelKey: 'nav.portalOrders', icon: '🛒' },
]

export function navForBarRole(role) {
  if (role === ROLES.caixa) return CAIXA_NAV
  if (role === ROLES.bar_staff) return STAFF_NAV
  return GERENTE_NAV
}

export function groupedNavForRole(role) {
  const nav = navForBarRole(role)
  const byId = Object.fromEntries(nav.map(n => [n.id, n]))
  const grouped = NAV_GROUPS.map(g => ({
    id: g.id,
    labelKey: g.labelKey,
    items: g.ids.map(id => byId[id]).filter(Boolean),
  })).filter(g => g.items.length)
  if (grouped.length) return grouped
  return [{ id: 'main', labelKey: null, items: nav }]
}

export function primaryDockForRole(role) {
  if (role === ROLES.caixa) return []
  if (role === ROLES.bar_staff) {
    return [
      { id: 'ponto', icon: '🕒', labelKey: 'nav.portalClock' },
      { id: 'pos', icon: '🧾', labelKey: 'nav.portalPos' },
      { id: 'pedidos', icon: '🛒', labelKey: 'nav.portalOrders' },
    ]
  }
  return [
    { id: 'inicio', icon: '🏠', labelKey: 'nav.portalHome' },
    { id: 'pos', icon: '🧾', labelKey: 'nav.portalPos' },
    { id: 'pedidos', icon: '🛒', labelKey: 'nav.portalOrders' },
    { id: 'espacos', icon: '🪑', labelKey: 'nav.portalSpaces' },
    { id: 'ponto', icon: '🕒', labelKey: 'nav.portalClock' },
  ]
}

export function posAccessForRole(role) {
  if (role === ROLES.caixa || role === ROLES.bar_staff) return 'cashier'
  if (isGerente(role)) return 'owner'
  return 'none'
}

export function canPlaceDrinkOrders(role) {
  return isGerente(role) || role === ROLES.bar_staff
}

export function canManageBarTeam(role) {
  return isGerente(role)
}

export function canSeeJbmSupply(role) {
  return isGerente(role) || isJbmRole(role)
}

export function canSeeDrinkCost(role) {
  return isGerente(role)
}

export function canSeePayrollAll(role) {
  return isGerente(role)
}

export function costAccessForRole(role) {
  if (role === ROLES.caixa) {
    return { posTill: true, jbmBill: false, staffWages: false, drinkCost: false, ownWage: false, rent: false }
  }
  if (role === ROLES.bar_staff) {
    return { posTill: false, jbmBill: false, staffWages: false, drinkCost: false, ownWage: true, rent: false }
  }
  if (isGerente(role)) {
    return { posTill: true, jbmBill: true, staffWages: true, drinkCost: true, ownWage: true, rent: true }
  }
  return { posTill: false, jbmBill: isJbmRole(role), staffWages: false, drinkCost: isJbmRole(role), ownWage: false, rent: false }
}
