import { createClient } from '@supabase/supabase-js'
import { classifySupabaseTarget } from './supabaseGuard.js'

const target = classifySupabaseTarget(import.meta.env)
export const BAR_ID = import.meta.env.VITE_BAR_ID
export const supabaseBlockedRef = target.blockedRef || ''

if (target.mode === 'blocked') {
  throw new Error(`Refusing protected Supabase project ${target.blockedRef}`)
}

export const supabase = createClient(
  target.mode === 'remote' ? target.url : '',
  target.mode === 'remote' ? target.key : '',
  { realtime: { params: { eventsPerSecond: 10 } } },
)
