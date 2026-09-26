/** CAST / notes on JBM pedidos.obs and POS pos_vendas.obs — never touches vendas columns. */

const CAST_RE = /^Cast:\s*(.+)$/im
const META_LINE_RE = /^(Cast|Night|Svc|Nom|Set|RoomMin|Keep|Pay):\s*.+$/gim

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

export function formatCastToken(cast) {
  if (cast && typeof cast === 'object') {
    const name = String(cast.name || cast.nome || '').trim()
    const id = String(cast.id || '').trim()
    if (name && id) return `${name}|${id}`
    return name || id
  }
  return String(cast || '').trim()
}

export function orderCastFromObs(obs) {
  const m = String(obs || '').match(CAST_RE)
  if (!m) return ''
  return splitCastToken(m[1]).name
}

export function orderCastIdFromObs(obs) {
  const m = String(obs || '').match(CAST_RE)
  if (!m) return ''
  return splitCastToken(m[1]).id
}

export function orderCastRefFromObs(obs) {
  const m = String(obs || '').match(CAST_RE)
  if (!m) return { name: '', id: '' }
  return splitCastToken(m[1])
}

export function orderDetailsFromObs(obs) {
  return String(obs || '').replace(META_LINE_RE, '').replace(/^\s+|\s+$/g, '')
}

export function withOrderCast(details, cast) {
  const body = orderDetailsFromObs(details)
  const token = formatCastToken(cast)
  if (token && body) return `Cast: ${token}\n${body}`
  if (token) return `Cast: ${token}`
  return body
}

export function orderMeta(obs) {
  const ref = orderCastRefFromObs(obs)
  return {
    cast: ref.name,
    castId: ref.id,
    details: orderDetailsFromObs(obs),
  }
}
