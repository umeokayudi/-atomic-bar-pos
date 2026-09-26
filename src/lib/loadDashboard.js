import { supabase } from './supabase'
import { errText } from './errText'

let dashMem = { at: 0, data: null }
const DASH_TTL_MS = 45_000

export function invalidateDashboard() {
  dashMem = { at: 0, data: null }
}

export async function loadDashboard({ fresh } = {}) {
  if (!fresh && dashMem.data && Date.now() - dashMem.at < DASH_TTL_MS) return dashMem.data

  let { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')

  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0
  if (expiresAt && expiresAt < Date.now() + 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    if (refreshed?.session?.access_token) session = refreshed.session
  }

  const res = await fetch('/api/dashboard', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(errText(err.error || err, `Dashboard API ${res.status}`))
  }
  const payload = await res.json()
  dashMem = { at: Date.now(), data: payload }
  return payload
}
