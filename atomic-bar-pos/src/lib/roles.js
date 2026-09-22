export const ROLE_HOME = {
  jbm: '/pos',
  admin: '/pos',
  staff: '/pos',
  fornecedor: '/estoque',
}

export const ROLE_NAV = {
  jbm: [
    { to: '/pos', icon: '🧾', label: 'Caixa' },
    { to: '/estoque', icon: '📦', label: 'Estoque' },
    { to: '/cast', icon: '👥', label: 'Cast' },
    { to: '/relatorio', icon: '📊', label: 'Financeiro' },
  ],
  admin: [
    { to: '/pos', icon: '🧾', label: 'Caixa' },
    { to: '/estoque', icon: '📦', label: 'Estoque' },
    { to: '/cast', icon: '👥', label: 'Cast' },
    { to: '/relatorio', icon: '📊', label: 'Financeiro' },
  ],
  staff: [
    { to: '/pos', icon: '🧾', label: 'Caixa' },
    { to: '/estoque', icon: '📦', label: 'Estoque' },
    { to: '/cast', icon: '👥', label: 'Cast' },
    { to: '/relatorio', icon: '📊', label: 'Financeiro' },
  ],
  fornecedor: [
    { to: '/estoque', icon: '📦', label: 'Estoque' },
  ],
}

export const ROLE_LABEL = {
  jbm: 'JBM',
  admin: 'Admin do bar',
  staff: 'Equipe do bar',
  fornecedor: 'Fornecedor',
}

export function canSwitchBars(role) {
  return role === 'jbm' || role === 'admin'
}

export function roleFromUser(user) {
  const email = (user?.email || '').toLowerCase()
  if (email === 'umeokagroup@gmail.com') return 'jbm'
  const role = user?.user_metadata?.role
  if (role === 'jbm' || role === 'admin' || role === 'staff' || role === 'fornecedor') return role
  if (role === 'funcionario') return 'staff'
  return 'staff'
}

export function canOpenPath(role, pathname) {
  const nav = ROLE_NAV[role] || ROLE_NAV.staff
  if (pathname === '/' || pathname === '') return true
  return nav.some(item => pathname === item.to || pathname.startsWith(`${item.to}/`))
}
