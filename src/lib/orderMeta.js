/** CAST / notes on JBM pedidos.obs and POS pos_vendas.obs — never touches vendas columns.
 *
 * Cast line: one person "Cast: Aiko|id", or several people on one sale "Cast: Aiko|id1; Ken|id2"
 * (the sale is credited to all of them in equal parts, see saleCredit.js). Old tickets have one name,
 * with or without "|id"; they read the same as before.
 */

const CAST_RE = /^Cast:\s*(.+)$/im
const META_LINE_RE = /^(Cast|Night|Svc|Nom|Set|RoomMin|Keep|Pay|Comm|CommBy|Card|CardFee|CardSur):\s*.+$/gim
export const CAST_SEP = ';'

export function splitCastToken(raw) {
  const s = String(raw || '').trim()
  if (!s) return { name: '', id: '' }
  const idx = s.lastIndexOf('|')
  if (idx <= 0) return { name: s, id: '' }
  const id = s.slice(idx + 1).trim()
  const name = s.slice(0, idx).trim()
  if (!id) return { name: s, id: '' }
  return { name, id }
}

// Names and ids never carry the characters the line is split on.
const clean = v => String(v || '').replace(/[|;\n\r]/g, ' ').replace(/\s+/g, ' ').trim()

export function formatCastToken(cast) {
  if (cast && typeof cast === 'object') {
    const name = clean(cast.name || cast.nome)
    const id = clean(cast.id)
    if (name && id) return `${name}|${id}`
    return name || id
  }
  return String(cast || '').trim()
}

/** Several people → "A|id1; B|id2". Duplicates (same id, or same name without id) are written once. */
export function formatCastList(list) {
  const seen = new Set()
  const out = []
  for (const c of [].concat(list || [])) {
    const token = formatCastToken(c)
    if (!token) continue
    const ref = splitCastToken(token)
    const key = ref.id || `n:${ref.name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
  }
  return out.join(`${CAST_SEP} `)
}

/** Every person on the Cast line, in ticket order: [{ name, id }]. Empty when there is none. */
export function orderCastListFromObs(obs) {
  const m = String(obs || '').match(CAST_RE)
  if (!m) return []
  return m[1].split(CAST_SEP).map(splitCastToken).filter(c => c.name || c.id)
}

/** Display name(s): "Aiko" or "Aiko, Ken". */
export function orderCastFromObs(obs) {
  return orderCastListFromObs(obs).map(c => c.name || c.id).join(', ')
}

/** Id of the first person on the Cast line (old single-cast callers). */
export function orderCastIdFromObs(obs) {
  return orderCastListFromObs(obs)[0]?.id || ''
}

export function orderCastRefFromObs(obs) {
  return orderCastListFromObs(obs)[0] || { name: '', id: '' }
}

export function orderDetailsFromObs(obs) {
  return String(obs || '').replace(META_LINE_RE, '').replace(/^\s+|\s+$/g, '')
}

/** cast: one person ({ name, id } or a name) or a list of people. */
export function withOrderCast(details, cast) {
  const body = orderDetailsFromObs(details)
  const token = Array.isArray(cast) ? formatCastList(cast) : formatCastToken(cast)
  if (token && body) return `Cast: ${token}\n${body}`
  if (token) return `Cast: ${token}`
  return body
}

export function orderMeta(obs) {
  const list = orderCastListFromObs(obs)
  return {
    cast: list.map(c => c.name || c.id).join(', '),
    castId: list[0]?.id || '',
    castList: list,
    details: orderDetailsFromObs(obs),
  }
}
