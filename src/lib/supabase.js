import { createClient } from '@supabase/supabase-js'
import { wrapBarLive } from './barLiveClient'
import { readSupabasePublicConfig, SUPABASE_CONFIG_ERROR } from './supabaseConfig.js'

export { readSupabasePublicConfig, SUPABASE_CONFIG_ERROR }

const viteEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
const config = readSupabasePublicConfig(viteEnv)

export const supabaseConfigError = config.error || ''
const projectRef = config.ref || ''

function unavailableClient() {
  const error = { message: SUPABASE_CONFIG_ERROR }
  const rejected = () => Promise.resolve({ data: null, error })
  const chain = () => new Proxy(rejected, { get: () => chain, apply: () => rejected() })
  return {
    auth: {
      getSession: rejected,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: rejected,
      signOut: rejected,
      resetPasswordForEmail: rejected,
      updateUser: rejected,
      signUp: rejected,
    },
    from: chain,
    rpc: rejected,
  }
}

const rawSupabase = config.error
  ? unavailableClient()
  : createClient(config.url, config.key, {
    auth: {
      storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
      storageKey: `sb-${projectRef}-auth-token`,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })

export const drinksAuth = rawSupabase
export const supabase = config.error ? rawSupabase : wrapBarLive(rawSupabase)
