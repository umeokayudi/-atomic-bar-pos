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

export async function loadAudit(supabase, { tabela, limit = 100 } = {}) {
  let q = supabase.from('audit_log').select('*').order('criado_em', { ascending: false }).limit(limit)
  if (tabela) q = q.eq('tabela', tabela)
  const { data, error } = await q
  if (error) return { rows: [], missing: /audit_log|does not exist|schema cache/i.test(error.message || ''), error }
  return { rows: data || [], missing: false, error: null }
}
