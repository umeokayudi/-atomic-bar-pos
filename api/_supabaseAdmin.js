import { createClient } from '@supabase/supabase-js'

export const SUPABASE_CONFIG_ERROR = 'Supabase configuration missing'

function jwtRef(raw) {
  try {
    const payload = JSON.parse(Buffer.from(String(raw).split('.')[1], 'base64url').toString())
    return payload.ref || ''
  } catch {
    return ''
  }
}

function explicitSupabaseUrl(raw) {
  const url = String(raw || '').trim().replace(/\/$/, '')
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(url)) return ''
  return url
}

/** Browser project from env. Throws when the URL or anon key is missing or they disagree. */
export function readSupabaseServerConfig() {
  const url = explicitSupabaseUrl(process.env.VITE_SUPABASE_URL)
  const anon = String(process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!url) throw new Error(SUPABASE_CONFIG_ERROR)
  const ref = url.slice('https://'.length).split('.')[0]
  if (!anon || anon.length < 80 || /placeholder|SENSITIVE/i.test(anon) || jwtRef(anon) !== ref) {
    throw new Error(SUPABASE_CONFIG_ERROR)
  }
  return { url, anon, ref }
}

/** Holding project from env. Empty when unset. No project is assumed. */
export function holdingUrlFromEnv() {
  return explicitSupabaseUrl(process.env.HOLDING_SUPABASE_URL)
}

function resolveServiceRoleKey(ref) {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!key || key === '[SENSITIVE]') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.')
  }
  const keyRef = jwtRef(key)
  if (keyRef && keyRef !== ref) {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY belongs to project "${keyRef}", expected "${ref}".`)
  }
  return key
}

/** Valida JWT de staff — usa a anon key do projeto configurado (não service role). */
export function drinksAuthClient() {
  const { url, anon } = readSupabaseServerConfig()
  return createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Queries com RLS usando o JWT do staff logado. */
export function createStaffUserClient(accessToken) {
  const { url, anon } = readSupabaseServerConfig()
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Service-role client. Throws if the key is missing or belongs to another project. */
export function drinksAdminClient() {
  const { url, ref } = readSupabaseServerConfig()
  return createClient(url, resolveServiceRoleKey(ref), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function tryDrinksAdminClient() {
  try {
    return drinksAdminClient()
  } catch {
    return null
  }
}
