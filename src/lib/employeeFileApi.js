/** Private employee photo/contract calls (server writes to system-private; the screen gets short signed links). */
import { staffFetch } from './apiAuth'

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

/** Upload to the bar's private staff folder; returns the storage path to keep on the person. */
export async function uploadStaffFile({ file, kind, personId }) {
  const contentType = file.type || 'application/octet-stream'
  const data = await toBase64(file)
  const res = await staffFetch('/api/bar-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'uploadStaffFile', kind, personId, contentType, data }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Upload failed')
  return json.path
}

/** Short-lived links for private photos and contracts: { path: url }. */
export async function staffFileUrls(paths) {
  const list = [...new Set((paths || []).filter(Boolean))]
  if (!list.length) return {}
  const res = await staffFetch('/api/bar-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'staffFileUrls', paths: list }),
  })
  const json = await res.json().catch(() => ({}))
  return json.urls || {}
}
