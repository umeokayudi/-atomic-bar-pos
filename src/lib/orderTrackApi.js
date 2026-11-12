import { staffAuthHeaders } from './apiAuth'

const URL = '/api/bar/order-track'

async function call(method, { query = '', body } = {}) {
  const headers = await staffAuthHeaders(body ? { 'Content-Type': 'application/json' } : {})
  const r = await fetch(`${URL}${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let json = null
  try { json = await r.json() } catch { json = null }
  if (!r.ok) {
    const err = new Error(json?.error || `order-track ${r.status}`)
    err.code = json?.code || r.status
    throw err
  }
  return json || {}
}

/** Track rows by order id: { [pedidoId]: row }. Never throws (an older deploy without the route → {}). */
export async function loadTracks({ bar, ids } = {}) {
  try {
    const qs = new URLSearchParams()
    if (bar) qs.set('bar', bar)
    if (ids?.length) qs.set('ids', ids.join(','))
    const { rows } = await call('GET', { query: `?${qs}` })
    return Object.fromEntries((rows || []).map(r => [r.id, r]))
  } catch {
    return {}
  }
}

export const ensureTracks = () => call('POST', { body: { action: 'ensure' } })
export const saveTrack = (id, patch, extra = {}) => call('POST', { body: { action: 'save', id, patch, ...extra } })
export const setTrackStatus = (id, status, { nota, recebido_por } = {}) => call('POST', { body: { action: 'status', id, status, nota, recebido_por } })
export const receiveOrder = (id, { linhas, responsavel, nota }) => call('POST', { body: { action: 'receive', id, linhas, responsavel, nota } })
