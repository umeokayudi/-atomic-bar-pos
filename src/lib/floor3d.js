/** Geometry for the 3D floor view. Plan units are roughly centimetres. */

export const SEAT = 18

/** Seat positions around a table, in the table's own box (0..w, 0..d). Counters get seats on one side only. */
export function seatSpots(forma, w, d, n) {
  const count = Math.max(0, Math.min(16, Math.round(+n || 0)))
  if (!count) return []
  if (forma === 'bar') {
    return Array.from({ length: count }, (_, i) => ({ x: (w * (i + 0.5)) / count - SEAT / 2, y: d + 6 }))
  }
  const rx = w / 2 + 6
  const ry = d / 2 + 6
  return Array.from({ length: count }, (_, i) => {
    const a = (Math.PI * 2 * i) / count - Math.PI / 2
    return { x: w / 2 + Math.cos(a) * rx - SEAT / 2, y: d / 2 + Math.sin(a) * ry - SEAT / 2 }
  })
}

/** Axis-aligned box around every table (rotation and seats included), padded and kept inside the room. */
export function contentBounds(tables, W, D, pad = 40) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  for (const tb of tables || []) {
    const w = +tb.largura || 0
    const d = +tb.altura || 0
    const cx = +tb.x + w / 2
    const cy = +tb.y + d / 2
    const a = ((+tb.rotacao || 0) * Math.PI) / 180
    // Seats sit up to SEAT + 6 outside the table edge.
    const hw = w / 2 + SEAT + 6
    const hd = d / 2 + SEAT + 6
    const ex = Math.abs(hw * Math.cos(a)) + Math.abs(hd * Math.sin(a))
    const ey = Math.abs(hw * Math.sin(a)) + Math.abs(hd * Math.cos(a))
    x0 = Math.min(x0, cx - ex); x1 = Math.max(x1, cx + ex)
    y0 = Math.min(y0, cy - ey); y1 = Math.max(y1, cy + ey)
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: W, h: D }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad)
  x1 = Math.min(W, x1 + pad); y1 = Math.min(D, y1 + pad)
  if (x1 - x0 < 80 || y1 - y0 < 80) return { x: 0, y: 0, w: W, h: D }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Scale that makes a w×h floor, seen at `tilt`/`spin` degrees, fill a vw×vh stage. */
export function fitScale(vw, vh, w, h, tilt = 0, spin = 0) {
  const s = (spin * Math.PI) / 180
  const t = (tilt * Math.PI) / 180
  const pw = Math.abs(w * Math.cos(s)) + Math.abs(h * Math.sin(s))
  // Tilted floors look shorter, but walls and the near edge (perspective) need some room.
  const ph = (Math.abs(w * Math.sin(s)) + Math.abs(h * Math.cos(s))) * Math.cos(t) + 60 * Math.sin(t)
  const k = Math.min((vw - 24) / Math.max(1, pw * 0.98), (vh - 24) / Math.max(1, ph * 1.05))
  return Math.min(2.5, Math.max(0.12, k))
}

/** Small stable number in [0, 1) from a string, so the same guest always walks the same way. */
export function hash01(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}

const GUEST_COLORS = ['#e07a5f', '#3d8bd9', '#81b29a', '#f2cc8f', '#b56576', '#6d597a', '#43aa8b', '#f28482', '#577590', '#e9c46a']

/**
 * Guests drawn around a table: one per person on its open tabs, on its seats (more seats are added
 * when there are more guests than chairs). Each one mostly stays seated and now and then walks a
 * short loop away from the table and back. Positions are in the table's own box.
 */
export function guestSpots(tb, count) {
  const n = Math.max(0, Math.min(16, Math.round(+count || 0)))
  if (!n) return []
  const w = +tb.largura || 0
  const d = +tb.altura || 0
  const seats = seatSpots(tb.forma, w, d, Math.max(n, +tb.capacidade || 0))
  return seats.slice(0, n).map((s, i) => {
    const key = `${tb.id}:${i}`
    const r1 = hash01(key)
    const r2 = hash01(`${key}:b`)
    const r3 = hash01(`${key}:c`)
    const x = s.x + SEAT / 2
    const y = s.y + SEAT / 2
    let dx = x - w / 2
    let dy = y - d / 2
    const len = Math.hypot(dx, dy) || 1
    dx /= len; dy /= len
    const out = 70 + r1 * 90
    const side = (r2 - 0.5) * 120
    return {
      x, y,
      wx: Math.round(dx * out - dy * side),
      wy: Math.round(dy * out + dx * side),
      dur: Math.round(16 + r3 * 14),
      delay: -Math.round(r1 * 30),
      // About one in three guests is the restless kind; the others only stretch now and then.
      roam: r2 < 0.38,
      color: GUEST_COLORS[Math.floor(r3 * GUEST_COLORS.length)],
    }
  })
}
