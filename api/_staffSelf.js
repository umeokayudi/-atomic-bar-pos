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
import { drinksAuthClient } from './_supabaseAdmin.js'
import { forgetBarActors } from './_barLaneAuth.js'
import { earningsByDay, myGoalStatus, myNightSummary } from '../src/lib/staffNight.js'
import { tokyoNightKey, tokyoWallToUtcMs } from '../src/lib/tokyo.js'
import { nightWindow } from '../src/lib/nightClose.js'
import {
  addDays, canEditDay, cleanDays, cleanScheduleRules, dayMark, isDayKey, mergeAvailability, myAttendance, nextWeekOf, openHourOf,
  scheduleRules, scheduleWindow, submissionStatus, validWeeks, weekCheck,
} from '../src/lib/staffSchedule.js'
import { canWriteFines, cleanFine, cleanFineSettings, cleanPayout, fineSettings, finesTotal, payNet } from '../src/lib/staffFines.js'

const PRIVATE_BUCKET = 'system-private'
const STAFF_FILES = 'staff-files'
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const PHOTO_MAX = 1_500_000
const SIGNATURE_MAX = 90_000
export const REQUEST_TYPES = ['problem', 'request', 'stock', 'other']
export const REQUEST_STATUSES = ['open', 'seen', 'done']

