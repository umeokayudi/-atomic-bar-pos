import { createClient } from '@supabase/supabase-js'
import { wrapBarLive } from './barLiveClient'

const DEFAULT_URL = 'https://ojirgkqtqvugqktyuhem.supabase.co'
const DEFAULT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qaXJna3F0cXZ1Z3FrdHl1aGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NTkwNTIsImV4cCI6MjA5NjEzNTA1Mn0.nRiZHav9wAY2HRKrO66W9HhY3R5wGZHMM8UH5W4PK_M'

function resolveSupabaseUrl(raw) {
  return /^https:\/\/[a-z0-9]+\.supabase\.co/i.test(raw || '') ? raw : DEFAULT_URL
}

function resolveAnonKey(raw) {
  if (!raw || raw === '[SENSITIVE]' || raw.length < 40) return DEFAULT_ANON
  return raw
}

const supabaseUrl = resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const supabaseKey = resolveAnonKey(import.meta.env.VITE_SUPABASE_ANON_KEY)

const TAB_ID_KEY = 'bebidas_tab_id'

/** ID único por aba — evita compartilhar login entre abas */
function getTabId() {
  if (typeof sessionStorage === 'undefined') return 'ssr'
  let id = sessionStorage.getItem(TAB_ID_KEY)
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    sessionStorage.setItem(TAB_ID_KEY, id)
  }
  return id
}

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] || 'supabase'

const rawSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // sessionStorage = isolado por aba (localStorage é compartilhado)
    storage: typeof sessionStorage !== 'undefined' ? sessionStorage : undefined,
    // storageKey único por aba = BroadcastChannel não sincroniza entre abas
    storageKey: `sb-${projectRef}-auth-${getTabId()}`,
    persistSession: true,
    autoRefreshToken: true,
  },
})

export const supabase = wrapBarLive(rawSupabase)
