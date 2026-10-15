/**
 * May this punch go in? Pure: used by /api/time-clock.
 *
 * Punches live in a JSON file in Storage (live table `time_clock`). A serverless instance can read an older
 * copy of that file than the one that saved the clock-in a moment ago, so "last punch" seen by the server
 * may miss the open clock-in. That made clock-OUT fail with "Not clocked in" while clock-in always worked.
 * The phone sends the clock-in it is closing (id + time); when the server's copy is behind, that is enough.
 */

/** A shift left open this long is treated as forgotten: a new clock-in may start. */
export const STALE_OPEN_MS = 20 * 3600 * 1000
/** A clock-out may close a clock-in the server cannot see yet, if that clock-in is this recent. */
export const CLAIM_MAX_MS = 24 * 3600 * 1000

function ms(v) {
  const n = Date.parse(v || '')
  return Number.isFinite(n) ? n : null
}

/**
 * tipo: 'in' | 'out' · last: the newest punch the server sees for this person (or null)
 * claim: { id, at } the open clock-in the phone is closing (out only) · now: ms
 * → { ok, error?, inPunchId? }
 */
export function punchAllowed({ tipo, last = null, claim = null, now = Date.now() }) {
  const lastAt = ms(last?.punched_at)
  if (tipo === 'in') {
    if (last?.tipo === 'in' && lastAt != null && now - lastAt < STALE_OPEN_MS) return { ok: false, error: 'Already clocked in' }
    return { ok: true }
  }
  if (last?.tipo === 'in') return { ok: true, inPunchId: last.id || null }
  const claimAt = ms(claim?.at)
  if (claimAt != null && claimAt <= now + 60_000 && now - claimAt < CLAIM_MAX_MS && (lastAt == null || claimAt > lastAt)) {
    return { ok: true, inPunchId: claim.id ? String(claim.id).slice(0, 80) : null, recovered: true }
  }
  return { ok: false, error: 'Not clocked in' }
}
