/** Client side of the day-close exceptions (/api/bar-staff) and the jump from the Close screen to a tab in the till. */
import { staffFetch } from './apiAuth'

async function post(body) {
  const r = await staffFetch('/api/bar-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code, left: j.left })
  return j
}

export async function listCloseExceptions(from) {
  const j = await post({ action: 'openTabsExceptions', from })
  return j.exceptions || []
}

export async function recordCloseException({ night, pin, reason, tabs }) {
  const j = await post({ action: 'openTabsException', night_key: night, pin, reason, tabs })
  return j.exception
}

export const OPEN_TAB_EVENT = 'jbm:open-tab'

/** Make the till open on this tab (read by PosQuick on mount, or live through the event when it is on screen). */
export function openTabInTill(barId, tabId) {
  try { localStorage.setItem(`pos-orders:${barId}:active`, JSON.stringify(`srv:${tabId}`)) } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: { barId, tabId } })) } catch { /* old browser */ }
}
