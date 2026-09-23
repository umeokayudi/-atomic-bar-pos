import { supabase } from './supabase'

export async function loadDashboard() {
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
    throw new Error(err.error || `Dashboard API ${res.status}`)
  }
  return res.json()
}
