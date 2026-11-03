/** Reads the audit log (sql/audit_log.sql) and turns a row into one line: what changed and which fields. */
const LABEL_FIELDS = ['numero', 'nome', 'fornecedor', 'metodo', 'total', 'valor', 'status', 'preco_venda', 'custo']
const SKIP = new Set(['atualizado_em', 'updated_at'])

export function changedFields(antes, depois) {
  if (!antes || !depois) return []
  return Object.keys(depois).filter(k => !SKIP.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]))
}

/** Short label of the row: receipt number, product name, amount… */
export function auditSubject(row) {
  const r = row?.depois || row?.antes || {}
  for (const k of LABEL_FIELDS) if (r[k] != null && r[k] !== '') return String(r[k])
  return row?.registro_id ? String(row.registro_id).slice(0, 8) : '—'
}

const MISSING_RE = /audit_log|does not exist|schema cache/i
let dbLogKnown = null

/** True when the database triggers (sql/audit_log.sql) are on; cached after the first check. */
export async function dbAuditOn(supabase) {
  if (dbLogKnown != null) return dbLogKnown
  const { error } = await supabase.from('audit_log').select('id').limit(1)
  dbLogKnown = !error || !MISSING_RE.test(error.message || '')
  return dbLogKnown
}

/**
 * Activity log, on by default: database trigger rows (audit_log, when sql/audit_log.sql has run) merged with
 * the app's own server-stamped lines (live table audit_events: till shifts, close checks, costs, and invoice /
 * payment changes made in the app while the triggers are off). Newest first.
 */
export async function loadAudit(supabase, { tabela, limit = 100 } = {}) {
  let q = supabase.from('audit_log').select('*').order('criado_em', { ascending: false }).limit(limit)
  if (tabela) q = q.eq('tabela', tabela)
  let ev = supabase.from('audit_events').select('*').order('criado_em', { ascending: false }).limit(limit)
  if (tabela) ev = ev.eq('tabela', tabela)
  const [db, app] = await Promise.all([q, ev.then(r => r, e => ({ data: [], error: e }))])
  const dbMissing = !!db.error && MISSING_RE.test(db.error.message || '')
  const rows = [...(db.error ? [] : db.data || []), ...(app?.error ? [] : (app?.data || []))]
    .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')))
    .slice(0, limit)
  return { rows, missing: false, dbMissing, error: db.error && !dbMissing ? db.error : null }
}

/**
 * App-side log line for a change the database triggers would miss (they are off until sql/audit_log.sql runs).
 * Who and when are stamped by the server, not by the browser. Never throws.
 */
export async function logChange(supabase, { tabela, registro_id = null, acao = 'update', antes = null, depois = null, bar_id = null }) {
  try {
    if (await dbAuditOn(supabase)) return
    await supabase.from('audit_events').insert({ tabela, registro_id, acao, antes, depois, bar_id })
  } catch { /* the log never blocks the change */ }
}
