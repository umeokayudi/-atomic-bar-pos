/** Decide which database a build may use. Preview never falls back to production. */

export const PROTECTED_REFS = ['ojirgkqtqvugqktyuhem', 'fxsakrshmldmkdmbevna']
export const DRINKS_REF = PROTECTED_REFS[0]
export const DRINKS_URL = `https://${DRINKS_REF}.supabase.co`

export function jwtRef(raw) {
  try {
    const part = String(raw || '').split('.')[1]
    if (!part) return ''
    const pad = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = typeof atob === 'function'
      ? atob(pad)
      : Buffer.from(part, 'base64url').toString()
    const payload = JSON.parse(json)
    return payload.ref || ''
  } catch {
    return ''
  }
}

export function protectedRefIn(value) {
  const raw = String(value || '')
  return PROTECTED_REFS.find(ref => raw.includes(ref)) || ''
}

export const RUNTIME = {
  LOCAL_DEMO: 'LOCAL_DEMO',
  STAGING: 'STAGING',
  PRODUCTION: 'PRODUCTION',
}

function hostRef(url) {
  return (String(url || '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i) || [])[1] || ''
}

/**
 * LOCAL_DEMO never receives the drinks URL.
 * STAGING requires preview, a matching isolated URL and key, and an explicit authorization flag.
 * PRODUCTION is only the explicit production channel outside preview and development.
 */
export function classifyRuntime({
  channel = '',
  serverEnv = '',
  url = '',
  anonKey = '',
  stagingAuthorized = false,
} = {}) {
  const rawUrl = String(url || '').trim().replace(/\/$/, '')
  const rawKey = String(anonKey || '').trim()
  const ref = hostRef(rawUrl)
  const keyRef = jwtRef(rawKey)
  const authorized = stagingAuthorized === true || String(stagingAuthorized || '') === '1'
  const productionChannel = channel === 'production'
  const nonProductionServer = serverEnv === 'preview' || serverEnv === 'development'
  if (productionChannel && !nonProductionServer) {
    return { runtime: RUNTIME.PRODUCTION, blockers: [] }
  }

  const blockers = []
  if (!channel && !serverEnv) blockers.push('The environment is unidentified.')
  if (productionChannel && nonProductionServer) blockers.push('Production channel is set on a non-production environment.')
  const preview = channel === 'preview' || serverEnv === 'preview'
  if (!preview) blockers.push('The environment is not preview.')
  if (!rawUrl) blockers.push('The Supabase URL is missing.')
  else if (protectedRefIn(rawUrl)) blockers.push('The target is a protected production project.')
  else if (!ref) blockers.push('The Supabase URL is not a project host.')
  if (!rawKey || rawKey.length < 80 || /placeholder|SENSITIVE/i.test(rawKey) || protectedRefIn(rawKey)) {
    blockers.push('The anon key is missing or incomplete.')
  } else if (!keyRef || PROTECTED_REFS.includes(keyRef)) {
    blockers.push('The anon key is not an isolated project key.')
  } else if (ref && keyRef !== ref) {
    blockers.push('The anon key does not match the Supabase URL.')
  }
  if (!authorized) blockers.push('Staging authorization is not set.')
  if (blockers.length) return { runtime: RUNTIME.LOCAL_DEMO, blockers }
  return { runtime: RUNTIME.STAGING, blockers: [] }
}

function productionKey(rawKey, drinksAnon) {
  if (!rawKey || /placeholder|SENSITIVE/i.test(rawKey) || rawKey.length < 80) return drinksAnon
  const ref = jwtRef(rawKey)
  if (ref && ref !== DRINKS_REF) return drinksAnon
  if (ref === DRINKS_REF) return rawKey
  return drinksAnon
}

/**
 * @returns {{ mode: 'remote' | 'local', runtime: 'LOCAL_DEMO' | 'STAGING' | 'PRODUCTION', url: string, key: string }}
 * production keeps the existing drinks fallback for the live deployment.
 * Preview stays local until staging is explicitly authorized.
 * Development and unidentified channels stay on the local demo.
 */
export function resolveDataTarget({ channel, url, anonKey, drinksAnon = '', stagingAuthorized = false, serverEnv = '' }) {
  const rawUrl = String(url || '').trim().replace(/\/$/, '')
  const rawKey = String(anonKey || '').trim()
  const decision = classifyRuntime({ channel, serverEnv, url: rawUrl, anonKey: rawKey, stagingAuthorized })
  if (decision.runtime === RUNTIME.STAGING) {
    return { mode: 'remote', runtime: RUNTIME.STAGING, url: rawUrl, key: rawKey }
  }
  if (decision.runtime !== RUNTIME.PRODUCTION) {
    return { mode: 'local', runtime: RUNTIME.LOCAL_DEMO, url: '', key: '' }
  }
  if (rawUrl.includes(DRINKS_REF)) {
    return { mode: 'remote', runtime: RUNTIME.PRODUCTION, url: rawUrl, key: productionKey(rawKey, drinksAnon) }
  }
  return { mode: 'remote', runtime: RUNTIME.PRODUCTION, url: DRINKS_URL, key: productionKey(rawKey, drinksAnon) }
}

/** Server-side gate. Only an explicit production process may open a protected project. */
export function assertServerMayConnect(url) {
  const env = process.env.VERCEL_ENV
  if (env === 'production') return
  const value = String(url || '')
  if (env !== 'preview') {
    const err = new Error('Operational database access is refused. The server environment is not an authorized isolated staging project.')
    err.code = 'STAGING_REQUIRED'
    throw err
  }
  if (!value || protectedRefIn(value)) {
    const err = new Error('Preview refuses protected Supabase projects')
    err.code = 'PREVIEW_PROTECTED'
    throw err
  }
  if (String(process.env.ATOMIC_STAGING_AUTHORIZED || '') !== '1') {
    const err = new Error('Preview refuses operational access until ATOMIC_STAGING_AUTHORIZED=1.')
    err.code = 'STAGING_REQUIRED'
    throw err
  }
}
