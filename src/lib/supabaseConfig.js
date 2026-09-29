export const SUPABASE_CONFIG_ERROR = 'Supabase configuration missing'

export function jwtRef(raw) {
  try {
    const payload = JSON.parse(atob(String(raw).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.ref || ''
  } catch {
    return ''
  }
}

/** Public browser config. Missing or mismatched values are an error. Nothing is substituted. */
export function readSupabasePublicConfig(env = {}) {
  const url = String(env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '')
  const key = String(env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(url)) return { error: SUPABASE_CONFIG_ERROR }
  if (!key || key.length < 80 || /placeholder|SENSITIVE/i.test(key)) return { error: SUPABASE_CONFIG_ERROR }
  const ref = url.slice('https://'.length).split('.')[0]
  const keyRef = jwtRef(key)
  if (!keyRef || keyRef !== ref) return { error: SUPABASE_CONFIG_ERROR }
  return { url, key, ref }
}
