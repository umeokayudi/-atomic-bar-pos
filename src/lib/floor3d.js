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

const SIZED = new Set(['round', 'square', 'rect'])

/**
 * How many plan units make one centimetre, guessed from the tables: a table for 2-6 people is about
 * 80 cm across on its short side. Plans drawn at 1 unit = 1 cm give ~1; plans drawn smaller give less.
 * Everything that has no size in the plan (heights, people, eye level, walking speed) uses this, so
 * walls, tables and guests keep real proportions whatever scale the plan was drawn at.
 */
export function unitsPerCm(tables) {
  const sides = (tables || [])
    .filter(tb => SIZED.has(tb.forma) && tb.ativo !== false && (+tb.capacidade || 0) > 0)
    .map(tb => Math.min(+tb.largura || 0, +tb.altura || 0))
    .filter(v => v > 0)
    .sort((a, b) => a - b)
  if (!sides.length) return 1
  const median = sides[Math.floor(sides.length / 2)]
  return Math.min(3, Math.max(0.3, median / 80))
}

/** Plan rectangle of a piece, rotation applied (axis-aligned box around it). */
function rectOf(tb) {
  const w = +tb.largura || 0
  const d = +tb.altura || 0
  const a = ((+tb.rotacao || 0) * Math.PI) / 180
  const ex = (Math.abs(w * Math.cos(a)) + Math.abs(d * Math.sin(a))) / 2
  const ey = (Math.abs(w * Math.sin(a)) + Math.abs(d * Math.cos(a))) / 2
  const cx = +tb.x + w / 2
  const cy = +tb.y + d / 2
  return { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey }
}

/** Pieces a person cannot walk through: walls, counters, tables, sofas, rooms and the like (not doors). */
export function obstacles(tables) {
  return (tables || []).filter(tb => tb.ativo !== false && tb.forma !== 'door').map(rectOf)
}

/** Walls only: what the walking camera bumps into. */
export function wallRects(tables) {
  return (tables || []).filter(tb => tb.ativo !== false && tb.forma === 'wall').map(rectOf)
}

/** True when a body of radius r at (x, y) would overlap any rectangle. */
export function hits(rects, x, y, r = 0) {
  for (const q of rects) {
    if (x > q.x0 - r && x < q.x1 + r && y > q.y0 - r && y < q.y1 + r) return true
  }
  return false
}

/**
 * Where to stand when walking in: the open floor spot with the most room around it (searched on a
 * grid inside the area), facing the middle of the tables. Yaw 0 looks toward plan -y.
 */
export function standSpot(tables, area, k = 1) {
  // Tables count with their chairs and the people around them.
  const solid = obstacles(tables).map((q, i) => {
    const tb = (tables || []).filter(x => x.ativo !== false && x.forma !== 'door')[i]
    const pad = SIZED.has(tb.forma) || tb.forma === 'bar' ? SEAT + 6 + 30 * k : 0
    return { x0: q.x0 - pad, y0: q.y0 - pad, x1: q.x1 + pad, y1: q.y1 + pad }
  })
  const seats = (tables || []).filter(tb => tb.ativo !== false && SIZED.has(tb.forma))
  const look = seats.length
    ? seats.reduce((a, tb) => ({ x: a.x + (+tb.x + (+tb.largura || 0) / 2) / seats.length, y: a.y + (+tb.y + (+tb.altura || 0) / 2) / seats.length }), { x: 0, y: 0 })
    : { x: area.x + area.w / 2, y: area.y + area.h / 2 }
  const step = Math.max(10, Math.min(area.w, area.h) / 24)
  const cap = 160 * k
  let best = null
  for (let y = area.y + step / 2; y < area.y + area.h; y += step) {
    for (let x = area.x + step / 2; x < area.x + area.w; x += step) {
      if (hits(solid, x, y, 25 * k)) continue
      let room = cap
      for (const q of solid) {
        const dx = Math.max(q.x0 - x, 0, x - q.x1)
        const dy = Math.max(q.y0 - y, 0, y - q.y1)
        room = Math.min(room, Math.hypot(dx, dy))
      }
      room = Math.min(room, x - area.x, area.x + area.w - x, y - area.y, area.y + area.h - y)
      // Plenty of room first, then the spot that sees the tables from a bit further back.
      const far = Math.hypot(x - look.x, y - look.y)
      const score = Math.min(room, cap) + Math.min(far, 400 * k) * 0.15
      if (!best || score > best.score) best = { x, y, score }
    }
  }
  const at = best || { x: area.x + area.w / 2, y: area.y + area.h / 2 }
  const dx = look.x - at.x
  const dy = look.y - at.y
  const yaw = Math.hypot(dx, dy) < 1 ? 0 : (Math.atan2(-dx, -dy) * 180) / Math.PI
  return { x: at.x, y: at.y, yaw }
}

