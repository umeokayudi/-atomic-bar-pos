/**
 * /api/bar/order-track — order number, status history, delivery window and receiving check of supply orders.
 *  GET  ?bar=<id>  or  ?ids=a,b,c     the track rows (bar logins: only their own bar)
 *  POST { action: 'ensure' }                         HQ: give every order without one a number (oldest first)
 *  POST { action: 'save', id, patch }                HQ: delivery window, priority, who delivers, notes, line notes/units/price reasons
 *  POST { action: 'status', id, status, nota, recebido_por }
 *        HQ: confirmado | a_caminho | entregue | cancelado (cancel needs a reason); bar: cancel its own pending order
 *  POST { action: 'receive', id, linhas, responsavel, nota }   bar (or HQ): what arrived, line by line
 *
 * Rows live in the live store (table order_track, id = pedido id). Who and when are always stamped here, from the
 * signed-in login; the browser never sends them. Every change adds a line to the row's history.
 */
import { tryDrinksAdminClient } from './_supabaseAdmin.js'
import { resolveBarActor } from './_barLaneAuth.js'
import { handleCorsPreflight, setCorsHeaders } from './_cors.js'
import { runLiveOp } from './_barLiveStore.js'
import { pushSoon, sendPushEvent } from './_push.js'
import { errText } from '../src/lib/errText.js'
import { assignNumbers, cleanTrackPatch, historyLine, orderCode, tokyoTime, tokyoDay } from '../src/lib/orderTrack.js'

const TABLE = 'order_track'
const HQ_ROLES = new Set(['admin', 'jbm'])
const BAR_ROLES = new Set(['cliente', 'gerente', 'caixa', 'bar_staff'])
const STATUS_WORD = { pendente: 'sent', confirmado: 'confirmed', a_caminho: 'on the way', entregue: 'delivered', cancelado: 'cancelled', recebido: 'received by the bar' }

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}
const nameOf = auth => auth.perfil?.nome || auth.perfil?.email || auth.user?.email || null

async function readRows(admin, filters = []) {
  const r = await runLiveOp(admin, { table: TABLE, mode: 'select', columns: '*', filters })
  return r.data || []
}
async function readRow(admin, id) {
  return (await readRows(admin, [{ op: 'eq', k: 'id', v: id }]))[0] || null
}
async function writeRow(admin, row) {
  const r = await runLiveOp(admin, { table: TABLE, mode: 'upsert', insertRows: [{ ...row, atualizado_em: new Date().toISOString() }] })
  if (r.error) throw new Error(errText(r.error))
  return r.data?.[0] || row
}

/** Numbers and a first history line ("sent", by who created it) for every order that has no row yet. */
async function ensureAll(admin) {
  const { data: orders, error } = await admin.from('pedidos').select('id,bar_id,criado_por,criado_em,status').limit(5000)
  if (error) throw new Error(error.message)
  const tracks = await readRows(admin)
  const byId = new Map(tracks.map(r => [r.id, r]))
  const fresh = assignNumbers(orders || [], tracks)
  const missingOwner = (orders || []).filter(o => !byId.get(o.id)?.criado_por_nome && o.criado_por).map(o => o.criado_por)
  const names = new Map()
  if (missingOwner.length) {
    const { data: ps } = await admin.from('perfis').select('id,nome,email').in('id', [...new Set(missingOwner)].slice(0, 500))
    for (const p of ps || []) names.set(p.id, p.nome || p.email || null)
  }
  const rows = []
  for (const n of fresh) {
    const o = (orders || []).find(x => x.id === n.id)
    rows.push({
      ...(byId.get(n.id) || {}),
      id: n.id, numero: n.numero, ano: n.ano, bar_id: o?.bar_id || null,
      criado_em: o?.criado_em || null,
      criado_por_nome: byId.get(n.id)?.criado_por_nome || names.get(o?.criado_por) || null,
      historico: byId.get(n.id)?.historico?.length ? byId.get(n.id).historico
        : [historyLine({ status: 'pendente', por: names.get(o?.criado_por) || null, por_id: o?.criado_por, em: o?.criado_em })],
    })
  }
  if (rows.length) {
    const r = await runLiveOp(admin, { table: TABLE, mode: 'upsert', insertRows: rows })
    if (r.error) throw new Error(errText(r.error))
  }
  return { numbered: rows.length }
}

