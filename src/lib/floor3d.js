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
