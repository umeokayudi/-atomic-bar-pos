/**
 * Supply orders (HQ → bar): order number, who/when, status history, delivery window, receiving check.
 * The order itself stays in Postgres `pedidos` / `pedidos_itens`; everything new lives in one live-store row per
 * order (table `order_track`, id = pedido id), written only by /api/bar/order-track (server stamps who and when).
 * Pure helpers, tested in scripts/orderTrack.test.mjs.
 */

export const TRACK_STATUSES = ['pendente', 'confirmado', 'a_caminho', 'entregue', 'cancelado']
export const UNITS = ['bottle', 'case', 'can', 'kg', 'L', 'pack', 'unit']
export const PRIORITIES = ['normal', 'urgent']

/** ORD-2026-0142: year of creation + a number that never repeats inside that year. */
export function orderCode(track, pedido) {
  const n = +track?.numero
  if (!(n > 0)) return ''
  const year = String(track?.ano || pedido?.criado_em || '').slice(0, 4) || '----'
  return `ORD-${year}-${String(n).padStart(4, '0')}`
}

/** Tokyo year of an ISO timestamp (an order made 2026-12-31 23:30 Tokyo belongs to 2026). */
export function tokyoYear(iso) {
  const ms = Date.parse(iso || '')
  if (!Number.isFinite(ms)) return String(new Date().getUTCFullYear())
  return String(new Date(ms + 9 * 3600 * 1000).getUTCFullYear())
}

/**
 * Numbers for orders that have none yet, oldest first, continuing each year's highest number.
 * `orders`: [{ id, criado_em }]; `tracks`: existing order_track rows. Returns [{ id, numero, ano }].
 */
export function assignNumbers(orders = [], tracks = []) {
  const top = new Map()
  const has = new Set()
  for (const r of tracks || []) {
    if (!(+r?.numero > 0)) continue
    has.add(r.id)
    const y = String(r.ano || '')
    top.set(y, Math.max(top.get(y) || 0, +r.numero))
  }
  const out = []
  const todo = (orders || []).filter(o => o?.id && !has.has(o.id))
    .sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')) || String(a.id).localeCompare(String(b.id)))
  for (const o of todo) {
    const ano = tokyoYear(o.criado_em)
    const numero = (top.get(ano) || 0) + 1
    top.set(ano, numero)
    has.add(o.id)
    out.push({ id: o.id, numero, ano })
  }
  return out
}

/** Status the bar and HQ see: "a_caminho" is a step inside "confirmado" (left for delivery). */
export function trackStatus(pedido, track) {
  const s = pedido?.status || 'pendente'
  if (s === 'confirmado' && track?.saiu_em) return 'a_caminho'
  return s
}

/** Same product + unit + price on one order → one line (quantities added, notes joined). */
export function consolidateLines(lines = []) {
  const by = new Map()
  for (const l of lines || []) {
    if (!l?.produto_id || !(+l.qtd > 0)) continue
    const key = `${l.produto_id}|${l.unidade || ''}|${Math.round(+l.preco || 0)}`
    const cur = by.get(key)
    if (!cur) { by.set(key, { ...l, qtd: +l.qtd, nota: String(l.nota || '').trim() }); continue }
    cur.qtd += +l.qtd
    const n = String(l.nota || '').trim()
    if (n && !cur.nota.split(' · ').includes(n)) cur.nota = cur.nota ? `${cur.nota} · ${n}` : n
    if (!cur.preco_motivo && l.preco_motivo) cur.preco_motivo = l.preco_motivo
  }
  return [...by.values()]
}

/** How many lines would be merged by consolidateLines (shown before saving). */
export function mergedCount(lines = []) {
  const valid = (lines || []).filter(l => l?.produto_id && +l.qtd > 0).length
  return valid - consolidateLines(lines).length
}

/** A price different from the catalog price needs a reason (a wrong catalog price must not go straight to the invoice). */
export function priceLineError(line, catalogPrice) {
  const p = Math.round(+line?.preco || 0)
  if (!(p > 0)) return 'noPrice'
  if (Math.round(+catalogPrice || 0) !== p && !String(line?.preco_motivo || '').trim()) return 'priceReason'
  return null
}

/** Orders for the same bar and day that are still open (warn "N orders already today"). */
export function sameDayOrders(pedidos = [], barId, day) {
  return (pedidos || []).filter(p => p?.bar_id === barId && p.status !== 'cancelado'
    && (String(p.data_pedido || '').slice(0, 10) === day || String(p.data_entrega_prevista || '').slice(0, 10) === day))
}

/** Receiving check: expected × received × difference per line, and the totals. */
export function receivingRows(items = [], counted = {}) {
  const rows = (items || []).map(it => {
    const esperado = +it.qtd || 0
    const raw = counted?.[it.id ?? it.produto_id]
    const recebido = raw === '' || raw == null ? null : Math.max(0, +raw || 0)
    const diff = recebido == null ? null : recebido - esperado
    return { id: it.id ?? it.produto_id, produto_id: it.produto_id, nome: it.nome || it.produtos?.nome || '?', unidade: it.unidade || '', esperado, recebido, diff }
  })
  const done = rows.every(r => r.recebido != null)
  const short = rows.filter(r => r.diff != null && r.diff < 0)
  const over = rows.filter(r => r.diff != null && r.diff > 0)
  return { rows, done, short, over, ok: done && !short.length && !over.length }
}

