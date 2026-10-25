/** Dono do bar gerencia equipe, PIN, GPS e tablet. Não toca no fornecimento JBM. */

import { tryDrinksAdminClient, createStaffUserClient, drinksAuthClient } from './_supabaseAdmin.js'
import { requireBarAccount } from './_requireStaff.js'
import { hashSecret, randomTabletCode } from './_hash.js'
import {
  MAX_FAILS, COOLDOWN_MS, MONEY_KINDS, PAY_FIELDS, areaOpen, cleanAreas, cleanMinutes, hashPin, loadLock, lockEnabled, pinMatches,
  publicLock, saveLock, signUnlock, validPin, verifyUnlock, UNLOCK_HEADER,
} from './_barVault.js'
import { isMissingSchemaError, loadBarWithGeo, listStaffWithExtras, runLiveOp, saveBarGeo, saveStaffExtras } from './_barLiveStore.js'
import { forgetBarActors } from './_barLaneAuth.js'
import { canAccess, canEditAccessOf, canManageLogin, cleanAcessos, isRestricted, staffActionAreas } from '../src/lib/barAccess.js'
import { denyMissingArea } from './_barAccess.js'
import { OWNER_ACTIONS, PAY_WRITE_ACTIONS, SELF_ACTIONS, handleOwnerAction, handleSelfAction, setLoginEmail } from './_staffSelf.js'
import { canLinkLogin, carryFromPerson, personLinkPatch, remapIds, remapSheet } from '../src/lib/staffLink.js'
import { castRoster } from '../src/lib/staffPos.js'

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

function asList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean)
  if (!value) return []
  return String(value).split(',').map(v => v.trim()).filter(Boolean)
}

/** Phone and sex from "Users & access" (staff_extras). Phone keeps digits and + - ( ) spaces; sex is 'm', 'f' or ''. */
function contactExtras(body) {
  const extra = {}
  if (body.telefone != null) extra.telefone = String(body.telefone || '').replace(/[^\d+\-() ]/g, '').trim().slice(0, 30)
  if (body.sexo != null) extra.sexo = body.sexo === 'm' || body.sexo === 'f' ? body.sexo : ''
  return extra
}

function profileExtras(body) {
  const extra = contactExtras(body)
  if (body.cargo != null) extra.cargo = String(body.cargo || '').trim()
  if (body.dias != null) extra.dias = asList(body.dias)
  if (body.idiomas != null) extra.idiomas = asList(body.idiomas)
  if (body.estilo != null) extra.estilo = String(body.estilo || '').trim()
  if (body.contato != null) extra.contato = String(body.contato || '').trim()
  if (body.email != null) extra.email = String(body.email || '').trim()
  if (body.endereco != null) extra.endereco = String(body.endereco || '').trim()
  if (body.notas != null) extra.notas = String(body.notas || '').trim()
  if (body.aniversario != null) extra.aniversario = String(body.aniversario || '').slice(0, 10)
  if (body.vence_dia != null) extra.vence_dia = Math.max(0, Math.min(31, Math.round(+body.vence_dia || 0)))
  if (body.prazo_dias != null) extra.prazo_dias = Math.max(0, Math.min(90, Math.round(+body.prazo_dias || 0)))
  return extra
}

const CONTRACT_TYPES = ['seishain', 'part', 'gyomu', 'haken', 'trial', 'other']
const isoDay = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '')

/** Employee file fields (people only). Photo and contract are private storage paths under staff-files/<bar>/. */
function employeeExtras(body, barId) {
  const extra = {}
  const ownPath = v => {
    const path = String(v || '')
    return path.startsWith(`${STAFF_FILES}/${barId}/`) ? path : ''
  }
  if (body.foto != null) extra.foto = ownPath(body.foto)
  if (body.contrato_tipo != null) extra.contrato_tipo = CONTRACT_TYPES.includes(body.contrato_tipo) ? body.contrato_tipo : ''
  if (body.contrato_inicio != null) extra.contrato_inicio = isoDay(body.contrato_inicio)
  if (body.contrato_fim != null) extra.contrato_fim = isoDay(body.contrato_fim)
  if (body.contrato_doc != null) extra.contrato_doc = ownPath(body.contrato_doc)
  if (body.contrato_doc_nome != null) extra.contrato_doc_nome = String(body.contrato_doc_nome || '').trim().slice(0, 120)
  if (body.condicoes != null) extra.condicoes = String(body.condicoes || '').trim().slice(0, 2000)
  if (body.banco != null) extra.banco = String(body.banco || '').trim().slice(0, 200)
  return extra
}

const STAFF_FILES = 'staff-files'
const STAFF_FILE_BUCKET = 'system-private'
const STAFF_FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const STAFF_FILE_MAX = 3 * 1024 * 1024

/** Registry rows only: how and when a cost is paid; which card machine, where it is used, where it pays out. */
function costExtras(body) {
  const extra = {}
  if (body.metodo != null) extra.metodo = String(body.metodo || '').trim().slice(0, 40)
  if (body.data_pagamento != null) extra.data_pagamento = /^\d{4}-\d{2}-\d{2}$/.test(String(body.data_pagamento)) ? String(body.data_pagamento) : ''
  if (body.maquina != null) extra.maquina = String(body.maquina || '').trim().slice(0, 80)
  if (body.local != null) extra.local = String(body.local || '').trim().slice(0, 80)
  if (body.conta != null) extra.conta = String(body.conta || '').trim().slice(0, 120)
  if (body.bandeiras != null) extra.bandeiras = asList(body.bandeiras).slice(0, 12)
  return extra
}

/** Business partners (kind fornecedor): last and next service day, and what the cost is per. */
function partnerExtras(body) {
  const extra = {}
  if (body.ultimo_servico != null) extra.ultimo_servico = isoDay(body.ultimo_servico)
  if (body.proximo_servico != null) extra.proximo_servico = isoDay(body.proximo_servico)
  if (body.custo_por != null) extra.custo_por = ['visit', 'month', 'order'].includes(body.custo_por) ? body.custo_por : ''
  return extra
}

function payExtras(body) {
  const extra = {}
  if (body.salario_hora != null) extra.salario_hora = +body.salario_hora || 0
  if (body.salario_mes != null) extra.salario_mes = +body.salario_mes || 0
  if (body.drink_back != null) extra.drink_back = !!body.drink_back
  if (body.comissao_pct != null) extra.comissao_pct = +body.comissao_pct || 0
  if (body.drink_back === false) extra.comissao_pct = 0
  if (body.transporte != null) extra.transporte = Math.max(0, Math.round(+body.transporte || 0))
  return extra
}

