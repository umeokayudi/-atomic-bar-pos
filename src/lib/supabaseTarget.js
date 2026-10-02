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

function productionKey(rawKey, drinksAnon) {
  if (!rawKey || /placeholder|SENSITIVE/i.test(rawKey) || rawKey.length < 80) return drinksAnon
  const ref = jwtRef(rawKey)
  if (ref && ref !== DRINKS_REF) return drinksAnon
  if (ref === DRINKS_REF) return rawKey
  return drinksAnon
}

/**
 * @returns {{ mode: 'remote' | 'local', url: string, key: string }}
 * production keeps the existing drinks fallback for the live deployment.
 * Every other channel, including an unidentified one, refuses both protected
 * projects and uses local demo storage unless an isolated URL and key are complete.
 */
export function resolveDataTarget({ channel, url, anonKey, drinksAnon = '' }) {
  const rawUrl = String(url || '').trim().replace(/\/$/, '')
  const rawKey = String(anonKey || '').trim()
  const locked = channel !== 'production'
  if (locked) {
    const urlOk = /^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(rawUrl) && !protectedRefIn(rawUrl)
    const keyRef = jwtRef(rawKey)
    const keyOk = Boolean(
      rawKey
      && !/placeholder|SENSITIVE/i.test(rawKey)
      && rawKey.length >= 80
      && !protectedRefIn(rawKey)
      && keyRef
      && !PROTECTED_REFS.includes(keyRef)
    )
    if (urlOk && keyOk) return { mode: 'remote', url: rawUrl, key: rawKey }
    return { mode: 'local', url: '', key: '' }
  }
  if (rawUrl.includes(DRINKS_REF)) {
    return { mode: 'remote', url: rawUrl, key: productionKey(rawKey, drinksAnon) }
  }
  return { mode: 'remote', url: DRINKS_URL, key: productionKey(rawKey, drinksAnon) }
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
}
