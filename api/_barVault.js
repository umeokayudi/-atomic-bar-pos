import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { runLiveOp } from './_barLiveStore.js'

/**
 * Owner PIN for the bar's money and payroll screens.
 * The PIN is stored salted (scrypt) in the private live table `bar_locks`, never sent to the browser.
 * A right PIN returns a short-lived signed unlock token that the API checks before money/payroll writes.
 */

export const VAULT_AREAS = ['money', 'payroll']
export const VAULT_MINUTES = [5, 15, 30, 60, 240]
export const MAX_FAILS = 5
export const COOLDOWN_MS = 5 * 60 * 1000
export const UNLOCK_HEADER = 'x-bar-unlock'

// Registry kinds that are money (costs, card machines, tax); suppliers and partners are not.
export const MONEY_KINDS = new Set(['cartao', 'energia', 'aluguel', 'outro', 'fixo', 'variavel', 'contador', 'imposto'])
export const PAY_FIELDS = ['salario_hora', 'salario_mes', 'drink_back', 'comissao_pct']

let processKey = null
function signingKey() {
  const env = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.INTERNAL_API_SECRET
  if (env) return `bar-vault:${env}`
  if (!processKey) processKey = `bar-vault:${randomBytes(32).toString('hex')}`
  return processKey
}

export function validPin(pin) {
  return /^\d{4,8}$/.test(String(pin ?? ''))
}

export function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(pin), salt, 32).toString('hex') }
}

export function pinMatches(pin, row) {
  if (!validPin(pin) || !row?.pin_hash || !row?.pin_salt) return false
  const a = Buffer.from(hashPin(pin, row.pin_salt).hash, 'hex')
  const b = Buffer.from(String(row.pin_hash), 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function signUnlock({ barId, uid, minutes, now = Date.now() }) {
  const exp = now + Math.max(1, +minutes || 15) * 60000
  const body = Buffer.from(JSON.stringify({ b: barId, u: uid || '', exp })).toString('base64url')
  const sig = createHmac('sha256', signingKey()).update(body).digest('base64url')
  return { token: `vault1.${body}.${sig}`, exp }
}

export function verifyUnlock(token, { barId, uid, now = Date.now() } = {}) {
  const raw = String(token || '')
  if (!raw.startsWith('vault1.')) return null
  const [, body, sig] = raw.split('.')
  if (!body || !sig) return null
  const expect = createHmac('sha256', signingKey()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!p.exp || p.exp < now) return null
    if (p.b !== barId) return null
    if (uid && p.u && p.u !== uid) return null
    return p
  } catch {
    return null
  }
}

export async function loadLock(db, barId) {
  const r = await runLiveOp(db, {
    table: 'bar_locks',
    mode: 'select',
    columns: '*',
    filters: [{ op: 'eq', k: 'id', v: barId }],
    wantSingle: 'maybe',
  })
  return r.data || null
}

export async function saveLock(db, barId, row, exists) {
  return runLiveOp(db, {
    table: 'bar_locks',
    mode: exists ? 'update' : 'insert',
    filters: [{ op: 'eq', k: 'id', v: barId }],
    insertRows: [{ ...row, id: barId, bar_id: barId }],
    updatePatch: { ...row, id: barId, bar_id: barId },
    wantSingle: true,
  })
}

export function lockEnabled(row) {
  return !!(row?.pin_hash && (row.areas || []).length)
}

/** What the browser may know: never the hash or salt. */
export function publicLock(row) {
  return {
    enabled: lockEnabled(row),
    hasPin: !!row?.pin_hash,
    areas: lockEnabled(row) ? (row.areas || []).filter(a => VAULT_AREAS.includes(a)) : [],
    minutes: VAULT_MINUTES.includes(+row?.minutes) ? +row.minutes : 15,
  }
}

function headerOf(req) {
  const h = req.headers || {}
  return h[UNLOCK_HEADER] || h[UNLOCK_HEADER.toLowerCase()] || ''
}

/** True when the area is not locked, or the request carries a valid unlock token for this bar and user. */
export function areaOpen(req, row, area, { barId, uid } = {}) {
  if (!lockEnabled(row) || !(row.areas || []).includes(area)) return true
  return !!verifyUnlock(headerOf(req), { barId, uid })
}

export function cleanAreas(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(a => VAULT_AREAS.includes(a)))]
}

export function cleanMinutes(m) {
  return VAULT_MINUTES.includes(+m) ? +m : 15
}
