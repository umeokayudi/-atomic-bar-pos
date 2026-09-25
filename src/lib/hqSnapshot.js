import { staffFetch } from './apiAuth'
import { getGlobalLang } from './i18n'
import { buildHqChatSystem as buildHqChatSystemBase, localHqAnswer as localHqAnswerBase } from './hqChat'
import { localHoursPay } from './timeClock'
import { errText } from './errText'

export { localHoursPay }

const HQ_TTL_MS = 45_000
const hqCache = new Map()
const hqInflight = new Map()

function hqKey(month, full) {
  return `${month || ''}:${full ? 'full' : 'lite'}`
}

function readStoredHq(key) {
  try {
    const raw = sessionStorage.getItem(`hq-snap:${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.data?.books) return parsed
    if (parsed?.books) return { at: 0, data: parsed }
  } catch { /* private mode or old payload */ }
  return null
}

export function peekHqSnapshot(month, { full } = {}) {
  const key = hqKey(month, full)
  const hit = hqCache.get(key)
  if (hit?.data) return hit.data
  const stored = readStoredHq(key)
  if (stored?.data) {
    hqCache.set(key, stored)
    return stored.data
  }
  return null
}

export function invalidateHqSnapshot() {
  hqCache.clear()
  hqInflight.clear()
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith('hq-snap:')) sessionStorage.removeItem(k)
    }
  } catch { /* ignore */ }
}

export async function fetchHqSnapshot(month, { fresh, full } = {}) {
  const key = hqKey(month, full)
  const hit = hqCache.get(key)
  if (!fresh && hit?.data && Date.now() - hit.at < HQ_TTL_MS) return hit.data
  if (!fresh && hqInflight.has(key)) return hqInflight.get(key)

  const params = new URLSearchParams()
  if (month) params.set('month', month)
  if (!full) params.set('lite', '1')
  const q = params.toString() ? `?${params}` : ''
  const job = staffFetch(`/api/bar/hq-sync${q}`)
    .then(r => r.json().catch(() => ({ error: r.statusText })).then(j => {
      if (!r.ok || j.error || !j.books) throw new Error(errText(j.error || j, 'HQ sync failed'))
      const stamped = { at: Date.now(), data: j }
      hqCache.set(key, stamped)
      const write = () => {
        try { sessionStorage.setItem(`hq-snap:${key}`, JSON.stringify(stamped)) } catch { /* quota */ }
      }
      if (typeof requestIdleCallback === 'function') requestIdleCallback(write)
      else setTimeout(write, 0)
      return j
    }))
    .finally(() => hqInflight.delete(key))
  hqInflight.set(key, job)
  return job
}

export async function saveHqRent({ amount, note, month_key }) {
  const r = await staffFetch('/api/bar/hq-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: month_key, rent: { amount, note, month_key } }),
  })
  const j = await r.json().catch(() => ({ error: r.statusText }))
  if (!r.ok || j.error) throw new Error(errText(j.error || j, 'Rent save failed'))
  invalidateHqSnapshot()
  return j
}

export async function saveBarCost(cost) {
  const r = await staffFetch('/api/bar/hq-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: cost.month_key, cost }),
  })
  const j = await r.json().catch(() => ({ error: r.statusText }))
  if (!r.ok || j.error) throw new Error(errText(j.error || j, 'Cost save failed'))
  invalidateHqSnapshot()
  return j
}

export function buildHqChatSystem(snapshot) {
  return buildHqChatSystemBase(snapshot, getGlobalLang())
}

export function localHqAnswer(question, snapshot) {
  return localHqAnswerBase(question, snapshot, getGlobalLang())
}
