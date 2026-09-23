import { staffFetch } from './apiAuth'
import { getGlobalLang } from './i18n'
import { buildHqChatSystem as buildHqChatSystemBase, localHqAnswer as localHqAnswerBase } from './hqChat'
import { localHoursPay } from './timeClock'

export { localHoursPay }

export async function fetchHqSnapshot(month) {
  const q = month ? `?month=${encodeURIComponent(month)}` : ''
  const r = await staffFetch(`/api/bar/hq-sync${q}`)
  const j = await r.json().catch(() => ({ error: r.statusText }))
  if (!r.ok) throw new Error(j.error || 'HQ sync failed')
  return j
}

export async function saveHqRent({ amount, note, month_key }) {
  const r = await staffFetch('/api/bar/hq-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: month_key, rent: { amount, note, month_key } }),
  })
  const j = await r.json().catch(() => ({ error: r.statusText }))
  if (!r.ok) throw new Error(j.error || 'Rent save failed')
  return j
}

export function buildHqChatSystem(snapshot) {
  return buildHqChatSystemBase(snapshot, getGlobalLang())
}

export function localHqAnswer(question, snapshot) {
  return localHqAnswerBase(question, snapshot, getGlobalLang())
}
