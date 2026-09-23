/** Auth compartilhado — staff JWT ou secret interno (cron / holding sync). */

import { createStaffUserClient, drinksAuthClient } from './_supabaseAdmin.js'

export function bearerToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
}

export function isAllowedOrigin(req) {
  const origins = [
    'https://jbm-master.vercel.app',
    'https://bebidas-control.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4173',
  ]
  const origin = req.headers.origin || ''
  const referer = req.headers.referer || ''
  return origins.some(o => origin === o || referer.startsWith(o))
}

export function isInternalService(req) {
  const token = bearerToken(req)
  const secrets = [
    process.env.INTERNAL_API_SECRET,
    process.env.CRON_SECRET,
    process.env.HOLDING_SYNC_SECRET,
  ].filter(Boolean)
  return secrets.length > 0 && secrets.includes(token)
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} [_admin] legacy — não usado; auth via anon + JWT
 * @param {{ roles?: string[], adminOnly?: boolean }} opts
 */
export async function requireStaff(req, _admin, opts = {}) {
  const { roles = ['staff', 'admin'], adminOnly = false } = opts

  if (isInternalService(req)) {
    return { user: null, perfil: { role: 'service' }, service: true, token: null }
  }

  const token = bearerToken(req)
  if (!token) return { error: 'Não autenticado', status: 401 }

  const authClient = drinksAuthClient()
  const { data: { user }, error } = await authClient.auth.getUser(token)
  if (error || !user) return { error: 'Sessão inválida', status: 401 }

  const userDb = createStaffUserClient(token)
  const { data: perfil } = await userDb.from('perfis').select('role').eq('id', user.id).single()
  if (!perfil || perfil.role === 'cliente' || perfil.role === 'caixa' || perfil.role === 'bar_staff') {
    return { error: 'Sem permissão', status: 403 }
  }
  if (adminOnly && perfil.role !== 'admin' && perfil.role !== 'staff') {
    return { error: 'Sem permissão', status: 403 }
  }
  if (!roles.includes(perfil.role) && perfil.role !== 'admin') {
    return { error: 'Sem permissão', status: 403 }
  }

  return { user, perfil, token }
}

/** Conta do bar (dono, caixa tablet, staff). Nunca libera painel JBM. */
export async function requireBarAccount(req, _admin, opts = {}) {
  const allowed = opts.roles || ['cliente', 'gerente', 'caixa', 'bar_staff']
  let admin = _admin
  if (!admin) {
    const { drinksAdminClient } = await import('./_supabaseAdmin.js')
    admin = drinksAdminClient()
  }
  const { resolveBarActor } = await import('./_barLaneAuth.js')
  const actor = await resolveBarActor(req, admin)
  if (actor.error) return actor
  if (!allowed.includes(actor.perfil.role)) return { error: 'Sem permissão', status: 403 }
  if (!actor.perfil.bar_id) return { error: 'Conta sem bar vinculado', status: 403 }
  return actor
}

/** Staff JWT, service secret, ou origem permitida (jbm-master / bebidas SPA). */
export async function requireStaffOrTrustedOrigin(req, admin, opts = {}) {
  if (isInternalService(req)) return { user: null, perfil: { role: 'service' }, service: true, token: null }
  if (isAllowedOrigin(req)) {
    const auth = await requireStaff(req, admin, opts)
    if (!auth.error) return auth
    return { user: null, perfil: { role: 'origin' }, originTrusted: true, token: null }
  }
  return requireStaff(req, admin, opts)
}
