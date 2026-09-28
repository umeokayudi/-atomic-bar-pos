/** Bar employees stay on perfis. Job title and permission role are not the same thing. */

export const JOB_ROLES = ['manager', 'cashier', 'bartender', 'hostess', 'staff', 'cleaner']

const PERMISSION_BY_JOB = {
  manager: 'gerente',
  cashier: 'caixa',
  bartender: 'bar_staff',
  hostess: 'bar_staff',
  staff: 'bar_staff',
  cleaner: 'bar_staff',
}

export const BAR_PERMISSION_ROLES = ['cliente', 'gerente', 'caixa', 'bar_staff']
export const EMPLOYMENT_STATUSES = ['invited', 'active', 'suspended', 'inactive']

const SECRET_KEYS = ['password', 'clock_pin_hash', 'pin_hash', 'tablet_token_hash', 'pin', 'temporary_password']

export function jobToPermission(job) {
  const key = String(job || '').trim().toLowerCase()
  return PERMISSION_BY_JOB[key] || null
}

export function canManageEmployees(role) {
  return role === 'cliente' || role === 'gerente'
}

export function sameBar(actorBarId, targetBarId) {
  return Boolean(actorBarId) && String(actorBarId) === String(targetBarId)
}

/** A missing employment row means the existing login stays active. */
export function barPortalAllowed(role, status) {
  if (!BAR_PERMISSION_ROLES.includes(role)) return false
  if (role === 'admin') return false
  if (status == null || status === '' || status === 'active') return true
  return false
}

export function nextEmployeeStatus(current, action) {
  const from = current || 'active'
  const table = {
    accept: { invited: 'active' },
    suspend: { active: 'suspended', invited: 'suspended' },
    reactivate: { suspended: 'active', inactive: 'active' },
    deactivate: { active: 'inactive', suspended: 'inactive', invited: 'inactive' },
  }
  return table[action]?.[from] || null
}

export function publicEmployee(row) {
  if (!row || typeof row !== 'object') return row
  const copy = { ...row }
  for (const key of SECRET_KEYS) delete copy[key]
  return copy
}

export function invitePayload(body = {}) {
  if (body.password || body.temporary_password || body.pin) {
    return { error: 'Managers cannot set an employee password' }
  }
  const job = String(body.job_role || body.role || '').trim().toLowerCase()
  const permission = jobToPermission(job)
  if (!permission) return { error: 'Unknown role' }
  const email = String(body.email || '').trim().toLowerCase()
  const nome = String(body.nome || body.full_name || '').trim()
  if (!email.includes('@') || email.startsWith('@') || !nome) {
    return { error: 'Name and email are required' }
  }
  const start = String(body.start_date || '').slice(0, 10)
  return {
    email,
    nome,
    job_role: job,
    permission,
    phone: String(body.phone || body.contato || '').trim().slice(0, 40),
    employee_code: String(body.employee_code || body.employee_id || '').trim().slice(0, 40),
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null,
    notes: String(body.notes || body.notas || '').trim().slice(0, 500),
  }
}
