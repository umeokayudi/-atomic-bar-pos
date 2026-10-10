/** Access + cost books. POS till ≠ JBM invoice ≠ staff wages. */

export const ROLES = {
  admin: 'admin',
  funcionario: 'funcionario',
  cliente: 'cliente',
  gerente: 'gerente',
  caixa: 'caixa',
  bar_staff: 'bar_staff',
}

export const JBM_ROLES = [ROLES.admin, 'jbm']
export const BAR_ROLES = [ROLES.cliente, ROLES.gerente, ROLES.caixa, ROLES.bar_staff]
export const BAR_ROLES_NEED_BAR = BAR_ROLES

export function isJbmRole(role) {
  return role === ROLES.admin || role === 'jbm'
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
  if (role === ROLES.bar_staff) return 'hoje'
  return 'inicio'
}

const GERENTE_NAV = [
  { id: 'inicio', labelKey: 'nav.portalHome', icon: '🏠' },
  { id: 'pos', labelKey: 'nav.portalPos', icon: '🧾' },
  { id: 'mesas', labelKey: 'nav.mesas', icon: '🗺' },
  { id: 'pedidos', labelKey: 'nav.portalOrders', icon: '🛒' },
  { id: 'entregas', labelKey: 'nav.portalDeliveries', icon: '📦' },
  { id: 'faturas', labelKey: 'nav.portalInvoices', icon: '📄' },
  { id: 'espacos', labelKey: 'nav.portalSpaces', icon: '🪑' },
  { id: 'vip', labelKey: 'nav.vip', icon: '👑' },
  { id: 'ordens', labelKey: 'nav.ordens', icon: '🚨' },
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
  { id: 'marketing', labelKey: 'nav.marketing', icon: '📣' },
  { id: 'consultoria', labelKey: 'nav.consultoria', icon: '💼' },
]

// Bar owner/manager menu by work area (same areas as HQ).
const NAV_GROUPS = [
  { id: 'intelligence', labelKey: 'navArea.intelligence', ids: ['ia'] },
  { id: 'overview', labelKey: 'navArea.overview', ids: ['inicio'] },
  { id: 'operation', labelKey: 'navArea.operation', ids: ['pos', 'mesas', 'pedidos', 'entregas', 'espacos', 'vip', 'ponto', 'fechamento'] },
  { id: 'supply', labelKey: 'navArea.supply', ids: ['estoque', 'precos', 'fornecedor', 'parceiro'] },
  { id: 'finance', labelKey: 'navArea.finance', ids: ['faturas', 'pagamentos', 'custos', 'recibos', 'cartao', 'energia', 'aluguel', 'fixo', 'variavel', 'contador', 'imposto'] },
  { id: 'people', labelKey: 'navArea.people', ids: ['staff', 'ordens', 'salarios', 'metas', 'drinkback'] },
  { id: 'growth', labelKey: 'navArea.growth', ids: ['clientes', 'eventos', 'marketing', 'consultoria'] },
]

const CAIXA_NAV = [
  { id: 'pos', labelKey: 'nav.portalPos', icon: '🧾' },
  { id: 'mesas', labelKey: 'nav.mesas', icon: '🗺' },
]

const STAFF_NAV = [
  { id: 'hoje', labelKey: 'nav.myToday', icon: '☀️' },
  { id: 'ponto', labelKey: 'nav.portalClock', icon: '🕒' },
  { id: 'pos', labelKey: 'nav.portalPos', icon: '🧾' },
  { id: 'mesas', labelKey: 'nav.mesas', icon: '🗺' },
  { id: 'pedidos', labelKey: 'nav.portalOrders', icon: '🛒' },
  { id: 'shifts', labelKey: 'nav.myShifts', icon: '🗓️' },
  { id: 'goals', labelKey: 'nav.myGoals', icon: '🎯' },
  { id: 'result', labelKey: 'nav.myResult', icon: '📈' },
  { id: 'points', labelKey: 'nav.myPoints', icon: '⭐' },
  { id: 'rewards', labelKey: 'nav.myRewards', icon: '🏅' },
  { id: 'occurrences', labelKey: 'nav.myOccurrences', icon: '📝' },
  { id: 'salary', labelKey: 'nav.mySalary', icon: '💴' },
  { id: 'profile', labelKey: 'nav.myProfile', icon: '👤' },
]

// Staff see their own day first, then work, results and pay — never the bar's books.
const STAFF_GROUPS = [
  { id: 'myDay', labelKey: 'nav.groupMyDay', ids: ['hoje', 'ponto', 'pos', 'mesas', 'pedidos'] },
  { id: 'myWork', labelKey: 'nav.groupMyWork', ids: ['shifts', 'goals', 'result'] },
  { id: 'myRecord', labelKey: 'nav.groupMyRecord', ids: ['points', 'rewards', 'occurrences'] },
  { id: 'myPay', labelKey: 'nav.groupMyPay', ids: ['salary', 'profile'] },
]

export function navForBarRole(role) {
  if (role === ROLES.caixa) return CAIXA_NAV
  if (role === ROLES.bar_staff) return STAFF_NAV
  return GERENTE_NAV
}

export function groupedNavForRole(role) {
  const nav = navForBarRole(role)
  const byId = Object.fromEntries(nav.map(n => [n.id, n]))
  const groups = role === ROLES.bar_staff ? STAFF_GROUPS : NAV_GROUPS
  const grouped = groups.map(g => ({
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
      { id: 'hoje', icon: '☀️', labelKey: 'nav.myToday' },
      { id: 'ponto', icon: '🕒', labelKey: 'nav.portalClock' },
      { id: 'pos', icon: '🧾', labelKey: 'nav.portalPos' },
      { id: 'pedidos', icon: '🛒', labelKey: 'nav.portalOrders' },
    ]
  }
  return [
    { id: 'inicio', icon: '🏠', labelKey: 'nav.portalHome' },
    { id: 'pos', icon: '🧾', labelKey: 'nav.portalPos' },
    { id: 'mesas', icon: '🗺', labelKey: 'nav.mesas' },
    { id: 'pedidos', icon: '🛒', labelKey: 'nav.portalOrders' },
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
