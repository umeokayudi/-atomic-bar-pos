/**
 * Staff app, server side. Reached through /api/bar-staff (actions `me*` for the signed-in staff member, and
 * `listRequests` / `answerRequest` / `listDayReports` for the owner/manager) and /api/time-clock (check-out
 * day report). No new endpoint, no RLS change: every read and write here is scoped to the caller.
 *   - a staff member reads and writes only their own rows (id from the session, never from the body)
 *   - the owner/manager reads the bar's requests and day reports (area team|clock, checked by the caller)
 */

import { loadStaffWithExtras, runLiveOp, saveStaffExtras } from './_barLiveStore.js'
import { listPunches } from './_punchStore.js'
import { geminiGenerate } from './_gemini.js'
import { earningsByDay, myGoalStatus, myNightSummary } from '../src/lib/staffNight.js'
import { tokyoNightKey, tokyoWallToUtcMs } from '../src/lib/tokyo.js'
import { nightWindow } from '../src/lib/nightClose.js'

const PRIVATE_BUCKET = 'system-private'
const STAFF_FILES = 'staff-files'
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const PHOTO_MAX = 1_500_000
const SIGNATURE_MAX = 90_000
export const REQUEST_TYPES = ['problem', 'request', 'stock', 'other']
export const REQUEST_STATUSES = ['open', 'seen', 'done']

export const SELF_ACTIONS = new Set(['meDay', 'meProfile', 'meUploadPhoto', 'meRequests', 'meSendRequest', 'meEarnings'])
export const OWNER_ACTIONS = new Set(['listRequests', 'answerRequest', 'listDayReports'])

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const newId = () => globalThis.crypto?.randomUUID?.() || `sr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const dayKey = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '')

function shiftDay(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

async function signedUrl(admin, path, seconds = 600) {
  if (!admin || !path) return ''
  try {
    const { data } = await admin.storage.from(PRIVATE_BUCKET).createSignedUrl(path, seconds)
    return data?.signedUrl || ''
  } catch {
    return ''
  }
}

async function uploadImage(admin, path, { contentType, data }) {
  const ext = PHOTO_TYPES[String(contentType || '')]
  if (!ext) return { error: 'Use a JPG, PNG or WebP picture' }
  const buf = Buffer.from(String(data || ''), 'base64')
  if (!buf.length) return { error: 'Empty picture' }
  if (buf.length > PHOTO_MAX) return { error: 'Picture too large (1.5 MB max)' }
  const full = `${path}.${ext}`
  const { error } = await admin.storage.from(PRIVATE_BUCKET).upload(full, buf, { contentType, upsert: false })
  if (error) return { error: error.message || 'Upload failed' }
  return { path: full }
}

async function staffExtras(db, id) {
  const r = await runLiveOp(db, { table: 'staff_extras', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: id }], wantSingle: 'maybe' })
  return r.data || {}
}

async function barGoals(db, barId) {
  const r = await runLiveOp(db, { table: 'bar_goals', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'bar_id', v: barId }], wantSingle: 'maybe' })
  return r.data || {}
}

async function daySheet(db, barId, night) {
  const r = await runLiveOp(db, { table: 'bar_day_sheet', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: `${barId}:${night}` }], wantSingle: 'maybe' })
  return r.data || null
}

/** Till tickets (and their lines) of the bar between two night keys. */
export async function loadBarSales(db, barId, fromKey, toKey, { withItems = false } = {}) {
  const r = await runLiveOp(db, {
    table: 'pos_vendas',
    mode: 'select',
    columns: '*',
    filters: [{ op: 'eq', k: 'bar_id', v: barId }, { op: 'gte', k: 'data', v: shiftDay(fromKey, -1) }, { op: 'lte', k: 'data', v: shiftDay(toKey, 1) }],
    limitN: 3000,
  })
  const sales = Array.isArray(r.data) ? r.data : []
  let items = []
  if (withItems && sales.length) {
    const ids = sales.map(s => s.id).filter(Boolean)
    for (let i = 0; i < ids.length; i += 150) {
      const part = await runLiveOp(db, { table: 'pos_vendas_itens', mode: 'select', columns: '*', filters: [{ op: 'in', k: 'pos_venda_id', v: ids.slice(i, i + 150) }] })
      if (Array.isArray(part.data)) items = items.concat(part.data)
    }
  }
  return { sales, items }
}

function roleFor(sheet, me, extras) {
  const fromSheet = sheet?.roles && typeof sheet.roles === 'object' ? clip(sheet.roles[me.id], 80) : ''
  return fromSheet || clip(extras?.cargo || me.cargo || '', 80)
}

/** Tonight for one person: mission, role, the bar's and my goals, what I sold so far. */
async function dayFor(db, { barId, me, night = tokyoNightKey() }) {
  const [goals, sheet, extras, sales] = await Promise.all([
    barGoals(db, barId),
    daySheet(db, barId, night),
    staffExtras(db, me.id),
    loadBarSales(db, barId, night, night, { withItems: true }),
  ])
  const summary = myNightSummary({ ...sales, me, night })
  return {
    night,
    mission: clip(sheet?.missao || goals?.missao || '', 300),
    role: roleFor(sheet, me, extras),
    barGoal: Math.max(0, Math.round(+goals?.noite || 0)),
    goal: myGoalStatus({ goals, meId: me.id, mySales: summary.sales }),
    summary,
    nightPremium: goals?.adicional_noturno !== false,
  }
}

/** For a clock-out with a day summary: the night of the clock-in and what the person did. */
export async function checkoutContext(db, { bar, staff, inAt }) {
  const night = tokyoNightKey(inAt ? new Date(inAt) : new Date())
  const day = await dayFor(db, { barId: bar.id, me: { id: staff.id, nome: staff.nome, cargo: staff.cargo }, night })
  return { ...day, inAt: inAt || null }
}

export function cleanCheckout(raw = {}) {
  const sig = String(raw.signature || '')
  return {
    notes: clip(raw.notes, 1000),
    improve: clip(raw.improve, 1000),
    signature: /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(sig) && sig.length <= SIGNATURE_MAX ? sig : '',
  }
}

function reportPrompt({ staffName, barName, ctx, checkout, hours }) {
  const s = ctx.summary
  const lines = [
    `Write a short report (max 120 words, plain text, no markdown) for the owner of the bar "${barName}" about tonight's shift of ${staffName}.`,
    'Be factual and kind; point out one strength and, if the goal was missed, one concrete thing to improve. Do not invent numbers.',
    `Night: ${ctx.night}. Role: ${ctx.role || 'n/a'}. Hours on the clock: ${hours != null ? hours : 'n/a'}.`,
    `Mission of the night: ${ctx.mission || 'none set'}.`,
    `Personal night goal: ${ctx.goal.target ? `¥${ctx.goal.target}` : 'none'}; sold: ¥${s.sales} in ${s.tickets} tickets (${ctx.goal.missed ? 'goal missed' : ctx.goal.target ? 'goal reached' : 'no goal'}).`,
    `Commission: ¥${s.commission}. Drink-backs: ${s.drinkBackCount}. Top items: ${s.sold.slice(0, 5).map(x => `${x.nome} x${x.qtd}`).join(', ') || 'none'}.`,
    `Staff notes: ${checkout.notes || 'none'}.`,
    `How the night went / what to improve (staff's words): ${checkout.improve || 'none'}.`,
  ]
  return lines.join('\n')
}

