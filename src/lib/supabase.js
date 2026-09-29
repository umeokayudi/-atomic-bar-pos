import { createClient } from '@supabase/supabase-js'
import { wrapBarLive } from './barLiveClient'

/** Always the Drinks project. Vercel of atomic-bar-pos often injects a placeholder or Holding key. */
export const DRINKS_REF = 'ojirgkqtqvugqktyuhem'
export const DRINKS_URL = `https://${DRINKS_REF}.supabase.co`
export const DRINKS_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qaXJna3F0cXZ1Z3FrdHl1aGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NTkwNTIsImV4cCI6MjA5NjEzNTA1Mn0.nRiZHav9wAY2HRKrO66W9HhY3R5wGZHMM8UH5W4PK_M'

function jwtRef(raw) {
  try {
    const payload = JSON.parse(atob(String(raw).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.ref || ''
  } catch {
    return ''
  }
}

function resolveSupabaseUrl(raw) {
  const v = String(raw || '').trim()
  if (v.includes(DRINKS_REF)) return v.replace(/\/$/, '')
  return DRINKS_URL
}

function resolveAnonKey(raw) {
  const v = String(raw || '').trim()
  if (!v || /placeholder|SENSITIVE/i.test(v) || v.length < 80) return DRINKS_ANON
  if (jwtRef(v) && jwtRef(v) !== DRINKS_REF) return DRINKS_ANON
  if (jwtRef(v) === DRINKS_REF) return v
  return DRINKS_ANON
}

const supabaseUrl = resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const supabaseKey = resolveAnonKey(import.meta.env.VITE_SUPABASE_ANON_KEY)

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] || DRINKS_REF

const rawSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    storageKey: `sb-${projectRef}-auth-token`,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export const drinksAuth = rawSupabase
export const supabase = wrapBarLive(rawSupabase)
