/** Tokyo civil bounds for the old POS report. Japan has no DST (UTC+9). */

const TOKYO_OFFSET_HOURS = 9

function pad(n) {
  return String(n).padStart(2, '0')
}

export function tokyoDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function parseKey(dateKey) {
  const [y, m, d] = String(dateKey).slice(0, 10).split('-').map(Number)
  return { y, m, d }
}

/** Wall-clock Tokyo → UTC. Month is 1–12. Day/month overflow is intentional. */
function wallUtc(year, month, day, hour = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - TOKYO_OFFSET_HOURS))
}

/**
 * Inclusive start, exclusive end of one Tokyo calendar day.
 * 2026-09-26 → 2026-09-25T15:00:00.000Z .. 2026-09-26T15:00:00.000Z
 */
export function tokyoDayWindow(dateKey) {
  const { y, m, d } = parseKey(dateKey)
  return {
    start: wallUtc(y, m, d, 0).toISOString(),
    end: wallUtc(y, m, d + 1, 0).toISOString(),
  }
}

/** Inclusive start of the 1st, exclusive start of the next month, both Tokyo midnights. */
export function tokyoMonthWindow(dateKey) {
  const { y, m } = parseKey(dateKey)
  return {
    start: wallUtc(y, m, 1, 0).toISOString(),
    end: wallUtc(y, m + 1, 1, 0).toISOString(),
  }
}

/** Next Tokyo calendar date. For date columns, not timestamptz. */
export function tokyoNextDate(dateKey) {
  const { y, m, d } = parseKey(dateKey)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export function tokyoMonthStart(dateKey) {
  return String(dateKey).slice(0, 7) + '-01'
}

export function tokyoNextMonthStart(dateKey) {
  const { y, m } = parseKey(dateKey)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}
