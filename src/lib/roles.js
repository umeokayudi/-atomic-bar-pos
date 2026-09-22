export const ROLE_HOME = {
  admin: '/pos',
  staff: '/pos',
  fornecedor: '/estoque',
}

export const ROLE_NAV = {
  admin: [
    { to: '/pos', icon: '🧾', label: 'POS / Caixa' },
    { to: '/estoque', icon: '📦', label: 'Estoque' },
    { to: '/cast', icon: '👥', label: 'Cast' },
    { to: '/relatorio', icon: '📊', label: 'Relatório' },
  ],
  staff: [
    { to: '/pos', icon: '🧾', label: 'POS / Caixa' },
    { to: '/estoque', icon: '📦', label: 'Estoque' },
    { to: '/cast', icon: '👥', label: 'Cast' },
    { to: '/relatorio', icon: '📊', label: 'Relatório' },
  ],
  fornecedor: [
    { to: '/estoque', icon: '📦', label: 'Estoque' },
  ],
}

export const ROLE_LABEL = {
  admin: 'Admin',
  staff: 'Caixa',
  fornecedor: 'Fornecedor JBM',
}

export function roleFromUser(user) {
  const role = user?.user_metadata?.role
  if (role === 'admin' || role === 'staff' || role === 'fornecedor') return role
  return 'staff'
}

export function canOpenPath(role, pathname) {
  const nav = ROLE_NAV[role] || ROLE_NAV.staff
  if (pathname === '/' || pathname === '') return true
  return nav.some(item => pathname === item.to || pathname.startsWith(`${item.to}/`))
}
