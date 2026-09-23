import { createClient } from '@supabase/supabase-js'

export const DRINKS_SUPABASE_URL = 'https://ojirgkqtqvugqktyuhem.supabase.co'
export const DRINKS_PROJECT_REF = 'ojirgkqtqvugqktyuhem'
export const DRINKS_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qaXJna3F0cXZ1Z3FrdHl1aGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NTkwNTIsImV4cCI6MjA5NjEzNTA1Mn0.nRiZHav9wAY2HRKrO66W9HhY3R5wGZHMM8UH5W4PK_M'

function resolveDrinksUrl() {
  const raw = (process.env.VITE_SUPABASE_URL || '').trim()
  if (raw && raw !== '[SENSITIVE]' && raw.includes(DRINKS_PROJECT_REF)) {
    return raw.replace(/\/$/, '')
  }
  return DRINKS_SUPABASE_URL
}

function resolveAnonKey() {
  const raw = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (raw && raw !== '[SENSITIVE]' && raw.startsWith('eyJ') && raw.length >= 40) return raw
  return DRINKS_ANON_KEY
}

function serviceRoleProjectRef(key) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
    return payload.ref || null
  } catch {
    return null
  }
}

function resolveServiceRoleKey() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!key || key === '[SENSITIVE]') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. Add it in Vercel → Settings → Environment Variables (Supabase → Settings → API → service_role for ojirgkqtqvugqktyuhem).'
    )
  }
  const ref = serviceRoleProjectRef(key)
  if (ref && ref !== DRINKS_PROJECT_REF) {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY belongs to project "${ref}", expected "${DRINKS_PROJECT_REF}". Update Vercel env vars for bebidas-control.`
    )
  }
  return key
}

/** Valida JWT de staff — usa anon key do projeto Drinks (não service role). */
export function drinksAuthClient() {
  return createClient(resolveDrinksUrl(), resolveAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Queries com RLS usando o JWT do staff logado. */
export function createStaffUserClient(accessToken) {
  return createClient(resolveDrinksUrl(), resolveAnonKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Service-role client for JBM Drinks (bebidas-control). */
export function drinksAdminClient() {
  return createClient(resolveDrinksUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
