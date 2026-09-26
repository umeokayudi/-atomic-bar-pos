import { staffFetch } from './apiAuth'

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

export function loadBarTeam({ fresh } = {}) {
  if (!fresh && mem && Date.now() - at < TTL_MS) return Promise.resolve(mem)
  if (!fresh && inflight) return inflight
  inflight = staffFetch('/api/bar-staff')
    .then(r => r.json())
    .then(j => {
      if (!j?.error) {
        mem = j
        at = Date.now()
        try { sessionStorage.setItem(KEY, JSON.stringify(j)) } catch { /* quota */ }
      }
      return j
    })
    .finally(() => { inflight = null })
  return inflight
}