async function aiReport(prompt, timeoutMs = 12000) {
  const work = geminiGenerate({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
  }).then(j => (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim())
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), timeoutMs))
  return Promise.race([work, timer])
}

/** Save the owner's day report for a clock-out, then add the AI text (saved without it if the AI fails). */
export async function createDayReport(db, { bar, staff, punch, inPunchId, checkout, ctx }) {
  const id = newId()
  const inAt = ctx?.inAt || null
  const hours = punch?.punched_at && inAt ? Math.round(((Date.parse(punch.punched_at) - Date.parse(inAt)) / 3600000) * 100) / 100 : null
  const row = {
    id,
    bar_id: bar.id,
    staff_id: staff.id,
    staff_nome: staff.nome || '',
    night_key: ctx.night,
    punch_id: punch?.id || null,
    in_punch_id: inPunchId || null,
    out_at: punch?.punched_at || new Date().toISOString(),
    role: ctx.role || '',
    mission: ctx.mission || '',
    goal: ctx.goal,
    summary: ctx.summary,
    notes: checkout.notes,
    improve: checkout.improve,
    signature: checkout.signature,
    ai_report: '',
    ai_error: '',
    criado_em: new Date().toISOString(),
  }
  const saved = await runLiveOp(db, { table: 'staff_day_reports', mode: 'insert', insertRows: [row], wantSingle: true })
  if (saved.error) return null
  let text = ''
  let aiError = ''
  try {
    text = await aiReport(reportPrompt({ staffName: staff.nome || 'staff', barName: bar.nome || 'bar', ctx, checkout, hours }))
  } catch (e) {
    aiError = String(e?.message || 'AI failed').slice(0, 200)
  }
  await runLiveOp(db, {
    table: 'staff_day_reports',
    mode: 'update',
    filters: [{ op: 'eq', k: 'id', v: id }],
    updatePatch: { ai_report: String(text || '').slice(0, 2000), ai_error: text ? '' : (aiError || 'empty') },
    wantSingle: true,
  })
  return id
}