/**
 * Walls with the doors cut out of them. A door drawn over a wall opens a gap along the wall's long
 * side, so the 3D view shows a doorway and a person can walk through it. Rotated walls stay whole.
 * Returns plan rectangles {x, y, w, h, id}.
 */
export function wallPieces(tables) {
  const on = (tables || []).filter(tb => tb.ativo !== false)
  const doors = on.filter(tb => tb.forma === 'door').map(rectOf)
  const out = []
  for (const tb of on) {
    if (tb.forma !== 'wall') continue
    const x = +tb.x; const y = +tb.y; const w = +tb.largura || 0; const h = +tb.altura || 0
    if (+tb.rotacao) { out.push({ id: tb.id, x, y, w, h, rot: +tb.rotacao, cor: tb.cor }); continue }
    const along = w >= h
    let spans = [[along ? x : y, along ? x + w : y + h]]
    for (const d of doors) {
      // The door must cross the wall's thickness, not just touch its end.
      const crosses = along ? d.y0 < y + h && d.y1 > y : d.x0 < x + w && d.x1 > x
      if (!crosses) continue
      const [c0, c1] = along ? [d.x0, d.x1] : [d.y0, d.y1]
      spans = spans.flatMap(([a, b]) => (c1 <= a || c0 >= b ? [[a, b]] : [[a, c0], [c1, b]].filter(([p, q]) => q - p > 1)))
    }
    spans.forEach(([a, b], i) => out.push(along
      ? { id: `${tb.id}:${i}`, x: a, y, w: b - a, h, cor: tb.cor }
      : { id: `${tb.id}:${i}`, x, y: a, w, h: b - a, cor: tb.cor }))
  }
  return out
}

/** Plan rectangles {x0, y0, x1, y1} for wall pieces (doorways left open). */
export function pieceRects(pieces) {
  return pieces.map(p => rectOf({ x: p.x, y: p.y, largura: p.w, altura: p.h, rotacao: p.rot || 0 }))
}

/** True when the straight walk from a to b stays clear of every rectangle (checked in short steps). */
export function clearPath(rects, a, b, r = 0) {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    if (hits(rects, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r)) return false
  }
  return true
}

/** A point in a table's own box turned into plan coordinates (the box turns about its centre). */
export function toPlan(tb, p) {
  const w = +tb.largura || 0
  const d = +tb.altura || 0
  const a = ((+tb.rotacao || 0) * Math.PI) / 180
  const dx = p.x - w / 2
  const dy = p.y - d / 2
  return { x: +tb.x + w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: +tb.y + d / 2 + dx * Math.sin(a) + dy * Math.cos(a) }
}

/**
 * Keeps each guest's little walk inside the room: the walk (a plan vector, given in the table's own
 * box) is tried as is, then shorter, then turned; if no way is clear the guest stays at the seat.
 */
export function safeWalks(tb, guests, rects, k = 1) {
  const a = ((+tb.rotacao || 0) * Math.PI) / 180
  const r = 20 * k
  return guests.map(g => {
    const from = toPlan(tb, g)
    for (const turn of [0, 90, -90, 180]) {
      for (const len of [1, 0.6, 0.35]) {
        const t = (turn * Math.PI) / 180
        const lx = (g.wx * Math.cos(t) - g.wy * Math.sin(t)) * len * k
        const ly = (g.wx * Math.sin(t) + g.wy * Math.cos(t)) * len * k
        // The walk is drawn inside the turned table box; turn it into plan space to test it.
        const px = lx * Math.cos(a) - ly * Math.sin(a)
        const py = lx * Math.sin(a) + ly * Math.cos(a)
        if (clearPath(rects, from, { x: from.x + px, y: from.y + py }, r)) return { ...g, wx: Math.round(lx), wy: Math.round(ly) }
      }
    }
    return { ...g, wx: 0, wy: 0, roam: false }
  })
}
