import { staffFetch } from './apiAuth'
import { errText } from './errText'

export async function postClockMark({ barId, staffId, tipo, managerMark, nfcUid }) {
  const res = await staffFetch('/api/time-clock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nfcUid
      ? { tipo, nfc_uid: nfcUid, bar_id: barId }
      : { tipo, staff_id: staffId, managerMark: !!managerMark, bar_id: barId }),
  })
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { error: text.slice(0, 160) } }
  if (!res.ok) throw new Error(errText(json.error, json.message || `Clock failed (${res.status})`))
  return json
}
