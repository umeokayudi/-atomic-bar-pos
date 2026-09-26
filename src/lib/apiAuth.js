import { supabase } from './supabase'
import { readLaneToken } from './barLanes'

/** Headers com Bearer do staff logado para APIs /api/* protegidas. */
export async function staffAuthHeaders(extra = {}) {
  const headers = { ...extra }
  const lane = readLaneToken()
  if (lane) {
    headers.Authorization = `Bearer ${lane}`
    return headers
  }
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
  }
  return headers
}

export async function staffFetch(url, options = {}) {
  const headers = await staffAuthHeaders(options.headers || {})
  return fetch(url, { ...options, headers })
}
