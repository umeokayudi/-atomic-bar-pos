/**
 * Linking a login to an employee already registered on the Staff page.
 *
 * Employees without a login live in `bar_people` (their file: pay, contract, photo, phone, sex…). Logins are
 * `perfis` rows whose own file sits in `staff_extras` under the login id, and everything the person does after
 * signing in (punches, shifts, pay pack, goals, drink back) is keyed by that login id.
 *
 * Linking therefore moves the file onto the login id: the employee's fields are copied into the login's
 * extras (with `person_id` pointing back), and the `bar_people` row is kept but marked `merged_into` so it no
 * longer shows as a second person. Nothing is deleted; unlinking clears the marks.
 *
 * Pure: shared by the API (/api/bar-staff) and the "Users & access" screen.
 */

/** Employee-file fields copied from the bar_people row onto the login. */
export const LINK_CARRY_KEYS = [
  'salario_hora', 'salario_mes', 'drink_back', 'comissao_pct', 'transporte',
  'cargo', 'dias', 'idiomas', 'estilo', 'contato', 'telefone', 'sexo', 'notas', 'aniversario',
  'email', 'endereco', 'foto', 'contrato_tipo', 'contrato_inicio', 'contrato_fim', 'contrato_doc', 'contrato_doc_nome',
  'condicoes', 'banco',
]

const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length)

/** True when this bar_people row was folded into a login. */
export function isMerged(person) {
  return !!person?.merged_into
}

/** People still shown as their own employee (not folded into a login). */
export function visiblePeople(people) {
  return (people || []).filter(p => p?.id && !isMerged(p))
}

/**
 * The login's extras after linking `person`: every filled field of the employee file, plus `person_id`.
 * Empty fields on the file never wipe what the login already has.
 */
export function carryFromPerson(person) {
  const out = {}
  if (!person) return out
  for (const k of LINK_CARRY_KEYS) {
    const v = person[k]
    if (empty(v)) continue
    out[k] = Array.isArray(v) ? [...v] : v
  }
  if (out.drink_back === false) out.comissao_pct = 0
  out.person_id = person.id
  return out
}

/** Marks for the bar_people row: folded into `loginId`, or (loginId empty) back on its own. */
export function personLinkPatch(loginId, now = new Date().toISOString()) {
  return loginId
    ? { merged_into: loginId, login_id: loginId, merged_at: now }
    : { merged_into: '', login_id: '', merged_at: '' }
}

/**
 * Swap `fromId` for `toId` in a list of `{ id, nome, … }` (goal people, late/absent marks).
 * When `toId` is already listed the old entry goes (no double counting). Returns null when nothing changed.
 */
export function remapIds(list, fromId, toId) {
  if (!Array.isArray(list) || !fromId || !toId || fromId === toId) return null
  if (!list.some(p => p?.id === fromId)) return null
  const hasTarget = list.some(p => p?.id === toId)
  const out = []
  for (const p of list) {
    if (p?.id !== fromId) out.push(p)
    else if (!hasTarget) out.push({ ...p, id: toId })
  }
  return out
}

/** Day sheet with the person's late/absent marks moved to the login, or null when untouched. */
export function remapSheet(sheet, fromId, toId) {
  if (!sheet) return null
  const late = remapIds(sheet.late, fromId, toId)
  const absent = remapIds(sheet.absent, fromId, toId)
  if (!late && !absent) return null
  return { ...sheet, ...(late ? { late } : {}), ...(absent ? { absent } : {}) }
}

/** Logins that can carry an employee file: real people, not the owner or a tablet lane. */
export function canLinkLogin(row) {
  return !!row && !row.lane && ['bar_staff', 'caixa', 'gerente'].includes(row.role)
}

/**
 * Employees the owner can pick for a new login (or to link an existing one): not folded into a login yet,
 * plus the one already linked to `keepId` (so the edit view still shows it). Sorted by name.
 */
export function linkCandidates(people, keepId = '') {
  return (people || [])
    .filter(p => p?.id && String(p.nome || '').trim() && (!isMerged(p) || p.id === keepId))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
}

/** Case- and accent-insensitive match on name, role, phone. */
export function matchPerson(person, query) {
  const q = fold(query)
  if (!q) return true
  return fold([person?.nome, person?.cargo, person?.contato, person?.telefone].filter(Boolean).join(' ')).includes(q)
}

function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** "Aiko Tanaka" → "aiko.tanaka": a login ID suggestion (letters, digits, dots; 2–32 chars) or ''. */
export function suggestLoginId(name) {
  const slug = fold(name).replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 32).replace(/\.+$/, '')
  return slug.length >= 2 ? slug : ''
}
