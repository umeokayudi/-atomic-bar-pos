import { staffFetch } from './apiAuth'
import { isLocalDemo } from './supabase'

const TTL_MS = 45_000
const KEY = 'bar-team'
let mem = null
let at = 0
let inflight = null

function readStored() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && !parsed.error) return parsed
  } catch { /* ignore */ }
  return null
}

export function peekBarTeam() {
  if (mem) return mem
  const stored = readStored()
  if (stored) {
    mem = stored
    at = 0
  }
  return mem
}

export function invalidateBarTeam() {
  mem = null
  at = 0
  inflight = null
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}

async function readJsonBody(res) {
  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { error: 'unavailable', unavailable: true, status: res.status }
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return { error: 'unavailable', unavailable: true, status: res.status }
  }
}

export function loadBarTeam({ fresh } = {}) {
  if (isLocalDemo) {
    return Promise.resolve({ error: 'local-demo', unavailable: true })
  }
  if (!fresh && mem && Date.now() - at < TTL_MS) return Promise.resolve(mem)
  if (!fresh && inflight) return inflight
  inflight = staffFetch('/api/bar-staff')
    .then(readJsonBody)
    .then(j => {
      if (!j?.error) {
        mem = j
        at = Date.now()
        try { sessionStorage.setItem(KEY, JSON.stringify(j)) } catch { /* quota */ }
      }
      return j
    })
    .catch(() => ({ error: 'unavailable', unavailable: true }))
    .finally(() => { inflight = null })
  return inflight
}
