import { createClient } from '@supabase/supabase-js'
import { wrapBarLive } from './barLiveClient'
import { createLocalDemoClient } from './localDemoClient'
import { resolveDataTarget } from './supabaseTarget'

const channel = import.meta.env.VITE_DEPLOY_CHANNEL || 'development'

// The live drinks key stays inside the production branch so a Preview bundle can drop it.
const drinksAnon = import.meta.env.VITE_DEPLOY_CHANNEL === 'production'
  ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qaXJna3F0cXZ1Z3FrdHl1aGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NTkwNTIsImV4cCI6MjA5NjEzNTA1Mn0.nRiZHav9wAY2HRKrO66W9HhY3R5wGZHMM8UH5W4PK_M'
  : ''

const target = resolveDataTarget({
  channel,
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  drinksAnon,
  stagingAuthorized: import.meta.env.VITE_ATOMIC_STAGING_AUTHORIZED === '1',
})

export const dataMode = target.mode
export const isLocalDemo = target.mode === 'local'

const TAB_ID_KEY = 'bebidas_tab_id'

function getTabId() {
  if (typeof sessionStorage === 'undefined') return 'ssr'
  let id = sessionStorage.getItem(TAB_ID_KEY)
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    sessionStorage.setItem(TAB_ID_KEY, id)
  }
  return id
}

function remoteClient() {
  const projectRef = target.url.match(/https:\/\/([^.]+)/)?.[1] || 'remote'
  return createClient(target.url, target.key, {
    auth: {
      storage: typeof sessionStorage !== 'undefined' ? sessionStorage : undefined,
      storageKey: `sb-${projectRef}-auth-${getTabId()}`,
      persistSession: true,
      autoRefreshToken: true,
    },
  })
}

const rawSupabase = isLocalDemo ? createLocalDemoClient() : remoteClient()

export const drinksAuth = rawSupabase
export const supabase = wrapBarLive(rawSupabase)