async function loadAgents(db, barId) {
  const pg = await db.from('drink_back_agents').select('id,nome,notas,ativo,comissao_pct,bar_id').eq('bar_id', barId)
  if (!pg.error) return { rows: pg.data || [], live: false }
  if (!isMissingSchemaError(pg.error)) return { rows: [], live: false, error: pg.error.message }
  const live = await runLiveOp(db, {
    table: 'drink_back_agents',
    mode: 'select',
    columns: '*',
    filters: [{ op: 'eq', k: 'bar_id', v: barId }],
  })
  return { rows: live.data || [], live: true, error: live.error?.message }
}

async function syncDrinkBackAgent(db, barId, staffId, { nome, drink_back, comissao_pct }) {
  const tag = `staff:${staffId}`
  const loaded = await loadAgents(db, barId)
  if (loaded.error) return { ok: false, error: loaded.error }
  const hit = (loaded.rows || []).find(a => a.notas === tag || a.staff_id === staffId)
  if (drink_back !== true && !hit) return { ok: true }
  if (drink_back === false) {
    if (!hit) return { ok: true }
    if (loaded.live) {
      await runLiveOp(db, {
        table: 'drink_back_agents',
        mode: 'update',
        filters: [{ op: 'eq', k: 'id', v: hit.id }],
        updatePatch: { ativo: false },
      })
      return { ok: true }
    }
    const upd = await db.from('drink_back_agents').update({ ativo: false }).eq('id', hit.id)
    if (upd.error) return { ok: false, error: upd.error.message }
    return { ok: true }
  }
  const patch = {
    nome: nome || hit?.nome || 'Cast',
    comissao_pct: +comissao_pct || 0,
    ativo: true,
    notas: tag,
    bar_id: barId,
  }
  if (loaded.live) {
    if (hit) {
      await runLiveOp(db, {
        table: 'drink_back_agents',
        mode: 'update',
        filters: [{ op: 'eq', k: 'id', v: hit.id }],
        updatePatch: patch,
      })
    } else {
      await runLiveOp(db, {
        table: 'drink_back_agents',
        mode: 'insert',
        insertRows: [patch],
        wantSingle: true,
      })
    }
    return { ok: true }
  }
  if (hit) {
    let upd = await db.from('drink_back_agents').update(patch).eq('id', hit.id)
    if (upd.error && /notas/.test(upd.error.message || '')) {
      const { notas, ...rest } = patch
      upd = await db.from('drink_back_agents').update(rest).eq('id', hit.id)
    }
    if (upd.error) return { ok: false, error: upd.error.message }
    return { ok: true }
  }
  let ins = await db.from('drink_back_agents').insert(patch).select('id').single()
  if (ins.error && /notas/.test(ins.error.message || '')) {
    const { notas, ...rest } = patch
    ins = await db.from('drink_back_agents').insert(rest).select('id').single()
  }
  if (ins.error && isMissingSchemaError(ins.error)) {
    await runLiveOp(db, { table: 'drink_back_agents', mode: 'insert', insertRows: [patch], wantSingle: true })
    return { ok: true }
  }
  if (ins.error) return { ok: false, error: ins.error.message }
  return { ok: true }
}

/** One bar_people row of this bar, or null. */
async function loadPerson(db, barId, personId) {
  if (!personId) return null
  const hit = await runLiveOp(db, {
    table: 'bar_people',
    mode: 'select',
    columns: '*',
    filters: [{ op: 'eq', k: 'id', v: String(personId) }, { op: 'eq', k: 'bar_id', v: barId }],
    wantSingle: 'maybe',
  })
  return hit.data || null
}

/** Why `person` cannot be linked to `loginId` (missing, or already folded into another login), or ''. */
function personLinkError(person, loginId) {
  if (!person) return 'Employee not found'
  if (person.merged_into && person.merged_into !== loginId) return 'This employee is already linked to another login'
  return ''
}

/** Move the drink-back agent of the employee file onto the login, so commission history stays with the person. */
async function retagDrinkBackAgent(db, barId, fromId, toId) {
  const loaded = await loadAgents(db, barId)
  if (loaded.error) return
  const rows = loaded.rows || []
  const hit = rows.find(a => a.notas === `staff:${fromId}` || a.staff_id === fromId)
  if (!hit || rows.some(a => a.notas === `staff:${toId}` || a.staff_id === toId)) return
  const patch = { notas: `staff:${toId}` }
  if (loaded.live) await runLiveOp(db, { table: 'drink_back_agents', mode: 'update', filters: [{ op: 'eq', k: 'id', v: hit.id }], updatePatch: patch })
  else await db.from('drink_back_agents').update(patch).eq('id', hit.id)
}

/** Goal people and day-sheet marks saved under the employee id now point at the login. */
async function remapPersonRefs(db, barId, fromId, toId) {
  const goals = await runLiveOp(db, { table: 'bar_goals', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: barId }], wantSingle: 'maybe' })
  const pessoas = remapIds(goals.data?.pessoas, fromId, toId)
  if (pessoas) {
    await runLiveOp(db, { table: 'bar_goals', mode: 'update', filters: [{ op: 'eq', k: 'id', v: barId }], updatePatch: { pessoas }, wantSingle: true })
  }
  const sheets = await runLiveOp(db, { table: 'bar_day_sheet', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'bar_id', v: barId }] })
  for (const sheet of sheets.data || []) {
    const next = remapSheet(sheet, fromId, toId)
    if (!next) continue
    await runLiveOp(db, { table: 'bar_day_sheet', mode: 'update', filters: [{ op: 'eq', k: 'id', v: sheet.id }], updatePatch: { late: next.late, absent: next.absent }, wantSingle: true })
  }
}

/**
 * Link an employee file (bar_people) to a perfis login: copy the file onto the login's extras (person_id
 * points back), name the login after the employee, mark the bar_people row merged (kept, never deleted)
 * and move goal / day-sheet / drink-back references to the login id.
 */
async function linkPersonToLogin(db, barId, person, loginId, { rename = true, admin = null } = {}) {
  const extras = await saveStaffExtras(db, loginId, carryFromPerson(person))
  if (!extras.ok) return { ok: false, error: extras.error || 'Could not save' }
  // The employee file's e-mail becomes the sign-in e-mail too (one e-mail per person).
  let email = ''
  if (admin && String(person.email || '').includes('@')) {
    const r = await setLoginEmail(admin, db, loginId, person.email)
    if (r.ok) email = r.email
  }
  if (rename && String(person.nome || '').trim()) {
    await db.from('perfis').update({ nome: String(person.nome).trim().slice(0, 80) }).eq('id', loginId)
  }
  const marked = await runLiveOp(db, {
    table: 'bar_people',
    mode: 'update',
    filters: [{ op: 'eq', k: 'id', v: person.id }, { op: 'eq', k: 'bar_id', v: barId }],
    updatePatch: personLinkPatch(loginId),
    wantSingle: true,
  })
  if (marked.error) return { ok: false, error: marked.error.message || 'Could not save' }
  // A store that silently drops unknown columns would leave the employee listed twice: say so instead.
  if (marked.data && marked.data.merged_into !== loginId) return { ok: false, error: 'Could not mark the employee file as linked' }
  await retagDrinkBackAgent(db, barId, person.id, loginId).catch(() => {})
  await remapPersonRefs(db, barId, person.id, loginId).catch(() => {})
  return { ok: true, email }
}