export const SELF_ACTIONS = new Set([
  'meDay', 'meProfile', 'meUploadPhoto', 'meRequests', 'meSendRequest', 'meEarnings',
  'meAvailability', 'meSaveAvailability', 'mePayouts', 'meZangyo', 'meAccount', 'meName',
])
export const OWNER_ACTIONS = new Set([
  'listRequests', 'answerRequest', 'listDayReports',
  'scheduleBoard', 'confirmSchedule', 'saveScheduleRules', 'remindSchedule', 'listFines', 'saveFine', 'cancelFine', 'saveFineSettings',
  'markSalaryPaid', 'unmarkSalaryPaid', 'listPayouts',
])
/** Owner actions that change what someone is paid (PIN-locked like pay fields when the owner locked payroll). */
export const PAY_WRITE_ACTIONS = new Set(['saveFine', 'cancelFine', 'saveFineSettings', 'markSalaryPaid', 'unmarkSalaryPaid'])

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const newId = () => globalThis.crypto?.randomUUID?.() || `sr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const dayKey = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '')

const tokyoLabel = iso => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', weekday: 'short', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

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

/** Drink-back agents of the bar (an agent linked to a staff login is the same person for sales credit). */
async function barAgents(db, barId) {
  try {
    const r = await runLiveOp(db, { table: 'drink_back_agents', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'bar_id', v: barId }] })
    return Array.isArray(r.data) ? r.data : []
  } catch {
    return []
  }
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
  const [goals, sheet, extras, sales, agents] = await Promise.all([
    barGoals(db, barId),
    daySheet(db, barId, night),
    staffExtras(db, me.id),
    loadBarSales(db, barId, night, night, { withItems: true }),
    barAgents(db, barId),
  ])
  const summary = myNightSummary({ ...sales, me, night, agents })
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

// ── Schedule, fines, payouts (live tables, server only) ─────────────────────
async function availabilityRows(db, barId, staffId) {
  const filters = [{ op: 'eq', k: 'bar_id', v: barId }]
  if (staffId) filters.push({ op: 'eq', k: 'staff_id', v: staffId })
  const r = await runLiveOp(db, { table: 'staff_availability', mode: 'select', columns: '*', filters, limitN: 500 })
  return Array.isArray(r.data) ? r.data : []
}

async function scheduleRows(db, barId, from, to) {
  const r = await runLiveOp(db, {
    table: 'staff_schedule', mode: 'select', columns: '*',
    filters: [{ op: 'eq', k: 'bar_id', v: barId }, { op: 'gte', k: 'day', v: from }, { op: 'lte', k: 'day', v: to }],
    limitN: 500,
  })
  return Array.isArray(r.data) ? r.data : []
}

async function fineRows(db, barId, { staffId, from, to } = {}) {
  const filters = [{ op: 'eq', k: 'bar_id', v: barId }]
  if (staffId) filters.push({ op: 'eq', k: 'staff_id', v: staffId })
  if (from) filters.push({ op: 'gte', k: 'day', v: from })
  if (to) filters.push({ op: 'lte', k: 'day', v: to })
  const r = await runLiveOp(db, { table: 'staff_fines', mode: 'select', columns: '*', filters, orderBy: { k: 'day', ascending: false }, limitN: 1000 })
  return Array.isArray(r.data) ? r.data : []
}

async function payoutRows(db, barId, { staffId, month } = {}) {
  const filters = [{ op: 'eq', k: 'bar_id', v: barId }]
  if (staffId) filters.push({ op: 'eq', k: 'staff_id', v: staffId })
  if (month) filters.push({ op: 'eq', k: 'month', v: month })
  const r = await runLiveOp(db, { table: 'staff_payouts', mode: 'select', columns: '*', filters, orderBy: { k: 'month', ascending: false }, limitN: 500 })
  return Array.isArray(r.data) ? r.data : []
}

/** What a staff member sees of one of their fines. */
function myFineView(f) {
  return {
    id: f.id, day: f.day, type: f.type, amount: f.amount, note: f.note, status: f.status || 'active',
    late_minutes: f.late_minutes || 0, created_at: f.created_at, created_by_nome: f.created_by_nome || '',
    cancelled_at: f.cancelled_at || null,
  }
}

function myPayoutView(p) {
  return {
    id: p.id, month: p.month, gross: p.gross, fines: p.fines, advances: p.advances, deductions: p.deductions || 0,
    net: p.net, paid_at: p.paid_at, status: p.status || 'paid', note: p.note || '',
  }
}

async function upsertRow(db, table, row) {
  const existing = await runLiveOp(db, { table, mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: row.id }], wantSingle: 'maybe' })
  return runLiveOp(db, {
    table,
    mode: existing.data ? 'update' : 'insert',
    filters: [{ op: 'eq', k: 'id', v: row.id }],
    insertRows: [row],
    updatePatch: row,
    wantSingle: true,
  })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * One e-mail for a staff login everywhere: the sign-in (auth user), the login row (perfis) and the staff profile
 * (staff_extras.email). Used when staff change it in the app and when the owner edits the employee's e-mail.
 * Returns { ok } or { error, status }.
 */
export async function setLoginEmail(admin, db, loginId, raw) {
  const email = String(raw || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 120) return { error: 'Enter a valid e-mail', status: 400 }
  if (!admin) return { error: 'Changing the e-mail needs SUPABASE_SERVICE_ROLE_KEY', status: 503 }
  const { data: taken } = await admin.from('perfis').select('id').eq('email', email).neq('id', loginId).limit(1)
  if (taken?.length) return { error: 'This e-mail is already used by another login', status: 409 }
  const { error: aErr } = await admin.auth.admin.updateUserById(loginId, { email, email_confirm: true })
  if (aErr) return { error: aErr.message || 'Could not change the e-mail', status: 400 }
  const { error: pErr } = await admin.from('perfis').update({ email }).eq('id', loginId)
  if (pErr) return { error: pErr.message || 'Could not change the e-mail', status: 400 }
  const extras = await saveStaffExtras(db, loginId, { email })
  if (extras && extras.ok === false) return { error: extras.error || 'Could not save', status: 400 }
  forgetBarActors()
  return { ok: true, email }
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

  // My sign-in: change my e-mail (same on the login and on my staff profile) and/or my password.
  // The current password is checked first. Shared till/clock lane logins cannot change here.
  if (body.action === 'meAccount') {
    if (auth.lane || !auth.user?.id) return res.status(400).json({ error: 'Ask the owner to change this login' })
    if (!admin) return res.status(503).json({ error: 'Not available on this server' })
    const current = String(body.current || '')
    const check = await drinksAuthClient().auth.signInWithPassword({ email: auth.user.email, password: current })
    if (check.error || check.data?.user?.id !== meId) return res.status(401).json({ error: 'Current password is wrong' })
    const out = {}
    if (body.password != null && String(body.password) !== '') {
      const next = String(body.password)
      if (next.length < 8) return res.status(400).json({ error: 'The new password needs at least 8 characters' })
      const { error } = await admin.auth.admin.updateUserById(meId, { password: next })
      if (error) return res.status(400).json({ error: error.message || 'Could not change the password' })
      out.password = true
    }
    if (body.email != null && String(body.email).trim().toLowerCase() !== String(auth.user.email || '').toLowerCase()) {
      const r = await setLoginEmail(admin, db, meId, body.email)
      if (r.error) return res.status(r.status || 400).json({ error: r.error })
      out.email = r.email
    }
    return res.status(200).json({ ok: true, ...out })
  }

  // My name on my own login (owner, manager or staff). Shared till/clock lane logins cannot change here.
  if (body.action === 'meName') {
    if (auth.lane || !auth.user?.id) return res.status(400).json({ error: 'Ask the owner to change this login' })
    if (!admin) return res.status(503).json({ error: 'Not available on this server' })
    const nome = String(body.nome || '').trim().replace(/\s+/g, ' ')
    if (nome.length < 1 || nome.length > 80) return res.status(400).json({ error: 'Enter a name (up to 80 characters)' })
    const { error } = await admin.from('perfis').update({ nome }).eq('id', meId)
    if (error) return res.status(400).json({ error: error.message || 'Could not change the name' })
    forgetBarActors()
    return res.status(200).json({ ok: true, nome })
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

  // Zangyo (overtime): on shift, the person says they stay longer, until about `until`. It lands in the owner's
  // inbox as a request (tipo 'zangyo'); the owner confirms it there ("Done"). The clock-out stays the real end.
  if (body.action === 'meZangyo') {
    const until = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.until || '')) ? String(body.until) : ''
    if (!until) return res.status(400).json({ error: 'Pick until what time' })
    const night = tokyoNightKey()
    const note = clip(body.note, 300)
    const prev = await runLiveOp(db, {
      table: 'staff_requests', mode: 'select', columns: '*',
      filters: [{ op: 'eq', k: 'bar_id', v: barId }, { op: 'eq', k: 'staff_id', v: meId }],
      orderBy: { k: 'criado_em', ascending: false }, limitN: 20,
    })
    const same = (prev.data || []).find(r => r.tipo === 'zangyo' && r.night_key === night && r.status !== 'done')
    const texto = `Zangyo · until ${until}${note ? ` · ${note}` : ''}`
    if (same) {
      const patch = { texto, until, status: 'open' }
      const saved = await runLiveOp(db, { table: 'staff_requests', mode: 'update', filters: [{ op: 'eq', k: 'id', v: same.id }], updatePatch: patch, wantSingle: true })
      if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not send' })
      return res.status(200).json({ ok: true, request: { ...same, ...patch } })
    }
    const row = {
      id: newId(), bar_id: barId, staff_id: meId, staff_nome: me.nome, tipo: 'zangyo', texto, foto: '', night_key: night, until,
      status: 'open', answer: '', answered_by: '', answered_at: null, criado_em: new Date().toISOString(),
    }
    const saved = await runLiveOp(db, { table: 'staff_requests', mode: 'insert', insertRows: [row], wantSingle: true })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not send' })
    if (admin) await notifyManagers(admin, barId, { tipo: 'staff_request', titulo: `${me.nome || 'Staff'} · zangyo`, mensagem: texto })
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
    const [staff, extras, goals, punches, sales, agents] = await Promise.all([
      loadStaffWithExtras(db, meId),
      staffExtras(db, meId),
      barGoals(db, barId),
      listPunches(db, { barId, staffId: meId, from: fromIso, to: toIso }),
      loadBarSales(db, barId, from, to),
      barAgents(db, barId),
    ])
    const rate = Math.max(0, +(extras.salario_hora ?? staff?.salario_hora ?? 0) || 0)
    const nightPremium = goals?.adicional_noturno !== false
    const out = earningsByDay({ punches: punches.data || [], sales: sales.sales, me, rate, nightPremium, from, to, agents })
    // Own fines (cancelled ones too, marked as such) and own attendance against the schedule.
    const [fines, avail, schedules] = await Promise.all([
      fineRows(db, barId, { staffId: meId, from, to }),
      availabilityRows(db, barId, meId),
      scheduleRows(db, barId, from, to),
    ])
    const mineOnly = fines.filter(f => String(f.staff_id) === String(meId))
    const attendance = myAttendance({ meId, from, to, availability: avail, schedules, punches: punches.data || [], toleranceMin: fineSettings(goals).tolerance })
    return res.status(200).json({
      from, to, rate, monthly: Math.max(0, +(extras.salario_mes || 0) || 0), nightPremium, ...out,
      fines: mineOnly.map(myFineView),
      finesTotal: finesTotal(mineOnly, { staffId: meId, from, to }),
      attendance,
    })
  }

  if (body.action === 'meAvailability') {
    const win = scheduleWindow()
    const [rows, schedules, goals] = await Promise.all([
      availabilityRows(db, barId, meId),
      scheduleRows(db, barId, win.from, win.to),
      barGoals(db, barId),
    ])
    let mine = rows.find(r => String(r.staff_id) === String(meId)) || null
    const openHour = openHourOf(goals)
    const rules = scheduleRules(goals)
    const confirmed = {}
    for (const sc of schedules) {
      const hit = (sc.people || []).find(p => String(p.id) === String(meId))
      confirmed[sc.day] = hit ? { in: true, ...dayMark(hit) } : { in: false }
    }
    const editable = []
    for (let d = win.from; d <= win.to; d = addDays(d, 1)) if (canEditDay(d, { openHour })) editable.push(d)
    const today = tokyoNightKey()
    const status = submissionStatus({ row: mine, rules, today })
    // Reminder in the bell: once a day from N days before the deadline until next week is sent.
    if (status.remind && mine?.reminded?.[status.week.from] !== today) {
      if (admin) {
        await notifyStaff(admin, meId, {
          tipo: 'staff_schedule_reminder',
          titulo: 'Schedule · シフト提出',
          mensagem: `Send your shifts for the week of ${status.week.from} (start and end) by ${tokyoLabel(status.deadline)} JST · 締切 ${tokyoLabel(status.deadline)}`,
        })
      }
      const row = {
        id: `${barId}:${meId}`, bar_id: barId, staff_id: meId, staff_nome: me.nome, days: mine?.days || {}, weeks: mine?.weeks || {},
        reminded: { ...(mine?.reminded || {}), [status.week.from]: today }, updated_at: mine?.updated_at || new Date().toISOString(),
      }
      const saved = await upsertRow(db, 'staff_availability', row)
      if (!saved.error) mine = row
    }
    return res.status(200).json({
      ...win, openHour, days: mine?.days || {}, weeks: mine?.weeks || {}, updated_at: mine?.updated_at || null, confirmed, editable,
      rules, status: { ...status, reminded: mine?.reminded?.[status.week.from] === today }, tolerance: fineSettings(goals).tolerance,
    })
  }

  if (body.action === 'meSaveAvailability') {
    const win = scheduleWindow()
    const goals = await barGoals(db, barId)
    const openHour = openHourOf(goals)
    const rows = await availabilityRows(db, barId, meId)
    const mine = rows.find(r => String(r.staff_id) === String(meId)) || null
    const rules = scheduleRules(goals)
    const merged = mergeAvailability(mine?.days || {}, cleanDays(body.days, win), { ...win, openHour })
    // Keep about 3 months of history on the row.
    const keepFrom = addDays(win.from, -92)
    const days = Object.fromEntries(Object.entries(merged.days).filter(([d]) => d >= keepFrom))
    // Sending a week as final: it must follow the bar's rules (start and end on every night, least nights).
    let weeks = validWeeks(mine?.weeks, days, rules)
    const submit = isDayKey(body.submitWeek) ? body.submitWeek : ''
    if (submit) {
      const next = nextWeekOf()
      if (submit < win.from || submit > next.from) return res.status(400).json({ error: 'That week cannot be sent now' })
      const check = weekCheck(days, { from: submit, to: addDays(submit, 6), rules })
      if (!check.ok) {
        const why = check.tooFew ? `Mark at least ${rules.minNights} nights` : check.noStart.length ? 'Pick a start time on every night' : 'Pick an end time on every night'
        return res.status(400).json({ error: why, check })
      }
      weeks = { ...weeks, [submit]: { submitted_at: new Date().toISOString() } }
    }
    const keepWeeks = Object.fromEntries(Object.entries(weeks).filter(([d]) => d >= keepFrom))
    // The row id and staff_id come from the session: a body cannot write someone else's days.
    const row = {
      id: `${barId}:${meId}`, bar_id: barId, staff_id: meId, staff_nome: me.nome, days, weeks: keepWeeks,
      reminded: mine?.reminded || {}, updated_at: new Date().toISOString(),
    }
    const saved = await upsertRow(db, 'staff_availability', row)
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
    const status = submissionStatus({ row, rules })
    if (submit && admin) {
      await notifyManagers(admin, barId, { tipo: 'staff_schedule_sent', titulo: `${me.nome || 'Staff'} · schedule`, mensagem: `Week of ${submit}: ${weekCheck(days, { from: submit, to: addDays(submit, 6), rules }).nights} nights` })
    }
    return res.status(200).json({ ok: true, days, weeks: keepWeeks, locked: merged.locked, status })
  }

  if (body.action === 'mePayouts') {
    const rows = await payoutRows(db, barId, { staffId: meId })
    return res.status(200).json({ payouts: rows.filter(p => String(p.staff_id) === String(meId) && p.status !== 'cancelled').slice(0, 24).map(myPayoutView) })
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
  const actor = { id: auth.user?.id || auth.perfil.id || '', nome: auth.perfil.nome || '' }

  if (body.action === 'scheduleBoard') {
    const win = scheduleWindow()
    const from = isDayKey(body.from) ? body.from : win.from
    const to = isDayKey(body.to) && body.to >= from ? body.to : win.to
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 62) return res.status(400).json({ error: 'Pick 2 months or less' })
    const [y1, m1, d1] = from.split('-').map(Number)
    const [availability, schedules, fines, goals, punches] = await Promise.all([
      availabilityRows(db, barId),
      scheduleRows(db, barId, from, to),
      fineRows(db, barId, { from, to }),
      barGoals(db, barId),
      listPunches(db, { barId, from: new Date(tokyoWallToUtcMs(y1, m1, d1, 6)).toISOString(), to: nightWindow(to).to }),
    ])
    return res.status(200).json({
      from, to, openHour: openHourOf(goals), settings: fineSettings(goals), rules: scheduleRules(goals), nextWeek: nextWeekOf(),
      availability: availability.map(r => ({ staff_id: r.staff_id, staff_nome: r.staff_nome, days: r.days || {}, weeks: r.weeks || {}, updated_at: r.updated_at })),
      schedules, fines, punches: punches.data || [],
    })
  }

  if (body.action === 'confirmSchedule') {
    const day = String(body.day || '')
    if (!isDayKey(day)) return res.status(400).json({ error: 'day required' })
    const seen = new Set()
    const people = []
    for (const p of Array.isArray(body.people) ? body.people : []) {
      const id = clip(p?.id, 64)
      if (!id || seen.has(id)) continue
      seen.add(id)
      people.push({ id, nome: clip(p?.nome, 80), ...dayMark(p) })
      if (people.length >= 80) break
    }
    const row = { id: `${barId}:${day}`, bar_id: barId, day, people, confirmed_by: actor.id, confirmed_by_nome: actor.nome, confirmed_at: new Date().toISOString() }
    const saved = await upsertRow(db, 'staff_schedule', row)
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
    if (admin && body.notify !== false) {
      for (const p of people) {
        const hours = p.start ? `${p.start}${p.end ? `–${p.end}` : ''}` : ''
        await notifyStaff(admin, p.id, { tipo: 'staff_schedule_confirmed', titulo: `${day} · confirmed / 確定`, mensagem: hours ? `Your shift on ${day}: ${hours}` : `You are on the list for ${day}` })
      }
    }
    return res.status(200).json({ ok: true, schedule: row })
  }

  if (body.action === 'saveScheduleRules') {
    const patch = cleanScheduleRules(body)
    const existing = await runLiveOp(db, { table: 'bar_goals', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: barId }], wantSingle: 'maybe' })
    const base = existing.data || { id: barId, bar_id: barId, noite: 0, hora: 0, semana: 0, turno: 0, lucro: 0, abre: 20, fecha: 5, corta: 0, pessoas: [] }
    const row = { ...base, ...patch, id: barId, bar_id: barId }
    const saved = await runLiveOp(db, {
      table: 'bar_goals', mode: existing.data ? 'update' : 'insert', filters: [{ op: 'eq', k: 'id', v: barId }],
      insertRows: [row], updatePatch: row, wantSingle: true,
    })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
    return res.status(200).json({ ok: true, rules: scheduleRules(row) })
  }

  if (body.action === 'remindSchedule') {
    const ids = [...new Set((Array.isArray(body.staff_ids) ? body.staff_ids : []).map(v => clip(v, 64)).filter(Boolean))].slice(0, 80)
    if (!ids.length) return res.status(400).json({ error: 'Pick who to remind' })
    const week = nextWeekOf()
    if (admin) {
      for (const id of ids) {
        await notifyStaff(admin, id, { tipo: 'staff_schedule_reminder', titulo: `${actor.nome || 'Manager'} · シフト提出`, mensagem: `Please send your shifts for the week of ${week.from} (start and end).` })
      }
    }
    return res.status(200).json({ ok: true, reminded: admin ? ids.length : 0 })
  }

  if (body.action === 'listFines') {
    const from = isDayKey(body.from) ? body.from : ''
    const to = isDayKey(body.to) ? body.to : ''
    return res.status(200).json({ fines: await fineRows(db, barId, { from, to, staffId: body.staff_id ? clip(body.staff_id, 64) : '' }) })
  }

  if (PAY_WRITE_ACTIONS.has(body.action) && !canWriteFines(auth.perfil)) {
    return res.status(403).json({ error: 'Only the owner or a manager can do this' })
  }

  if (body.action === 'saveFine') {
    const { fine, error } = cleanFine(body, { today: tokyoNightKey() })
    if (error) return res.status(400).json({ error })
    const row = {
      id: newId(), bar_id: barId, ...fine, status: 'active',
      created_by: actor.id, created_by_nome: actor.nome, created_at: new Date().toISOString(),
      cancelled_by: '', cancelled_by_nome: '', cancelled_at: null, cancel_note: '',
    }
    const saved = await runLiveOp(db, { table: 'staff_fines', mode: 'insert', insertRows: [row], wantSingle: true })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
    if (admin) await notifyStaff(admin, row.staff_id, { tipo: 'staff_fine', titulo: actor.nome || 'Manager', mensagem: `${row.day} · ¥${row.amount}${row.note ? ` · ${row.note}` : ''}`.slice(0, 200) })
    return res.status(200).json({ ok: true, fine: row })
  }

  if (body.action === 'cancelFine') {
    const hit = await runLiveOp(db, {
      table: 'staff_fines', mode: 'select', columns: '*',
      filters: [{ op: 'eq', k: 'id', v: String(body.id || '') }, { op: 'eq', k: 'bar_id', v: barId }], wantSingle: 'maybe',
    })
    if (!hit.data) return res.status(404).json({ error: 'Fine not found' })
    if (hit.data.status === 'cancelled') return res.status(200).json({ ok: true, fine: hit.data })
    // Never deleted: the row keeps who cancelled it and when (audit trail).
    const patch = { status: 'cancelled', cancelled_by: actor.id, cancelled_by_nome: actor.nome, cancelled_at: new Date().toISOString(), cancel_note: clip(body.note, 300) }
    const saved = await runLiveOp(db, { table: 'staff_fines', mode: 'update', filters: [{ op: 'eq', k: 'id', v: hit.data.id }], updatePatch: patch, wantSingle: true })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
    return res.status(200).json({ ok: true, fine: { ...hit.data, ...patch } })
  }

  if (body.action === 'saveFineSettings') {
    const patch = cleanFineSettings(body)
    const existing = await runLiveOp(db, { table: 'bar_goals', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: barId }], wantSingle: 'maybe' })
    const base = existing.data || { id: barId, bar_id: barId, noite: 0, hora: 0, semana: 0, turno: 0, lucro: 0, abre: 20, fecha: 5, corta: 0, pessoas: [] }
    const row = { ...base, ...patch, id: barId, bar_id: barId }
    const saved = await runLiveOp(db, {
      table: 'bar_goals', mode: existing.data ? 'update' : 'insert', filters: [{ op: 'eq', k: 'id', v: barId }],
      insertRows: [row], updatePatch: row, wantSingle: true,
    })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
    return res.status(200).json({ ok: true, settings: fineSettings(row) })
  }

  if (body.action === 'markSalaryPaid') {
    const { payout, error } = cleanPayout(body)
    if (error) return res.status(400).json({ error })
    // Fines are counted here from the fines table (the number on the screen is not trusted).
    const [y, m] = payout.month.split('-').map(Number)
    const last = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')
    const fines = finesTotal(await fineRows(db, barId, { staffId: payout.staff_id }), { staffId: payout.staff_id, from: `${payout.month}-01`, to: `${payout.month}-${last}` })
    const math = payNet({ hoursPay: body.hoursPay ?? body.pay, commission: body.commission ?? body.comm, rewards: body.rewards, fines, advances: payout.advances, deductions: payout.deductions })
    const row = {
      id: `${barId}:${payout.staff_id}:${payout.month}`, bar_id: barId, ...payout, gross: math.gross, fines: math.fines, net: math.net,
      status: 'paid', paid_at: new Date().toISOString(), paid_by: actor.id, paid_by_nome: actor.nome,
    }
    const saved = await upsertRow(db, 'staff_payouts', row)
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
    if (admin) await notifyStaff(admin, row.staff_id, { tipo: 'staff_payout', titulo: actor.nome || 'Owner', mensagem: `${row.month} · ¥${row.net}` })
    return res.status(200).json({ ok: true, payout: row })
  }

  if (body.action === 'unmarkSalaryPaid') {
    const id = String(body.id || '')
    const hit = await runLiveOp(db, { table: 'staff_payouts', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: id }, { op: 'eq', k: 'bar_id', v: barId }], wantSingle: 'maybe' })
    if (!hit.data) return res.status(404).json({ error: 'Payment not found' })
    const patch = { status: 'cancelled', cancelled_by: actor.id, cancelled_by_nome: actor.nome, cancelled_at: new Date().toISOString() }
    const saved = await runLiveOp(db, { table: 'staff_payouts', mode: 'update', filters: [{ op: 'eq', k: 'id', v: id }], updatePatch: patch, wantSingle: true })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
    return res.status(200).json({ ok: true, payout: { ...hit.data, ...patch } })
  }

  if (body.action === 'listPayouts') {
    const month = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? body.month : ''
    return res.status(200).json({ payouts: (await payoutRows(db, barId, { month })).filter(p => p.status !== 'cancelled') })
  }

  if (body.action === 'listDayReports') {
    const filters = [{ op: 'eq', k: 'bar_id', v: barId }]
    if (dayKey(body.night)) filters.push({ op: 'eq', k: 'night_key', v: body.night })
    const r = await runLiveOp(db, { table: 'staff_day_reports', mode: 'select', columns: '*', filters, orderBy: { k: 'criado_em', ascending: false }, limitN: 60 })
    return res.status(200).json({ reports: (r.data || []).map(reportView) })
  }
  return res.status(400).json({ error: 'Unknown action' })
}
