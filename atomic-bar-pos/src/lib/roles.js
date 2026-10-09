export const ROLE_HOME = {
  jbm: '/usuarios',
  admin: '/usuarios',
  gerente: '/pos',
  cliente: '/pos',
  caixa: '/pos',
  staff: '/pos',
  bar_staff: '/pos',
  fornecedor: '/estoque',
}

const BAR_NAV = [
  { to: '/pos', icon: '🧾', label: 'Caixa' },
  { to: '/estoque', icon: '📦', label: 'Estoque' },
  { to: '/cast', icon: '👥', label: 'Cast' },
  { to: '/relatorio', icon: '📊', label: 'Financeiro' },
]

const HQ_NAV = [
  { to: '/usuarios', icon: '👤', label: 'Usuários' },
  ...BAR_NAV,
]

export const ROLE_NAV = {
  jbm: HQ_NAV,
  admin: HQ_NAV,
  gerente: BAR_NAV,
  cliente: BAR_NAV,
  staff: BAR_NAV,
  caixa: [
    { to: '/pos', icon: '🧾', label: 'Caixa' },
  ],
  bar_staff: [
    { to: '/pos', icon: '🧾', label: 'Caixa' },
  ],
  fornecedor: [
    { to: '/estoque', icon: '📦', label: 'Estoque' },
  ],
}

export const ROLE_LABEL = {
  jbm: 'JBM',
  admin: 'Admin do bar',
  gerente: 'Gerente',
  cliente: 'Gerente',
  caixa: 'Caixa',
  staff: 'Equipe do bar',
  bar_staff: 'Equipe',
  fornecedor: 'Fornecedor',
}

export function canSwitchBars(role) {
  return role === 'jbm' || role === 'admin'
}

export function roleFromUser(user) {
  const email = (user?.email || '').toLowerCase()
  if (email === 'umeokagroup@gmail.com') return 'jbm'
  const role = user?.user_metadata?.role
  if (role === 'funcionario') return 'staff'
  if (ROLE_NAV[role]) return role
  return 'staff'
}

export function canOpenPath(role, pathname) {
  const nav = ROLE_NAV[role] || ROLE_NAV.staff
  if (pathname === '/' || pathname === '') return true
  return nav.some(item => pathname === item.to || pathname.startsWith(`${item.to}/`))
}