async function notifyManagers(admin, barId, { titulo, mensagem, tipo }) {
  try {
    const { data } = await admin.from('perfis').select('id,role').eq('bar_id', barId).in('role', ['cliente', 'gerente'])
    const rows = (data || []).map(p => ({ user_id: p.id, tipo, titulo, mensagem, lida: false }))
    if (rows.length) await admin.from('notificacoes').insert(rows)
  } catch { /* the request is saved; the bell is a bonus */ }
}

async function notifyStaff(admin, staffId, { titulo, mensagem, tipo }) {
  try {
    await admin.from('notificacoes').insert({ user_id: staffId, tipo, titulo, mensagem, lida: false })
  } catch { /* lane logins have no auth user: they read the answer in the app */ }
}

async function withPhotoUrls(admin, rows) {
  return Promise.all((rows || []).map(async r => ({ ...r, foto_url: r.foto ? await signedUrl(admin, r.foto) : '' })))
}

/** Owner/manager-safe view of a day report (the staff app never asks for it). */
function reportView(r) {
  return {
    id: r.id, staff_id: r.staff_id, staff_nome: r.staff_nome, night_key: r.night_key, out_at: r.out_at,
    role: r.role, mission: r.mission, goal: r.goal, summary: r.summary, notes: r.notes, improve: r.improve,
    signature: r.signature, ai_report: r.ai_report, ai_error: r.ai_error, punch_id: r.punch_id,
  }
}

/** Staff self-service. `me` comes from the session (requireBarAccount), never from the body. */
export async function handleSelfAction(res, { admin, db, auth, body }) {
  const barId = auth.perfil.bar_id
  const meId = auth.user?.id || auth.perfil.id
  const me = { id: meId, nome: auth.perfil.nome || '', cargo: auth.perfil.cargo || '' }

  if (body.action === 'meDay') {
    const day = await dayFor(db, { barId, me })
    return res.status(200).json(day)
  }

  if (body.action === 'meProfile') {
    const [staff, extras] = await Promise.all([loadStaffWithExtras(db, meId), staffExtras(db, meId)])
    const foto = extras.foto || staff?.foto || ''
    return res.status(200).json({
      id: meId,
      nome: staff?.nome || me.nome,
      cargo: extras.cargo || staff?.cargo || me.cargo || '',
      email: auth.perfil.email || staff?.email || '',
      telefone: extras.telefone || extras.contato || '',
      foto_url: await signedUrl(admin, foto, 3600),
    })
  }

  if (body.action === 'meUploadPhoto') {
    if (!admin) return res.status(503).json({ error: 'Photo upload is not available on this server' })
    const up = await uploadImage(admin, `${STAFF_FILES}/${barId}/${meId}/foto-${Date.now()}`, body)
    if (up.error) return res.status(400).json({ error: up.error })
    const saved = await saveStaffExtras(db, meId, { foto: up.path })
    if (saved && saved.ok === false) return res.status(400).json({ error: saved.error || 'Could not save' })
    return res.status(200).json({ ok: true, foto_url: await signedUrl(admin, up.path, 3600) })
  }

  if (body.action === 'meRequests') {
    const r = await runLiveOp(db, {
      table: 'staff_requests', mode: 'select', columns: '*',
      filters: [{ op: 'eq', k: 'bar_id', v: barId }, { op: 'eq', k: 'staff_id', v: meId }],
      orderBy: { k: 'criado_em', ascending: false }, limitN: 50,
    })
    return res.status(200).json({ requests: await withPhotoUrls(admin, r.data || []) })
  }

  if (body.action === 'meSendRequest') {
    const tipo = REQUEST_TYPES.includes(body.tipo) ? body.tipo : 'other'
    const texto = clip(body.texto, 800)
    if (texto.length < 3) return res.status(400).json({ error: 'Write a few words' })
    const id = newId()
    let foto = ''
    if (body.foto?.data) {
      if (!admin) return res.status(503).json({ error: 'Photo upload is not available on this server' })
      const up = await uploadImage(admin, `${STAFF_FILES}/${barId}/requests/${id}`, body.foto)
      if (up.error) return res.status(400).json({ error: up.error })
      foto = up.path
    }
    const row = {
      id, bar_id: barId, staff_id: meId, staff_nome: me.nome, tipo, texto, foto,
      status: 'open', answer: '', answered_by: '', answered_at: null, criado_em: new Date().toISOString(),
    }
    const saved = await runLiveOp(db, { table: 'staff_requests', mode: 'insert', insertRows: [row], wantSingle: true })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not send' })
    if (admin) await notifyManagers(admin, barId, { tipo: 'staff_request', titulo: `${me.nome || 'Staff'} · ${tipo}`, mensagem: texto.slice(0, 200) })
    return res.status(200).json({ ok: true, request: row })
  }

  if (body.action === 'meEarnings') {
    const from = dayKey(body.from)
    const to = dayKey(body.to)
    if (!from || !to || from > to) return res.status(400).json({ error: 'from and to (YYYY-MM-DD) required' })
    const span = (Date.parse(to) - Date.parse(from)) / 86400000
    if (span > 92) return res.status(400).json({ error: 'Pick 3 months or less' })
    const [y1, m1, d1] = from.split('-').map(Number)
    const fromIso = new Date(tokyoWallToUtcMs(y1, m1, d1, 6)).toISOString()
    const toIso = nightWindow(to).to
    const [staff, extras, goals, punches, sales] = await Promise.all([
      loadStaffWithExtras(db, meId),
      staffExtras(db, meId),
      barGoals(db, barId),
      listPunches(db, { barId, staffId: meId, from: fromIso, to: toIso }),
      loadBarSales(db, barId, from, to),
    ])
    const rate = Math.max(0, +(extras.salario_hora ?? staff?.salario_hora ?? 0) || 0)
    const nightPremium = goals?.adicional_noturno !== false
    const out = earningsByDay({ punches: punches.data || [], sales: sales.sales, me, rate, nightPremium, from, to })
    return res.status(200).json({ from, to, rate, monthly: Math.max(0, +(extras.salario_mes || 0) || 0), nightPremium, ...out })
  }

  return res.status(400).json({ error: 'Unknown action' })
}