/** In-app note to the bar's owner/manager logins, and a push to the bar's phones. Never fails the change. */
async function tellBar(admin, { pedido, track, status, extra }) {
  try {
    const code = orderCode(track, pedido)
    const when = track?.entrega_de ? `${tokyoDay(track.entrega_de)} ${tokyoTime(track.entrega_de)}${track.entrega_ate ? `–${tokyoTime(track.entrega_ate)}` : ''}` : ''
    const { data: users } = await admin.from('perfis').select('id,role').eq('bar_id', pedido.bar_id)
    const to = (users || []).filter(u => u.role === 'cliente' || u.role === 'gerente')
    if (to.length) {
      await admin.from('notificacoes').insert(to.map(u => ({
        user_id: u.id, tipo: `pedido_${status}`, link: 'pedidos',
        titulo: `${code || 'Order'} · ${STATUS_WORD[status] || status}`,
        mensagem: [when && `Delivery ${when}`, extra].filter(Boolean).join(' · ') || (STATUS_WORD[status] || status),
      })))
    }
    await pushSoon(sendPushEvent(admin, { barId: pedido.bar_id, type: 'supply', key: `${pedido.id}:${status}`, vars: { code, status: STATUS_WORD[status] || status, when } }))
  } catch { /* a missed note must not undo the status */ }
}

