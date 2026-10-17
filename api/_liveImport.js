import { createHash } from 'crypto'

/**
 * One-time copy of the bar's private JSON tables (Storage `system-private/bar-live/<table>.json`) into the
 * Postgres table of the same name, the first time the app touches that table after the migration created it.
 * Without this, creating e.g. `pos_vendas` would make the live store read the empty Postgres table and hide
 * the sales that were saved as JSON.
 *
 * - Never deletes or rewrites the JSON file; it stays as a backup.
 * - Rows already in Postgres (same id) are kept as they are (upsert with ignoreDuplicates).
 * - Parents are copied before children so foreign keys hold (a sale before its lines).
 * - Done once per table: a marker `bar-live/_imported/<table>.json` records what was copied and what failed.
 */

export const IMPORT_PREFIX = 'bar-live/_imported/'

// Real foreign keys in sql/pos_start.sql: copy these first.
export const IMPORT_PARENTS = {
  pos_vendas_itens: ['pos_vendas'],
  vip_usages: ['vip_members', 'pos_vendas'],
  discount_usages: ['discount_codes', 'pos_vendas'],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MISSING_RECHECK_MS = 5 * 60 * 1000

const done = new Set()
const running = new Map()
const missingAt = new Map()

/** Ids made by the JSON store's fallback ("live-…") are not uuids; map each to the same uuid everywhere. */
export function legacyUuid(id) {
  const h = createHash('sha1').update(`jbm-live:${id}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function fixId(v) {
  return typeof v === 'string' && v && !UUID_RE.test(v) && v.startsWith('live-') ? legacyUuid(v) : v
}

/** Same row, with fallback ids (and references to them) turned into uuids. */
export function cleanLegacyRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row || {})) {
    out[k] = k === 'id' || k.endsWith('_id') ? fixId(v) : v
  }
  return out
}

function isMissingTable(error) {
  const m = String(error?.message || '')
  return error?.code === 'PGRST205' || error?.code === '42P01' || /Could not find the table|relation .+ does not exist/i.test(m)
}

function missingColumn(error) {
  if (!error) return null
  const m = String(error.message || error.details || '')
  if (!(error.code === 'PGRST204' || error.code === '42703' || /column/i.test(m))) return null
  return m.match(/Could not find the '([^']+)' column/i)?.[1] || m.match(/column "?([a-z0-9_]+)"? (of relation .+ )?does not exist/i)?.[1] || null
}

async function readMarker(admin, bucket, table) {
  try {
    const { data, error } = await admin.storage.from(bucket).download(`${IMPORT_PREFIX}${table}.json`)
    return !error && !!data
  } catch {
    return false
  }
}

async function writeMarker(admin, bucket, table, report) {
  try {
    const body = Buffer.from(JSON.stringify({ ...report, table, at: new Date().toISOString() }))
    const { error } = await admin.storage.from(bucket).upload(`${IMPORT_PREFIX}${table}.json`, body, {
      upsert: true,
      contentType: 'application/json',
    })
    return !error
  } catch {
    return false
  }
}

/** Upsert rows, dropping columns Postgres does not have; on another error, retry one row at a time. */
export async function copyRows(admin, table, rows) {
  let list = rows.map(cleanLegacyRow)
  const dropped = []
  for (let i = 0; i < 12; i++) {
    const { error } = await admin.from(table).upsert(list, { onConflict: 'id', ignoreDuplicates: true })
    if (!error) return { ok: list.length, failed: [], dropped }
    const col = missingColumn(error)
    if (!col || dropped.includes(col)) break
    dropped.push(col)
    list = list.map(r => {
      const next = { ...r }
      delete next[col]
      return next
    })
  }
  let ok = 0
  const failed = []
  for (const row of list) {
    const { error } = await admin.from(table).upsert(row, { onConflict: 'id', ignoreDuplicates: true })
    if (error) failed.push({ id: row.id, error: String(error.message || error.code || 'error').slice(0, 200) })
    else ok++
  }
  return { ok, failed, dropped }
}

/** The JSON rows, [] when the file does not exist, or null when Storage could not be read (try again later). */
export async function readLegacyJson(admin, bucket, table) {
  try {
    const { data, error } = await admin.storage.from(bucket).download(`bar-live/${table}.json`)
    if (error || !data) {
      const m = String(error?.message || error?.statusCode || '')
      return /not.?found|404|does not exist/i.test(m) ? [] : null
    }
    const parsed = JSON.parse(await data.text())
    return Array.isArray(parsed) ? parsed : (parsed?.rows || [])
  } catch {
    return null
  }
}

/**
 * Copy `table` from JSON into Postgres once.
 * Returns the report, or null when there is nothing to do yet (no Postgres table, Storage unreadable).
 */
export async function importLegacyOnce(admin, table, { bucket, loadJson = t => readLegacyJson(admin, bucket, t), now = Date.now() } = {}) {
  if (done.has(table)) return null
  if (now - (missingAt.get(table) || -Infinity) < MISSING_RECHECK_MS) return null
  if (running.has(table)) return running.get(table)
  const job = (async () => {
    const probe = await admin.from(table).select('id').limit(1)
    if (probe.error) {
      if (isMissingTable(probe.error)) missingAt.set(table, now)
      return null
    }
    if (await readMarker(admin, bucket, table)) {
      done.add(table)
      return null
    }
    for (const parent of IMPORT_PARENTS[table] || []) {
      await importLegacyOnce(admin, parent, { bucket, loadJson, now })
    }
    const raw = await loadJson(table)
    if (raw == null) return null
    const rows = raw.filter(r => r && typeof r === 'object')
    const result = rows.length ? await copyRows(admin, table, rows) : { ok: 0, failed: [], dropped: [] }
    const report = { total: rows.length, ...result }
    if (await writeMarker(admin, bucket, table, report)) done.add(table)
    return report
  })()
  running.set(table, job)
  try {
    return await job
  } finally {
    running.delete(table)
  }
}

export function resetImportState() {
  done.clear()
  running.clear()
  missingAt.clear()
}
