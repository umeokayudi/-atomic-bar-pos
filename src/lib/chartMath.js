/** Number helpers for the chart kit (plain JS so tests can import them). */

/** Rounded "nice" ceiling so the axis reads 0 / 25k / 50k / 75k / 100k. */
export function niceMax(v) {
  if (!(v > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * p
}

/** Short axis numbers: 1200 → 1.2k, 2500000 → 2.5M. */
export function shortNum(v) {
  const a = Math.abs(v)
  if (a >= 1e6) return `${+(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${+(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`
  return `${Math.round(v)}`
}

/** Change vs the previous period: "+12% vs last month". Returns null when not comparable. */
export function deltaPct(cur, prev) {
  if (!(prev > 0) || cur == null) return null
  return Math.round(((cur - prev) / prev) * 100)
}
