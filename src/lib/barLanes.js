/** Three bar doors. JBM admin stays a fourth login. Never mix POS till with JBM invoices or wages. */

export const ATOMIC_BAR_ID = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'
export const LANE_TOKEN_KEY = 'bar_lane_token'
export const LANE_PERFIL_KEY = 'bar_lane_perfil'

export const POS_LOGIN_ID = '11111111-1111-4111-8111-111111111111'
export const STAFF_LOGIN_ID = '22222222-2222-4222-8222-222222222222'

export const WRITTEN_LOGINS = {
  pos: {
    lane: 'pos',
    email: 'pos@atomic.bar',
    password: 'PosOnly#2026',
    role: 'caixa',
    nome: 'Atomic POS',
  },
  gerente: {
    lane: 'gerente',
    email: 'umeokayudi@gmail.com',
    password: 'JbmVer#2026',
    role: 'cliente',
    nome: 'Gerente Atomic',
    via: 'supabase',
  },
  funcionario: {
    lane: 'funcionario',
    email: 'funcionario@atomic.bar',
    password: 'Funcionario#2026',
    role: 'bar_staff',
    nome: 'Funcionário Atomic',
    pin: '2468',
    salario_hora: 1500,
    cargo: 'Floor',
  },
  jbm: {
    lane: 'jbm',
    email: 'umeokagroup@gmail.com',
    password: 'JbmVer#2026',
    role: 'admin',
    nome: 'Alexandre Umeoka',
    via: 'supabase',
  },
}

function readStore(key) {
  try { return sessionStorage.getItem(key) || localStorage.getItem(key) || '' } catch { return '' }
}

export function readLaneToken() {
  return readStore(LANE_TOKEN_KEY)
}

export function readLanePerfil() {
  try {
    const raw = readStore(LANE_PERFIL_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** keep=true stores on this tablet (localStorage) so the till survives overnight. */
export function writeLaneSession(token, perfil, keep = false) {
  sessionStorage.setItem(LANE_TOKEN_KEY, token)
  sessionStorage.setItem(LANE_PERFIL_KEY, JSON.stringify(perfil))
  try {
    if (keep) {
      localStorage.setItem(LANE_TOKEN_KEY, token)
      localStorage.setItem(LANE_PERFIL_KEY, JSON.stringify(perfil))
    } else {
      localStorage.removeItem(LANE_TOKEN_KEY)
      localStorage.removeItem(LANE_PERFIL_KEY)
    }
  } catch {}
}

export function clearLaneSession() {
  try {
    sessionStorage.removeItem(LANE_TOKEN_KEY)
    sessionStorage.removeItem(LANE_PERFIL_KEY)
    localStorage.removeItem(LANE_TOKEN_KEY)
    localStorage.removeItem(LANE_PERFIL_KEY)
  } catch {}
}

export function isLaneEmail(email) {
  const e = String(email || '').trim().toLowerCase()
  return e === WRITTEN_LOGINS.pos.email || e === WRITTEN_LOGINS.funcionario.email
}