/** Bar view of a received order: missing lines (received less than ordered). */
export function shortLines(track) {
  return ((track?.recebimento?.linhas) || []).filter(l => +l.recebido < +l.esperado)
    .map(l => ({ ...l, falta: +l.esperado - +l.recebido }))
}

/**
 * The bar's three lists: to receive (open orders), received (bar counted or HQ delivered), short (counted less
 * than ordered, or a drink at 0 that is not on an open order).
 */
export function barQueue(pedidos = [], tracks = {}, stock = []) {
  const toReceive = []
  const received = []
  const short = []
  for (const p of pedidos || []) {
    const tr = tracks[p.id]
    if (p.status === 'cancelado') continue
    const counted = !!tr?.recebimento?.em
    if ((p.status === 'pendente' || p.status === 'confirmado') && !counted) toReceive.push(p)
    else received.push(p)
    for (const l of shortLines(tr)) short.push({ kind: 'order', pedido: p, ...l })
  }
  const onOrder = new Set(toReceive.flatMap(p => (p.pedidos_itens || []).map(it => it.produto_id)))
  for (const s of stock || []) {
    if (s?.hasCount && s.stock <= 0) short.push({ kind: 'stock', produto_id: s.id, nome: s.nome, stock: s.stock, onOrder: onOrder.has(s.id) })
  }
  return { toReceive, received, short }
}

/** What arrived today (bar count or HQ delivery today, Tokyo) — the bridge to the till. */
export function arrivedOn(pedidos = [], tracks = {}, day = '') {
  return (pedidos || []).filter(p => {
    const tr = tracks[p.id]
    const at = tr?.recebimento?.em || tr?.entregue_em || ''
    return at && tokyoDay(at) === day
  })
}

export function tokyoDay(iso) {
  const ms = Date.parse(iso || '')
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

/** HH:MM in Tokyo. */
export function tokyoTime(iso) {
  const ms = Date.parse(iso || '')
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(11, 16)
}

/** Billing data a bar needs before its first invoice: e-mail, payment term (days), credit limit. */
export function billingMissing(profile) {
  const miss = []
  const email = String(profile?.email_cobranca || '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) miss.push('email')
  if (profile?.prazo_dias == null || profile.prazo_dias === '' || !Number.isFinite(+profile.prazo_dias)) miss.push('prazo')
  if (profile?.limite_credito == null || profile.limite_credito === '' || !(+profile.limite_credito > 0)) miss.push('limite')
  return miss
}

/**
 * Purchases: subtotal vs real cost. The points discount explains itself (it is in the formula); any other
 * difference over ¥1 (paid ≠ subtotal: tax, delivery, rounding, wrong reading) needs a written reason.
 */
export function purchaseGap(c) {
  const subtotal = Math.round(+c?.subtotal || 0)
  const paid = Math.round(+c?.total_pago || 0)
  const points = Math.round(+c?.desconto_pontos || 0)
  const real = Math.max(0, (paid || subtotal) - points)
  const unexplained = paid ? paid - subtotal : 0
  return { subtotal, real, points, diff: real - subtotal, unexplained, needsReason: subtotal > 0 && paid > 0 && Math.abs(unexplained) > 1 }
}

const GAP_TAG = /\[(?:Diferença|Difference|差額):\s*([^\]]*)\]/i
export function withGapReason(obs, reason) {
  const clean = String(obs || '').replace(GAP_TAG, '').trim()
  const r = String(reason || '').trim()
  return r ? `${clean ? `${clean} ` : ''}[Difference: ${r}]` : clean
}
export function gapReasonOf(obs) {
  return GAP_TAG.exec(String(obs || ''))?.[1]?.trim() || ''
}

/** One history line, as the server writes it. */
export function historyLine({ status, por, por_id, nota, em }) {
  return { status, por: por || null, por_id: por_id || null, nota: nota ? String(nota).slice(0, 300) : null, em: em || new Date().toISOString() }
}

/** Fields HQ may set on an order's track row (the rest is stamped by the server). */
export const HQ_FIELDS = ['entrega_de', 'entrega_ate', 'prioridade', 'responsavel', 'nota', 'linhas']
export const BAR_FIELDS = ['responsavel_bar']

export function cleanTrackPatch(patch = {}, allowed = HQ_FIELDS) {
  const out = {}
  for (const k of allowed) {
    if (!(k in (patch || {}))) continue
    const v = patch[k]
    if (k === 'linhas') {
      out.linhas = Object.fromEntries(Object.entries(v || {}).slice(0, 200).map(([id, l]) => [String(id), {
        unidade: l?.unidade ? String(l.unidade).slice(0, 20) : null,
        nota: l?.nota ? String(l.nota).slice(0, 300) : null,
        preco_catalogo: l?.preco_catalogo != null ? Math.round(+l.preco_catalogo || 0) : null,
        preco_motivo: l?.preco_motivo ? String(l.preco_motivo).slice(0, 300) : null,
      }]))
    } else if (k === 'prioridade') out.prioridade = PRIORITIES.includes(v) ? v : 'normal'
    else out[k] = v == null || v === '' ? null : String(v).slice(0, 300)
  }
  return out
}