async function tellHq(admin, { pedido, track, title, body }) {
  try {
    const { data: admins } = await admin.from('perfis').select('id').eq('role', 'admin')
    if (admins?.length) {
      await admin.from('notificacoes').insert(admins.map(a => ({ user_id: a.id, tipo: 'pedido_recebido', link: 'pedidos', titulo: `${orderCode(track, pedido) || 'Order'} · ${title}`, mensagem: body })))
    }
  } catch { /* ignore */ }
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res, 'GET, POST, OPTIONS')
  const admin = tryDrinksAdminClient()
  if (!admin) return res.status(503).json({ error: 'Order tracking needs the server key (SUPABASE_SERVICE_ROLE_KEY) on this deploy' })
  const auth = await resolveBarActor(req, admin)
  if (auth.error) return res.status(auth.status).json({ error: errText(auth.error, 'Unauthorized') })
  const role = auth.perfil?.role
  const hq = HQ_ROLES.has(role)
  const barRole = BAR_ROLES.has(role)
  if (!hq && !barRole) return res.status(403).json({ error: 'Forbidden' })
  const ownBar = barRole ? auth.perfil?.bar_id : null
  if (barRole && !ownBar) return res.status(403).json({ error: 'This login has no bar' })

  try {
    if (req.method === 'GET') {
      const q = req.query || {}
      const filters = []
      const bar = ownBar || (q.bar ? String(q.bar) : null)
      if (bar) filters.push({ op: 'eq', k: 'bar_id', v: bar })
      if (q.ids) filters.push({ op: 'in', k: 'id', v: String(q.ids).split(',').filter(Boolean).slice(0, 500) })
      if (!bar && !q.ids && !hq) return res.status(400).json({ error: 'Name a bar' })
      return res.status(200).json({ rows: await readRows(admin, filters) })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use GET or POST' })

    const body = bodyOf(req)
    const action = String(body.action || '')

    if (action === 'ensure') {
      if (!hq) return res.status(403).json({ error: 'Only HQ' })
      return res.status(200).json(await ensureAll(admin))
    }

    const id = String(body.id || '')
    if (!id) return res.status(400).json({ error: 'Missing order id' })
    const { data: pedido, error: pErr } = await admin.from('pedidos').select('id,bar_id,status,criado_em,criado_por,total_estimado').eq('id', id).maybeSingle()
    if (pErr) throw new Error(pErr.message)
    if (!pedido) return res.status(404).json({ error: 'Order not found' })
    if (ownBar && pedido.bar_id !== ownBar) return res.status(403).json({ error: 'Not your bar' })

    let track = await readRow(admin, id)
    if (!track?.numero) { await ensureAll(admin); track = await readRow(admin, id) }
    track = track || { id, bar_id: pedido.bar_id, historico: [] }
    const actor = { por: nameOf(auth), por_id: auth.user?.id || null }

    if (action === 'save') {
      if (!hq) return res.status(403).json({ error: 'Only HQ' })
      const patch = cleanTrackPatch(body.patch || {})
      if (patch.linhas) patch.linhas = { ...(track.linhas || {}), ...patch.linhas }
      const changed = Object.keys(patch)
      const next = { ...track, ...patch, bar_id: pedido.bar_id }
      if (body.created) {
        next.criado_por_nome = actor.por
        next.historico = [historyLine({ status: 'pendente', ...actor, nota: body.note_created || null, em: pedido.criado_em })]
      } else if (changed.length) {
        next.historico = [...(track.historico || []), historyLine({ status: 'editado', ...actor, nota: changed.join(', ') })]
      }
      return res.status(200).json({ row: await writeRow(admin, next) })
    }

    if (action === 'status') {
      const status = String(body.status || '')
      const nota = String(body.nota || '').trim().slice(0, 300)
      const from = pedido.status
      if (barRole) {
        if (status !== 'cancelado' || from !== 'pendente') return res.status(403).json({ error: 'The bar can only cancel an order JBM has not confirmed yet' })
      }
      if (status === 'cancelado' && !nota) return res.status(400).json({ error: 'Write why the order is cancelled', code: 'reason' })
      const allowed = {
        confirmado: ['pendente'],
        a_caminho: ['confirmado'],
        entregue: ['confirmado', 'entregue'],
        cancelado: ['pendente', 'confirmado'],
      }
      if (!allowed[status]) return res.status(400).json({ error: 'Unknown status' })
      if (!allowed[status].includes(from)) return res.status(409).json({ error: `Order is ${from}`, code: 'state' })
      const now = new Date().toISOString()
      const next = { ...track, bar_id: pedido.bar_id }
      if (status === 'a_caminho') { next.saiu_em = now; next.saiu_por = actor.por }
      else {
        if (status !== from) {
          const { error } = await admin.from('pedidos').update({ status }).eq('id', id)
          if (error) throw new Error(error.message)
        }
        if (status === 'confirmado') { next.confirmado_em = now; next.confirmado_por = actor.por }
        if (status === 'entregue') {
          next.entregue_em = now; next.entregue_por = actor.por
          next.recebido_por = String(body.recebido_por || '').trim().slice(0, 80) || track.recebimento?.responsavel || null
        }
        if (status === 'cancelado') { next.cancelado_em = now; next.cancelado_por = actor.por; next.cancelado_motivo = nota }
      }
      next.historico = [...(track.historico || []), historyLine({ status, ...actor, nota: nota || (status === 'entregue' && next.recebido_por ? `received by ${next.recebido_por}` : null), em: now })]
      const row = await writeRow(admin, next)
      if (hq) await tellBar(admin, { pedido, track: row, status, extra: nota })
      if (barRole && status === 'cancelado') await tellHq(admin, { pedido, track: row, title: 'cancelled by the bar', body: nota })
      return res.status(200).json({ row })
    }

    if (action === 'receive') {
      if (!['pendente', 'confirmado', 'entregue'].includes(pedido.status)) return res.status(409).json({ error: `Order is ${pedido.status}`, code: 'state' })
      const lines = (Array.isArray(body.linhas) ? body.linhas : []).slice(0, 200).map(l => ({
        id: String(l.id || l.produto_id || ''),
        produto_id: l.produto_id ? String(l.produto_id) : null,
        nome: String(l.nome || '').slice(0, 120),
        unidade: l.unidade ? String(l.unidade).slice(0, 20) : null,
        esperado: Math.max(0, +l.esperado || 0),
        recebido: Math.max(0, +l.recebido || 0),
        nota: l.nota ? String(l.nota).slice(0, 200) : null,
      })).filter(l => l.id)
      if (!lines.length) return res.status(400).json({ error: 'Count at least one line' })
      const responsavel = String(body.responsavel || '').trim().slice(0, 80) || actor.por
      const short = lines.filter(l => l.recebido < l.esperado)
      const over = lines.filter(l => l.recebido > l.esperado)
      const now = new Date().toISOString()
      const recebimento = { em: now, por: actor.por, por_id: actor.por_id, responsavel, nota: String(body.nota || '').trim().slice(0, 300) || null, linhas: lines, faltas: short.length, sobras: over.length }
      const summary = short.length || over.length
        ? [short.length && `${short.length} short: ${short.map(l => `${l.nome} −${l.esperado - l.recebido}`).join(', ')}`, over.length && `${over.length} extra`].filter(Boolean).join(' · ')
        : 'all lines match'
      const next = {
        ...track, bar_id: pedido.bar_id, recebimento,
        historico: [...(track.historico || []), historyLine({ status: 'recebido', ...actor, nota: `${responsavel}: ${summary}`, em: now })],
      }
      const row = await writeRow(admin, next)
      await tellHq(admin, { pedido, track: row, title: short.length || over.length ? 'received with differences' : 'received, all OK', body: `${responsavel} · ${summary}` })
      return res.status(200).json({ row })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    return res.status(500).json({ error: errText(e, 'order-track failed') })
  }
}
