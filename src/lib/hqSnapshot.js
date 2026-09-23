import { staffFetch } from './apiAuth'
import { getGlobalLang } from './i18n'
import { buildHqChatSystem as buildHqChatSystemBase, localHqAnswer as localHqAnswerBase } from './hqChat'
import { localHoursPay } from './timeClock'
import { errText } from './errText'

export { localHoursPay }

const HQ_TTL_MS = 120_000
const hqCache = new Map()

export function invalidateHqSnapshot() {
  hqCache.clear()
}

export async function fetchHqSnapshot(month, { fresh } = {}) {
  const key = month || ''
  const hit = hqCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < HQ_TTL_MS) return hit.data

  const q = month ? `?month=${encodeURIComponent(month)}` : ''
  const r = await staffFetch(`/api/bar/hq-sync${q}`)
  const j = await r.json().catch(() => ({ error: r.statusText }))
  if (!r.ok || j.error || !j.books) throw new Error(errText(j.error || j, 'HQ sync failed'))
  hqCache.set(key, { at: Date.now(), data: j })
  return j
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