/** Owner/manager inbox and day reports. The caller already checked role and area. */
export async function handleOwnerAction(res, { admin, db, auth, body }) {
  const barId = auth.perfil.bar_id
  if (body.action === 'listRequests') {
    const r = await runLiveOp(db, {
      table: 'staff_requests', mode: 'select', columns: '*',
      filters: [{ op: 'eq', k: 'bar_id', v: barId }], orderBy: { k: 'criado_em', ascending: false }, limitN: 100,
    })
    return res.status(200).json({ requests: await withPhotoUrls(admin, r.data || []) })
  }
  if (body.action === 'answerRequest') {
    const hit = await runLiveOp(db, {
      table: 'staff_requests', mode: 'select', columns: '*',
      filters: [{ op: 'eq', k: 'id', v: String(body.id || '') }, { op: 'eq', k: 'bar_id', v: barId }], wantSingle: 'maybe',
    })
    if (!hit.data) return res.status(404).json({ error: 'Request not found' })
    const status = REQUEST_STATUSES.includes(body.status) ? body.status : hit.data.status
    const answer = body.answer != null ? clip(body.answer, 800) : hit.data.answer
    const patch = { status, answer, answered_by: auth.perfil.nome || '', answered_at: new Date().toISOString() }
    const saved = await runLiveOp(db, { table: 'staff_requests', mode: 'update', filters: [{ op: 'eq', k: 'id', v: hit.data.id }], updatePatch: patch, wantSingle: true })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
    if (admin && (answer !== hit.data.answer || status === 'done')) {
      await notifyStaff(admin, hit.data.staff_id, { tipo: 'staff_request_answer', titulo: auth.perfil.nome || 'Manager', mensagem: (answer || status).slice(0, 200) })
    }
    return res.status(200).json({ ok: true, request: { ...hit.data, ...patch } })
  }
  if (body.action === 'listDayReports') {
    const filters = [{ op: 'eq', k: 'bar_id', v: barId }]
    if (dayKey(body.night)) filters.push({ op: 'eq', k: 'night_key', v: body.night })
    const r = await runLiveOp(db, { table: 'staff_day_reports', mode: 'select', columns: '*', filters, orderBy: { k: 'criado_em', ascending: false }, limitN: 60 })
    return res.status(200).json({ reports: (r.data || []).map(reportView) })
  }
  return res.status(400).json({ error: 'Unknown action' })
}
