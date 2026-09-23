import { drinksAdminClient, drinksAuthClient, createStaffUserClient } from './_supabaseAdmin.js'
import { ensureBarLiveReady, runLiveOp } from './_barLiveStore.js'
import { secretsMatch, signLanePayload, verifyLaneToken } from './_hash.js'

function bearerToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
}

function newId() {
  return globalThis.crypto?.randomUUID?.() || `lane-${Date.now()}`
}

async function resolveLaneSession(token, admin) {
  if (!token || !String(token).startsWith('lane:')) return null
  const signed = verifyLaneToken(token)
  if (signed?.id) {
    return {
      user: { id: signed.id, email: signed.email },
      perfil: {
        id: signed.id,
        email: signed.email,
        nome: signed.nome,
        role: signed.role,
        bar_id: signed.bar_id,
        cargo: signed.cargo || signed.role,
        salario_hora: signed.salario_hora || 0,
      },
      token,
      lane: true,
    }
  }
  if (!admin) return null
  const sessionId = String(token).slice(5)
  if (sessionId.includes('.')) return null
  const { data } = await runLiveOp(admin, {
    table: 'bar_sessions',
    mode: 'select',
    columns: '*',
    filters: [{ op: 'eq', k: 'id', v: sessionId }],
    wantSingle: 'maybe',
  })
  if (!data || (data.exp && data.exp < Date.now())) return null
  return {
    user: { id: data.login_id, email: data.email },
    perfil: {
      id: data.login_id,
      email: data.email,
      nome: data.nome,
      role: data.role,
      bar_id: data.bar_id,
      cargo: data.cargo || data.role,
      salario_hora: data.salario_hora || 0,
    },
    token,
    lane: true,
  }
}

export async function resolveBarActor(req, admin) {
  const token = bearerToken(req)
  if (!token) return { error: 'Não autenticado', status: 401 }
  const lane = await resolveLaneSession(token, admin)
  if (lane) return lane

  const authClient = drinksAuthClient()
  const { data: { user }, error } = await authClient.auth.getUser(token)
  if (error || !user) return { error: 'Sessão inválida', status: 401 }
  const userDb = createStaffUserClient(token)
  const { data: perfil } = await userDb.from('perfis').select('*').eq('id', user.id).single()
  if (!perfil) return { error: 'Sem perfil', status: 403 }
  return { user, perfil, token, lane: false }
}

export async function loginLane(email, password) {
  const admin = drinksAdminClient()
  const wanted = String(email || '').trim().toLowerCase()
  let { data: logins } = await runLiveOp(admin, { table: 'bar_logins', mode: 'select', columns: '*' })
  if (!logins?.length) {
    await ensureBarLiveReady(admin)
    ;({ data: logins } = await runLiveOp(admin, { table: 'bar_logins', mode: 'select', columns: '*' }))
  }
  const login = (logins || []).find(l => String(l.email || '').toLowerCase() === wanted && l.ativo !== false)
  if (!login || !secretsMatch(password, login.password_hash)) {
    return { error: 'Incorrect email or password', status: 401 }
  }
  const perfil = {
    id: login.id,
    email: login.email,
    nome: login.nome,
    role: login.role,
    bar_id: login.bar_id,
    cargo: login.cargo || login.role,
    salario_hora: login.salario_hora || 0,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  }
  const token = signLanePayload(perfil)
  void runLiveOp(admin, {
    table: 'bar_sessions',
    mode: 'insert',
    insertRows: [{ ...perfil, id: newId(), login_id: login.id }],
    wantSingle: true,
  }).catch(() => {})
  return {
    ok: true,
    token,
    perfil: {
      id: perfil.id,
      email: perfil.email,
      nome: perfil.nome,
      role: perfil.role,
      bar_id: perfil.bar_id,
      cargo: perfil.cargo,
      salario_hora: perfil.salario_hora,
    },
  }
}
