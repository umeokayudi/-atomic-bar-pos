import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const SCRYPT_PREFIX = 'scrypt$'

/** Unsalted SHA-256: only to check hashes saved before the switch to scrypt. */
function legacyHash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}

/** Salted scrypt hash, stored as `scrypt$<salt hex>$<hash hex>`. */
export function hashSecret(value) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(value || ''), salt, 32)
  return `${SCRYPT_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`
}

/** Checks a plain secret against a scrypt hash, or against an old unsalted SHA-256 one. */
export function secretsMatch(plain, hashed) {
  if (!plain || !hashed) return false
  const stored = String(hashed)
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [saltHex, hashHex] = stored.slice(SCRYPT_PREFIX.length).split('$')
    if (!saltHex || !hashHex) return false
    const expect = Buffer.from(hashHex, 'hex')
    const got = scryptSync(String(plain), Buffer.from(saltHex, 'hex'), expect.length)
    return got.length === expect.length && timingSafeEqual(got, expect)
  }
  const a = Buffer.from(legacyHash(plain))
  const b = Buffer.from(stored)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Passwords that were published in this repository: a login still using one is refused. */
const BURNED_SECRETS = ['PosOnly#2026', 'Funcionario#2026']

export function isBurnedSecret(plain) {
  return BURNED_SECRETS.includes(String(plain || ''))
}

/** No fixed fallback: without a server secret, lane tokens are neither issued nor accepted. */
function laneHmacKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.INTERNAL_API_SECRET || null
}

export function signLanePayload(payload) {
  if (!laneHmacKey()) throw new Error('Server is missing SUPABASE_SERVICE_ROLE_KEY')
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
  if (!body || !sig || !laneHmacKey()) return null
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
  const bytes = randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[bytes[i] % chars.length]
  return s
}