/** Undo a link: the employee file shows on its own again; the login keeps the fields it already has. */
async function unlinkLogin(db, barId, loginId, personId) {
  if (personId) {
    const person = await loadPerson(db, barId, personId)
    if (person && person.merged_into === loginId) {
      await runLiveOp(db, {
        table: 'bar_people',
        mode: 'update',
        filters: [{ op: 'eq', k: 'id', v: person.id }, { op: 'eq', k: 'bar_id', v: barId }],
        updatePatch: personLinkPatch(''),
        wantSingle: true,
      })
    }
  }
  return saveStaffExtras(db, loginId, { person_id: '' })
}

/** PATCH for a lane login (bar_logins row of this bar): name, on/off, till/floor role, area list. Never the password hash. */
async function patchLaneLogin(req, res, db, auth, barId, body) {
  const hit = await runLiveOp(db, {
    table: 'bar_logins',
    mode: 'select',
    columns: '*',
    filters: [{ op: 'eq', k: 'id', v: body.id }, { op: 'eq', k: 'bar_id', v: barId }],
    wantSingle: 'maybe',
  })
  const login = hit.data
  if (!login) return res.status(404).json({ error: 'Staff not found' })
  const target = { id: login.id, role: login.role }
  if (!canManageLogin(auth.perfil, target)) return res.status(403).json({ error: 'You cannot change this login' })
  const nextAcessos = body.acessos === undefined ? undefined : cleanAcessos(body.acessos)
  if (nextAcessos !== undefined && !canEditAccessOf(auth.perfil, target, nextAcessos)) {
    return res.status(403).json({ error: 'You cannot give this login those areas' })
  }
  const patch = {}
  if (body.nome != null && String(body.nome).trim()) patch.nome = String(body.nome).trim().slice(0, 80)
  if (body.ativo != null) patch.ativo = !!body.ativo
  if (body.role === 'caixa' || body.role === 'bar_staff') patch.role = body.role
  if (Object.keys(patch).length) {
    const saved = await runLiveOp(db, {
      table: 'bar_logins',
      mode: 'update',
      filters: [{ op: 'eq', k: 'id', v: login.id }],
      updatePatch: patch,
      wantSingle: true,
    })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
  }
  const extraPatch = contactExtras(body)
  if (body.ativo != null) extraPatch.ativo = !!body.ativo
  if (nextAcessos !== undefined) extraPatch.acessos = nextAcessos
  if (Object.keys(extraPatch).length) {
    // Straight to staff_extras: a lane id has no perfis row, so saveStaffExtras would send `ativo` nowhere.
    const prev = await runLiveOp(db, { table: 'staff_extras', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: login.id }], wantSingle: 'maybe' })
    const saved = await runLiveOp(db, {
      table: 'staff_extras',
      mode: prev.data ? 'update' : 'insert',
      filters: [{ op: 'eq', k: 'id', v: login.id }],
      insertRows: [{ id: login.id, ...extraPatch }],
      updatePatch: extraPatch,
      wantSingle: true,
    })
    if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
  }
  forgetBarActors()
  return res.status(200).json({ ok: true })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const admin = tryDrinksAdminClient()

  // Any bar login may ask which areas it may open (menu + routes). Nothing else here is open to till/floor logins.
  if (req.method === 'POST') {
    let early = {}
    try { early = bodyOf(req) } catch { early = {} }
    if (early.action === 'myAccess') {
      const me = await requireBarAccount(req, admin, { allowDisabled: true })
      if (me.error) return res.status(me.status).json({ error: me.error })
      const owner = me.perfil.role === 'cliente'
      return res.status(200).json({
        role: me.perfil.role,
        acessos: owner ? null : (me.perfil.acessos ?? null),
        disabled: owner ? false : !!me.disabled,
      })
    }
    // Staff app self-service (own day, profile photo, requests, earnings): any active bar login, own rows only.
    if (SELF_ACTIONS.has(early.action)) {
      const me = await requireBarAccount(req, admin)
      if (me.error) return res.status(me.status).json({ error: me.error })
      const selfDb = admin || (me.token ? createStaffUserClient(me.token) : null)
      if (!selfDb) return res.status(500).json({ error: 'Database client unavailable' })
      try {
        return await handleSelfAction(res, { admin, db: selfDb, auth: me, body: early })
      } catch (e) {
        return res.status(500).json({ error: e.message || 'Failed' })
      }
    }
    // Staff POS: who can be marked on a sale (name and id only, never pay, contact or access fields).
    if (early.action === 'castRoster') {
      const me = await requireBarAccount(req, admin)
      if (me.error) return res.status(me.status).json({ error: me.error })
      const db = admin || (me.token ? createStaffUserClient(me.token) : null)
      if (!db) return res.status(500).json({ error: 'Database client unavailable' })
      try {
        const [staff, agents] = await Promise.all([listStaffWithExtras(db, me.perfil.bar_id), loadAgents(db, me.perfil.bar_id)])
        return res.status(200).json({ people: castRoster(staff, agents.rows) })
      } catch (e) {
        return res.status(500).json({ error: e?.message || 'Could not load the team' })
      }
    }
  }

  const auth = await requireBarAccount(req, admin, { roles: ['cliente', 'gerente'] })
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const barId = auth.perfil.bar_id
  const db = admin || (auth.token ? createStaffUserClient(auth.token) : null)
  if (!db) return res.status(500).json({ error: 'Database client unavailable' })

  try {
    if (req.method === 'GET') {
      const [staff, bar] = await Promise.all([
        listStaffWithExtras(db, barId),
        loadBarWithGeo(db, barId),
      ])
      const peopleLive = await runLiveOp(db, {
        table: 'bar_people',
        mode: 'select',
        columns: '*',
        filters: [{ op: 'eq', k: 'bar_id', v: barId }],
      })
      // A manager limited in "Users & access": no cost rows without money, no pay/contract fields without payroll.
      const seesPay = canAccess(auth.perfil, 'payroll')
      const hidePay = row => {
        if (seesPay || !row) return row
        const out = { ...row }
        for (const k of [...PAY_FIELDS, 'banco', 'condicoes', 'contrato_doc', 'contrato_doc_nome']) delete out[k]
        return out
      }
      const registryRows = (await runLiveOp(db, {
        table: 'bar_registry',
        mode: 'select',
        columns: '*',
        filters: [{ op: 'eq', k: 'bar_id', v: barId }],
      })).data || []
      return res.status(200).json({
        staff: (staff || []).map(hidePay),
        // Employee files folded into a login (merged_into) show once, as that login.
        people: (peopleLive.data || []).filter(p => !p.merged_into).map(hidePay),
        registry: canAccess(auth.perfil, 'money') ? registryRows : registryRows.filter(r => r.kind === 'fornecedor' || r.kind === 'parceiro'),
        goals: (await runLiveOp(db, {
          table: 'bar_goals',
          mode: 'select',
          columns: '*',
          filters: [{ op: 'eq', k: 'bar_id', v: barId }],
          wantSingle: 'maybe',
        })).data || null,
        events: (await runLiveOp(db, {
          table: 'bar_events',
          mode: 'select',
          columns: '*',
          filters: [{ op: 'eq', k: 'bar_id', v: barId }],
        })).data || [],
        sheets: (await runLiveOp(db, {
          table: 'bar_day_sheet',
          mode: 'select',
          columns: '*',
          filters: [{ op: 'eq', k: 'bar_id', v: barId }],
          orderBy: { k: 'night_key', ascending: false },
          limitN: 90,
        })).data || [],
        bar: {
          id: bar?.id,
          nome: bar?.nome,
          lat: bar?.lat,
          lng: bar?.lng,
          geofence_m: bar?.geofence_m || 150,
          tabletPaired: Boolean(bar?.tablet_token_hash),
        },
      })
    }

    const body = bodyOf(req)
    const uid = auth.user?.id || ''

    // Areas from "Users & access" (owner never limited; no list = today's behaviour). Registry rows use the stored kind.
    let registryKind = ''
    if (req.method === 'POST' && ['deleteRegistry', 'saveRegistry'].includes(body.action) && body.id) {
      const hit = await runLiveOp(db, { table: 'bar_registry', mode: 'select', columns: 'id,kind', filters: [{ op: 'eq', k: 'id', v: body.id }, { op: 'eq', k: 'bar_id', v: barId }], wantSingle: 'maybe' })
      registryKind = String(hit.data?.kind || '')
    }
    if (denyMissingArea(res, auth.perfil, staffActionAreas(req.method, body, { registryKind }))) return

    // ── Owner PIN for money and payroll ──────────────────────────────────────
    if (req.method === 'POST' && ['lockStatus', 'unlock', 'setLock'].includes(body.action)) {
      const lock = await loadLock(db, barId)
      const pub = publicLock(lock)
      if (body.action === 'lockStatus') {
        const token = verifyUnlock(req.headers?.[UNLOCK_HEADER], { barId, uid })
        return res.status(200).json({ ...pub, unlockedUntil: token?.exp || 0, canEdit: auth.perfil.role === 'cliente' })
      }
      if (body.action === 'unlock') {
        if (!lockEnabled(lock)) return res.status(400).json({ error: 'No PIN is set' })
        const now = Date.now()
        if (+lock.locked_until > now) return res.status(429).json({ error: 'Too many wrong PINs', retryAt: +lock.locked_until })
        if (!pinMatches(body.pin, lock)) {
          const fails = (+lock.fails || 0) + 1
          const patch = fails >= MAX_FAILS ? { fails: 0, locked_until: now + COOLDOWN_MS } : { fails }
          await saveLock(db, barId, { ...lock, ...patch }, true)
          return res.status(fails >= MAX_FAILS ? 429 : 401).json({ error: 'Wrong PIN', left: Math.max(0, MAX_FAILS - fails), retryAt: patch.locked_until || 0 })
        }
        if (+lock.fails) await saveLock(db, barId, { ...lock, fails: 0, locked_until: 0 }, true)
        const { token, exp } = signUnlock({ barId, uid, minutes: pub.minutes })
        return res.status(200).json({ ok: true, token, exp, areas: pub.areas })
      }
      // setLock: only the owner sets, changes or removes the PIN. Changing it needs the current PIN or the account password.
      if (auth.perfil.role !== 'cliente') return res.status(403).json({ error: 'Only the owner can change the PIN' })
      if (lock?.pin_hash) {
        let ok = pinMatches(body.currentPin, lock)
        if (!ok && body.password && auth.user?.email) {
          const check = await drinksAuthClient().auth.signInWithPassword({ email: auth.user.email, password: String(body.password) })
          ok = !check.error && check.data?.user?.id === uid
        }
        if (!ok) return res.status(401).json({ error: 'Current PIN or password is wrong' })
      }
      if (body.disable) {
        await saveLock(db, barId, { pin_hash: '', pin_salt: '', areas: [], minutes: 15, fails: 0, locked_until: 0, updated_at: new Date().toISOString(), updated_by: uid }, !!lock)
        return res.status(200).json({ ok: true, ...publicLock(null) })
      }
      const areas = cleanAreas(body.areas)
      if (!areas.length) return res.status(400).json({ error: 'Pick at least one area' })
      let pin = { salt: lock?.pin_salt || '', hash: lock?.pin_hash || '' }
      if (body.newPin != null && body.newPin !== '') {
        if (!validPin(body.newPin)) return res.status(400).json({ error: 'PIN must be 4 to 8 digits' })
        pin = hashPin(body.newPin)
      }
      if (!pin.hash) return res.status(400).json({ error: 'Set a PIN' })
      const row = { pin_hash: pin.hash, pin_salt: pin.salt, areas, minutes: cleanMinutes(body.minutes), fails: 0, locked_until: 0, updated_at: new Date().toISOString(), updated_by: uid }
      const saved = await saveLock(db, barId, row, !!lock)
      if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
      return res.status(200).json({ ok: true, ...publicLock(row) })
    }

    // Money and payroll changes need the PIN when the owner locked those areas.
    const needsMoney = (body.action === 'saveRegistry' && MONEY_KINDS.has(String(body.kind || '')))
      || body.action === 'deleteRegistry'
    const needsPayroll = ['savePerson', 'createStaff'].includes(body.action) || req.method === 'PATCH'
    const sendsPay = PAY_FIELDS.some(k => body[k] != null)
    const sendsContract = body.action === 'uploadStaffFile' && body.kind === 'contrato'
    // Fines and "salary paid" change what a person is paid: same PIN as pay fields.
    const movesPay = PAY_WRITE_ACTIONS.has(body.action)
    if (needsMoney || (needsPayroll && sendsPay) || sendsContract || movesPay) {
      const lock = await loadLock(db, barId)
      if (lockEnabled(lock)) {
        let area = needsMoney ? 'money' : 'payroll'
        if (body.action === 'deleteRegistry') {
          const hit = await runLiveOp(db, { table: 'bar_registry', mode: 'select', columns: 'id,kind', filters: [{ op: 'eq', k: 'id', v: body.id }, { op: 'eq', k: 'bar_id', v: barId }], wantSingle: 'maybe' })
          if (!MONEY_KINDS.has(String(hit.data?.kind || ''))) area = null
        }
        if (area && !areaOpen(req, lock, area, { barId, uid })) return res.status(423).json({ error: 'Locked: enter the PIN first', locked: area })
      }
    }

    // Employee photo / contract: private bucket, written by the server only; the screen gets short signed links.
    if (req.method === 'POST' && body.action === 'uploadStaffFile') {
      if (!admin) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' })
      const kind = body.kind === 'contrato' ? 'contrato' : 'foto'
      const ext = STAFF_FILE_TYPES[String(body.contentType || '')]
      if (!ext || (kind === 'foto' && ext === 'pdf')) return res.status(400).json({ error: 'Use a JPG, PNG, WebP or PDF file' })
      const personId = String(body.personId || 'new').replace(/[^\w-]/g, '').slice(0, 64) || 'new'
      const buf = Buffer.from(String(body.data || ''), 'base64')
      if (!buf.length) return res.status(400).json({ error: 'Empty file' })
      if (buf.length > STAFF_FILE_MAX) return res.status(400).json({ error: 'File too large (3 MB max)' })
      const path = `${STAFF_FILES}/${barId}/${personId}/${kind}-${Date.now()}.${ext}`
      const { error } = await admin.storage.from(STAFF_FILE_BUCKET).upload(path, buf, { contentType: body.contentType, upsert: false })
      if (error) return res.status(400).json({ error: error.message || 'Upload failed' })
      return res.status(200).json({ ok: true, path })
    }

    if (req.method === 'POST' && body.action === 'staffFileUrls') {
      if (!admin) return res.status(200).json({ urls: {} })
      const prefix = `${STAFF_FILES}/${barId}/`
      const paths = [...new Set((Array.isArray(body.paths) ? body.paths : []).map(String))].filter(p => p.startsWith(prefix)).slice(0, 100)
      if (!paths.length) return res.status(200).json({ urls: {} })
      const { data } = await admin.storage.from(STAFF_FILE_BUCKET).createSignedUrls(paths, 600)
      const urls = {}
      for (const row of data || []) if (row?.signedUrl && row.path) urls[row.path] = row.signedUrl
      return res.status(200).json({ urls })
    }

    if (req.method === 'POST' && OWNER_ACTIONS.has(body.action)) {
      return handleOwnerAction(res, { admin, db, auth, body })
    }

    if (req.method === 'POST' && body.action === 'pairTablet') {
      const code = randomTabletCode()
      const saved = await saveBarGeo(db, barId, { tablet_token_hash: hashSecret(code) })
      if (!saved.ok) return res.status(400).json({ error: saved.error })
      return res.status(200).json({ ok: true, tabletToken: code })
    }

    if (req.method === 'POST' && body.action === 'saveLocation') {
      const saved = await saveBarGeo(db, barId, {
        lat: +body.lat,
        lng: +body.lng,
        geofence_m: Math.max(50, Math.min(500, +body.geofence_m || 150)),
      })
      if (!saved.ok) return res.status(400).json({ error: saved.error })
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'POST' && body.action === 'saveDaySheet') {
      const night = String(body.night_key || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return res.status(400).json({ error: 'night required' })
      const marks = (list) => {
        if (!Array.isArray(list)) return []
        const seen = new Set()
        const out = []
        for (const p of list) {
          const id = String(p?.id || '').trim()
          const nome = String(p?.nome || '').trim()
          if (!id || !nome || seen.has(id)) continue
          seen.add(id)
          out.push({ id, nome })
          if (out.length >= 80) break
        }
        return out
      }
      const absent = marks(body.absent)
      const absentIds = new Set(absent.map(p => p.id))
      const late = marks(body.late).filter(p => !absentIds.has(p.id))
      const dj = body.dj === true || body.dj === 'true'
      const id = `${barId}:${night}`
      const row = {
        id,
        bar_id: barId,
        night_key: night,
        late,
        absent,
        dj,
        dj_nome: dj ? String(body.dj_nome || '').trim().slice(0, 80) : '',
        dj_custo: dj ? Math.max(0, Math.round(+body.dj_custo || 0)) : 0,
      }
      // Tonight's mission and each person's role (shown to staff when they clock in).
      if (body.missao != null) row.missao = String(body.missao || '').trim().slice(0, 300)
      if (body.roles && typeof body.roles === 'object' && !Array.isArray(body.roles)) {
        const roles = {}
        for (const [k, v] of Object.entries(body.roles).slice(0, 80)) {
          const text = String(v || '').trim().slice(0, 80)
          if (k && text) roles[String(k).slice(0, 64)] = text
        }
        row.roles = roles
      }
      const existing = await runLiveOp(db, {
        table: 'bar_day_sheet',
        mode: 'select',
        columns: '*',
        filters: [{ op: 'eq', k: 'id', v: id }],
        wantSingle: 'maybe',
      })
      const saved = await runLiveOp(db, {
        table: 'bar_day_sheet',
        mode: existing.data ? 'update' : 'insert',
        filters: [{ op: 'eq', k: 'id', v: id }],
        insertRows: [row],
        updatePatch: row,
        wantSingle: true,
      })
      if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
      return res.status(200).json({ ok: true, sheet: row })
    }

    if (req.method === 'POST' && body.action === 'saveEvent') {
      const titulo = String(body.titulo || '').trim()
      if (!titulo) return res.status(400).json({ error: 'title required' })
      const status = ['ideia', 'confirmado', 'descartado'].includes(body.status) ? body.status : 'ideia'
      const id = body.id || (globalThis.crypto?.randomUUID?.() || `evt-${Date.now()}`)
      const row = {
        id,
        bar_id: barId,
        titulo,
        data: String(body.data || '').slice(0, 10),
        origem: String(body.origem || ''),
        pessoa_id: String(body.pessoa_id || ''),
        pessoa_nome: String(body.pessoa_nome || '').trim(),
        nota: String(body.nota || '').trim(),
        status,
      }
      const existing = await runLiveOp(db, {
        table: 'bar_events',
        mode: 'select',
        columns: '*',
        filters: [{ op: 'eq', k: 'id', v: id }],
        wantSingle: 'maybe',
      })
      const saved = await runLiveOp(db, {
        table: 'bar_events',
        mode: existing.data ? 'update' : 'insert',
        filters: [{ op: 'eq', k: 'id', v: id }],
        insertRows: [row],
        updatePatch: row,
        wantSingle: true,
      })
      if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
      return res.status(200).json({ ok: true, event: row })
    }

    if (req.method === 'POST' && body.action === 'saveGoals') {
      const hour = (n, fallback) => {
        const v = body[n] == null || body[n] === '' ? fallback : Math.round(+body[n])
        return ((v % 24) + 24) % 24
      }
      const pessoas = Array.isArray(body.pessoas) ? body.pessoas.map(p => ({
        id: String(p.id || ''),
        nome: String(p.nome || '').trim(),
        noite: Math.round(+p.noite || 0),
        semana: Math.round(+p.semana || 0),
      })).filter(p => p.id && p.nome) : []
      const existing = await runLiveOp(db, {
        table: 'bar_goals',
        mode: 'select',
        columns: '*',
        filters: [{ op: 'eq', k: 'id', v: barId }],
        wantSingle: 'maybe',
      })
      const row = {
        ...(existing.data || {}),
        id: barId,
        bar_id: barId,
        noite: Math.round(+body.noite || 0),
        hora: Math.round(+body.hora || 0),
        semana: Math.round(+body.semana || 0),
        turno: Math.round(+body.turno || 0),
        lucro: Math.round(+body.lucro || 0),
        abre: hour('abre', 20),
        fecha: hour('fecha', 5),
        corta: hour('corta', 0),
        pessoas,
      }
      if (body.missao != null) row.missao = String(body.missao || '').trim().slice(0, 300)
      if (body.mes != null) row.mes = Math.max(0, Math.round(+body.mes || 0))
      if (body.fecha_semana != null) row.fecha_semana = ((Math.round(+body.fecha_semana) % 7) + 7) % 7
      if (body.dia_salario != null) row.dia_salario = Math.max(1, Math.min(28, Math.round(+body.dia_salario || 25)))
      if (body.dia_drink != null) row.dia_drink = Math.max(1, Math.min(28, Math.round(+body.dia_drink || 10)))
      if (body.dia_mes != null) row.dia_mes = Math.max(1, Math.min(28, Math.round(+body.dia_mes || 1)))
      const saved = await runLiveOp(db, {
        table: 'bar_goals',
        mode: existing.data ? 'update' : 'insert',
        filters: [{ op: 'eq', k: 'id', v: barId }],
        insertRows: [row],
        updatePatch: row,
        wantSingle: true,
      })
      if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
      return res.status(200).json({ ok: true, goals: row })
    }

    if (req.method === 'POST' && body.action === 'saveCloseSettings') {
      const existing = await runLiveOp(db, {
        table: 'bar_goals',
        mode: 'select',
        columns: '*',
        filters: [{ op: 'eq', k: 'id', v: barId }],
        wantSingle: 'maybe',
      })
      const base = existing.data || {
        id: barId,
        bar_id: barId,
        noite: 0,
        hora: 0,
        semana: 0,
        turno: 0,
        lucro: 0,
        abre: 20,
        fecha: 5,
        corta: 0,
        pessoas: [],
      }
      const row = { ...base, id: barId, bar_id: barId }
      if (body.fecha_semana != null) row.fecha_semana = ((Math.round(+body.fecha_semana) % 7) + 7) % 7
      if (body.dia_salario != null) row.dia_salario = Math.max(1, Math.min(28, Math.round(+body.dia_salario || 25)))
      if (body.dia_drink != null) row.dia_drink = Math.max(1, Math.min(28, Math.round(+body.dia_drink || 10)))
      if (body.dia_mes != null) row.dia_mes = Math.max(1, Math.min(28, Math.round(+body.dia_mes || 1)))
      if (body.caixa_saldo !== undefined) {
        // Money the bar has now (cash + bank), typed by the owner; null clears it.
        const v = body.caixa_saldo === null || body.caixa_saldo === '' ? null : Math.round(+body.caixa_saldo)
        row.caixa_saldo = Number.isFinite(v) ? Math.max(-1e11, Math.min(1e11, v)) : null
        row.caixa_saldo_em = /^\d{4}-\d{2}-\d{2}$/.test(String(body.caixa_saldo_em || '')) ? String(body.caixa_saldo_em) : null
      }
      if (body.pedido_modo != null) {
        const modo = String(body.pedido_modo)
        row.pedido_modo = ['queda', 'volume', 'segunda'].includes(modo) ? modo : 'queda'
      }
      if (body.pedido_qtd != null) row.pedido_qtd = Math.max(1, Math.min(99, Math.round(+body.pedido_qtd || 1)))
      if (body.pedido_min != null) row.pedido_min = Math.max(0, Math.min(999, Math.round(+body.pedido_min || 0)))
      if (body.pedido_em != null) row.pedido_em = String(body.pedido_em || '').slice(0, 10)
      if (body.pedido_feito != null) row.pedido_feito = String(body.pedido_feito || '').slice(0, 10)
      if (body.pedido_entrega !== undefined) {
        const day = Math.round(+body.pedido_entrega)
        row.pedido_entrega = body.pedido_entrega !== null && body.pedido_entrega !== '' && day >= 0 && day <= 6 ? day : null
      }
      if (body.pedido_qtds && typeof body.pedido_qtds === 'object') {
        const qtys = { ...(row.pedido_qtds || {}) }
        for (const [id, n] of Object.entries(body.pedido_qtds).slice(0, 500)) {
          const key = String(id).slice(0, 64)
          const qty = Math.max(0, Math.min(99, Math.round(+n || 0)))
          if (qty > 0) qtys[key] = qty
          else delete qtys[key]
        }
        row.pedido_qtds = qtys
      }
      const hourOf = (name, fallback) => ((Math.round(body[name] == null ? fallback : +body[name]) % 24) + 24) % 24
      if (body.abre != null) row.abre = hourOf('abre', 20)
      if (body.corta != null) row.corta = hourOf('corta', 0)
      if (body.hora_noite != null) {
        row.hora_noite = hourOf('hora_noite', 5)
        row.fecha = row.hora_noite
      }
      if (body.min_noite != null) row.min_noite = Math.max(0, Math.min(59, Math.round(+body.min_noite || 0)))
      if (body.hora_dia != null) row.hora_dia = hourOf('hora_dia', 18)
      if (body.min_dia != null) row.min_dia = Math.max(0, Math.min(59, Math.round(+body.min_dia || 0)))
      if (body.auto_noite != null) row.auto_noite = body.auto_noite !== false && body.auto_noite !== 'false'
      if (body.auto_dia != null) row.auto_dia = body.auto_dia !== false && body.auto_dia !== 'false'
      if (body.fechou_noite != null) row.fechou_noite = String(body.fechou_noite || '').slice(0, 10)
      if (body.fechou_dia != null) row.fechou_dia = String(body.fechou_dia || '').slice(0, 10)
      if (body.adicional_noturno != null) row.adicional_noturno = body.adicional_noturno !== false && body.adicional_noturno !== 'false'
      const saved = await runLiveOp(db, {
        table: 'bar_goals',
        mode: existing.data ? 'update' : 'insert',
        filters: [{ op: 'eq', k: 'id', v: barId }],
        insertRows: [row],
        updatePatch: row,
        wantSingle: true,
      })
      if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
      return res.status(200).json({ ok: true, goals: row })
    }

    if (req.method === 'POST' && body.action === 'saveRegistry') {
      const kind = String(body.kind || '')
      const allowed = ['fornecedor', 'parceiro', 'cartao', 'energia', 'aluguel', 'outro', 'fixo', 'variavel', 'contador', 'imposto']
      if (!allowed.includes(kind)) return res.status(400).json({ error: 'kind required' })
      const nome = String(body.nome || '').trim()
      if (!nome) return res.status(400).json({ error: 'name required' })
      const id = body.id || (globalThis.crypto?.randomUUID?.() || `reg-${Date.now()}`)
      const row = {
        id,
        bar_id: barId,
        kind,
        nome,
        contato: String(body.contato || '').trim(),
        detalhe: String(body.detalhe || '').trim(),
        amount: Math.round(+body.amount || 0),
        pct: +body.pct || 0,
        recorrente: body.recorrente !== false,
        month_key: body.recorrente === false ? String(body.month_key || '') : '',
        ...profileExtras(body),
        ...costExtras(body),
        ...(kind === 'fornecedor' ? partnerExtras(body) : {}),
      }
      const existing = await runLiveOp(db, {
        table: 'bar_registry',
        mode: 'select',
        columns: '*',
        filters: [{ op: 'eq', k: 'id', v: id }],
        wantSingle: 'maybe',
      })
      const saved = await runLiveOp(db, {
        table: 'bar_registry',
        mode: existing.data ? 'update' : 'insert',
        filters: [{ op: 'eq', k: 'id', v: id }],
        insertRows: [row],
        updatePatch: row,
        wantSingle: true,
      })
      if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
      return res.status(200).json({ ok: true, row })
    }

    if (req.method === 'POST' && body.action === 'deleteRegistry') {
      if (!body.id) return res.status(400).json({ error: 'id required' })
      await runLiveOp(db, {
        table: 'bar_registry',
        mode: 'delete',
        filters: [{ op: 'eq', k: 'id', v: body.id }, { op: 'eq', k: 'bar_id', v: barId }],
      })
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'POST' && body.action === 'savePerson') {
      const nome = String(body.nome || '').trim()
      if (!nome) return res.status(400).json({ error: 'name required' })
      const id = body.id || (globalThis.crypto?.randomUUID?.() || `person-${Date.now()}`)
      const row = {
        id,
        bar_id: barId,
        nome,
        salario_hora: +body.salario_hora || 0,
        salario_mes: +body.salario_mes || 0,
        drink_back: !!body.drink_back,
        comissao_pct: body.drink_back ? (+body.comissao_pct || 0) : 0,
        transporte: Math.max(0, Math.round(+body.transporte || 0)),
        ...profileExtras(body),
        ...employeeExtras(body, barId),
      }
      const existing = await runLiveOp(db, {
        table: 'bar_people',
        mode: 'select',
        columns: '*',
        filters: [{ op: 'eq', k: 'id', v: id }],
        wantSingle: 'maybe',
      })
      const saved = await runLiveOp(db, {
        table: 'bar_people',
        mode: existing.data ? 'update' : 'insert',
        filters: [{ op: 'eq', k: 'id', v: id }],
        insertRows: [row],
        updatePatch: row,
        wantSingle: true,
      })
      if (saved.error) return res.status(400).json({ error: saved.error.message || 'Could not save' })
      const drink = await syncDrinkBackAgent(db, barId, id, {
        nome,
        drink_back: row.drink_back,
        comissao_pct: row.comissao_pct,
      })
      if (!drink.ok) return res.status(400).json({ error: drink.error })
      return res.status(200).json({ ok: true, person: row })
    }

    if (req.method === 'POST' && body.action === 'deletePerson') {
      if (!body.id) return res.status(400).json({ error: 'id required' })
      await runLiveOp(db, {
        table: 'bar_people',
        mode: 'delete',
        filters: [{ op: 'eq', k: 'id', v: body.id }, { op: 'eq', k: 'bar_id', v: barId }],
      })
      await syncDrinkBackAgent(db, barId, body.id, { nome: '', drink_back: false, comissao_pct: 0 })
      return res.status(200).json({ ok: true })
    }

    // Link (or, with person_id empty, unlink) an existing login and an employee file from the Staff page.
    if (req.method === 'POST' && body.action === 'linkPerson') {
      if (!body.id) return res.status(400).json({ error: 'id required' })
      const { data: login } = await db.from('perfis').select('id,bar_id,role,nome').eq('id', body.id).maybeSingle()
      if (!login || login.bar_id !== barId) return res.status(404).json({ error: 'Staff not found' })
      if (!canManageLogin(auth.perfil, login)) return res.status(403).json({ error: 'You cannot change this login' })
      if (!canLinkLogin(login)) return res.status(400).json({ error: 'This login cannot have an employee file' })
      const extra = await runLiveOp(db, { table: 'staff_extras', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: login.id }], wantSingle: 'maybe' })
      const current = String(extra.data?.person_id || '')
      const nextId = String(body.person_id || '')
      if (nextId === current) return res.status(200).json({ ok: true, person_id: current })
      let person = null
      if (nextId) {
        person = await loadPerson(db, barId, nextId)
        const why = personLinkError(person, login.id)
        if (why) return res.status(person ? 409 : 404).json({ error: why })
      }
      if (current) {
        const undone = await unlinkLogin(db, barId, login.id, current)
        if (!undone.ok) return res.status(400).json({ error: undone.error || 'Could not save' })
      }
      if (person) {
        const linked = await linkPersonToLogin(db, barId, person, login.id, { admin })
        if (!linked.ok) return res.status(400).json({ error: linked.error })
      }
      forgetBarActors()
      return res.status(200).json({ ok: true, person_id: nextId })
    }

    if (req.method === 'POST' && body.action === 'createStaff') {
      if (!admin) return res.status(503).json({ error: 'Creating a login needs SUPABASE_SERVICE_ROLE_KEY' })
      const { email, password, nome, role, cargo, salario_hora, pin } = body
      if (!email || !password || !nome) return res.status(400).json({ error: 'email, password, name required' })
      const staffRole = role === 'caixa' ? 'caixa' : 'bar_staff'
      // A limited manager's new login gets at most the manager's own areas.
      const acessos = body.acessos === undefined
        ? (isRestricted(auth.perfil) ? cleanAcessos(auth.perfil.acessos) : undefined)
        : cleanAcessos(body.acessos)
      if (acessos !== undefined && !canEditAccessOf(auth.perfil, { role: staffRole }, acessos)) {
        return res.status(403).json({ error: 'You cannot give this login those areas' })
      }
      // A login for an employee already on the Staff page: checked before the auth user exists.
      const person = body.person_id ? await loadPerson(db, barId, body.person_id) : null
      if (body.person_id) {
        const why = personLinkError(person, '')
        if (why) return res.status(person ? 409 : 404).json({ error: why })
      }
      const loginName = String(person?.nome || nome).trim().slice(0, 80)
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: String(email).trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: { nome: loginName },
      })
      if (cErr) return res.status(400).json({ error: cErr.message })
      const uid = created.user.id
      const { error: pErr } = await admin.from('perfis').upsert({
        id: uid,
        nome: loginName,
        email: String(email).trim().toLowerCase(),
        role: staffRole,
        bar_id: barId,
      }, { onConflict: 'id' })
      if (pErr) {
        await admin.auth.admin.deleteUser(uid).catch(() => {})
        return res.status(400).json({ error: pErr.message })
      }
      const extraPatch = {}
      if (cargo || staffRole) extraPatch.cargo = cargo || staffRole
      if (salario_hora != null) extraPatch.salario_hora = +salario_hora || 0
      Object.assign(extraPatch, payExtras(body), contactExtras(body))
      if (pin) extraPatch.clock_pin_hash = hashSecret(String(pin))
      extraPatch.ativo = true
      if (acessos !== undefined) extraPatch.acessos = acessos
      const extras = await saveStaffExtras(db, uid, extraPatch)
      if (!extras.ok && extras.error) {
        return res.status(400).json({ error: extras.error })
      }
      if (person) {
        // The employee file brings its own pay, contract, photo, phone, sex and drink-back agent.
        const linked = await linkPersonToLogin(db, barId, person, uid, { rename: false, admin })
        if (!linked.ok) return res.status(400).json({ error: linked.error, id: uid })
        forgetBarActors()
        return res.status(200).json({ ok: true, id: uid, email: linked.email || String(email).trim().toLowerCase(), password, nome: loginName, person_id: person.id })
      }
      const drink = await syncDrinkBackAgent(db, barId, uid, {
        nome,
        drink_back: !!extraPatch.drink_back,
        comissao_pct: extraPatch.comissao_pct || 0,
      })
      if (!drink.ok) return res.status(400).json({ error: drink.error })
      return res.status(200).json({ ok: true, id: uid, email: String(email).trim().toLowerCase(), password, nome })
    }

    if (req.method === 'PATCH') {
      const { id } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: existing } = await db.from('perfis').select('id,bar_id,role,nome,email').eq('id', id).single()
      // Lane logins (bar_logins) have no perfis row: "Users & access" can switch them on/off, rename, set role and areas.
      if (!existing) return patchLaneLogin(req, res, db, auth, barId, body)
      if (existing.bar_id !== barId) return res.status(404).json({ error: 'Staff not found' })
      if (existing.role === 'cliente' && existing.id !== auth.user.id) {
        return res.status(403).json({ error: 'Cannot edit another owner' })
      }
      const managing = body.acessos !== undefined || body.ativo != null || body.role != null
      if (managing && !canManageLogin(auth.perfil, existing)) {
        return res.status(403).json({ error: 'You cannot change this login' })
      }
      if (body.role != null && !(['caixa', 'bar_staff'].includes(existing.role) && ['caixa', 'bar_staff'].includes(body.role))) {
        return res.status(400).json({ error: 'Only till and floor logins can switch role' })
      }
      const nextAcessos = body.acessos === undefined ? undefined : cleanAcessos(body.acessos)
      if (nextAcessos !== undefined && !canEditAccessOf(auth.perfil, existing, nextAcessos)) {
        return res.status(403).json({ error: 'You cannot give this login those areas' })
      }
      const patch = {}
      const extraPatch = {}
      if (body.nome != null) patch.nome = body.nome
      Object.assign(extraPatch, profileExtras(body), employeeExtras(body, barId), payExtras(body))
      // A staff login's e-mail is its sign-in: change it on the login, the profile and the sign-in together.
      if (body.email != null && ['bar_staff', 'caixa', 'gerente'].includes(existing.role) && String(body.email).trim()) {
        delete extraPatch.email
        if (String(body.email).trim().toLowerCase() !== String(existing.email || '').toLowerCase()) {
          if (!canManageLogin(auth.perfil, existing)) return res.status(403).json({ error: 'You cannot change this login' })
          const r = await setLoginEmail(admin, db, id, body.email)
          if (r.error) return res.status(r.status || 400).json({ error: r.error })
        }
      }
      if (body.ativo != null) extraPatch.ativo = !!body.ativo
      if (body.pin) extraPatch.clock_pin_hash = hashSecret(String(body.pin))
      if (body.role === 'caixa' || body.role === 'bar_staff') patch.role = body.role
      if (nextAcessos !== undefined) extraPatch.acessos = nextAcessos
      if (Object.keys(patch).length) {
        const { error } = await db.from('perfis').update(patch).eq('id', id)
        if (error) return res.status(400).json({ error: error.message })
      }
      if (Object.keys(extraPatch).length) {
        const extras = await saveStaffExtras(db, id, extraPatch)
        if (!extras.ok) return res.status(400).json({ error: extras.error })
      }
      if (body.drink_back != null || body.comissao_pct != null || body.nome != null) {
        const drink = await syncDrinkBackAgent(db, barId, id, {
          nome: body.nome || existing.nome,
          drink_back: body.drink_back != null ? !!body.drink_back : undefined,
          comissao_pct: extraPatch.comissao_pct,
        })
        if (body.drink_back != null && !drink.ok) return res.status(400).json({ error: drink.error })
      }
      if (managing) forgetBarActors()
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
