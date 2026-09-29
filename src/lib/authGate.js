/** Decides whether a Supabase Auth user may enter, and where they land. */

import { hashForRole } from './barDoors.js'
import { BAR_PERMISSION_ROLES } from './employeeAccess.js'

const HQ_ROLES = ['admin', 'jbm', 'staff', 'funcionario']

export function loginBlockedReason(role, status) {
  if (!BAR_PERMISSION_ROLES.includes(role)) return ''
  if (status === 'suspended' || status === 'inactive') return 'suspended'
  return ''
}

export function sessionMatchesProfile(authUserId, perfil) {
  return Boolean(authUserId && perfil?.id && String(perfil.id) === String(authUserId))
}

export function barMatches(perfilBarId, employeeBarId) {
  if (!employeeBarId) return true
  if (!perfilBarId) return false
  return String(perfilBarId) === String(employeeBarId)
}

export function portalDestination(role) {
  return hashForRole(role)
}

export function canOpenHq(role) {
  return HQ_ROLES.includes(role)
}
