import { createHash, createHmac, timingSafeEqual } from 'crypto'

export function hashSecret(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}

export function secretsMatch(plain, hashed) {
  if (!plain || !hashed) return false
  const a = Buffer.from(hashSecret(plain))
  const b = Buffer.from(String(hashed))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function laneHmacKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.INTERNAL_API_SECRET || 'atomic-lane'
}

export function signLanePayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', laneHmacKey()).update(body).digest('base64url')
  return `lane:${body}.${sig}`
}

export function verifyLaneToken(token) {
  if (!token || !String(token).startsWith('lane:')) return null
  const rest = String(token).slice(5)
  const dot = rest.lastIndexOf('.')
  if (dot < 1) return null
  const body = rest.slice(0, dot)
  const sig = rest.slice(dot + 1)
  if (!body || !sig) return null
  const expect = createHmac('sha256', laneHmacKey()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (payload.exp && payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function randomTabletCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}
