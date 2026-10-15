import { staffFetch } from './apiAuth'

/** People who can be marked on a sale (/api/bar-staff castRoster: name and ids only). null when unavailable. */
export async function fetchCastRoster() {
  try {
    const r = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'castRoster' }),
    })
    const j = await r.json()
    return r.ok && Array.isArray(j?.people) ? j.people : null
  } catch {
    return null
  }
}
