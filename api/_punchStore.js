/** Punch list of a bar: Postgres `time_clock` when it exists, plus the live JSON copy, merged by id. */
import { applyFilters, isMissingSchemaError, isRlsError, readLiveJson } from './_barLiveStore.js'

export async function listPunches(db, spec) {
  let query = db.from('time_clock').select('*').eq('bar_id', spec.barId).order('punched_at', { ascending: false }).limit(500)
  if (spec.staffId) query = query.eq('staff_id', spec.staffId)
  if (spec.from) query = query.gte('punched_at', spec.from)
  if (spec.to) query = query.lte('punched_at', spec.to)
  const { data, error } = await query
  const filters = [{ op: 'eq', k: 'bar_id', v: spec.barId }]
  if (spec.staffId) filters.push({ op: 'eq', k: 'staff_id', v: spec.staffId })
  if (spec.from) filters.push({ op: 'gte', k: 'punched_at', v: spec.from })
  if (spec.to) filters.push({ op: 'lte', k: 'punched_at', v: spec.to })
  const liveRows = applyFilters(await readLiveJson(db, 'time_clock'), filters)
  if (error && !isMissingSchemaError(error) && !isRlsError(error) && !liveRows.length) {
    return { data: null, error }
  }
  const byId = new Map()
  for (const row of [...(error ? [] : (data || [])), ...liveRows]) {
    byId.set(row.id || `${row.staff_id}-${row.punched_at}`, row)
  }
  // Postgres returns '+00:00' and the JSON copy 'Z': compare instants, not strings.
  const at = r => Date.parse(r.punched_at || '') || 0
  const merged = [...byId.values()].sort((a, b) => at(b) - at(a))
  return { data: merged, error: null }
}

