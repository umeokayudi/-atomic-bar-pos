/** Dono do bar gerencia equipe, PIN, GPS e tablet. Não toca no fornecimento JBM. */

import { tryDrinksAdminClient, createStaffUserClient } from './_supabaseAdmin.js'
import { isAllowedOrigin, requireBarAccount } from './_requireStaff.js'
import { hashSecret, randomTabletCode } from './_hash.js'
import { isMissingSchemaError, loadBarWithGeo, listStaffWithExtras, runLiveOp, saveBarGeo, saveStaffExtras } from './_barLiveStore.js'
import { invitePayload, publicEmployee, canManageEmployees } from '../src/lib/employeeAccess.js'

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

function asList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean)
  if (!value) return []
  return String(value).split(',').map(v => v.trim()).filter(Boolean)
}

function profileExtras(body) {
  const extra = {}
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

function payExtras(body) {
  const extra = {}
  if (body.salario_hora != null) extra.salario_hora = +body.salario_hora || 0
  if (body.salario_mes != null) extra.salario_mes = +body.salario_mes || 0
  if (body.drink_back != null) extra.drink_back = !!body.drink_back
  if (body.comissao_pct != null) extra.comissao_pct = +body.comissao_pct || 0
  if (body.drink_back === false) extra.comissao_pct = 0
  return extra
}

function missingRelation(error) {
  const message = String(error?.message || error || '')
  return isMissingSchemaError(error) || /bar_employees/i.test(message)
}

async function writeEmployeeAudit(admin, { actorId, action, entityId, metadata }) {
  if (!admin) return
  await admin.from('audit_logs').insert({
    user_id: actorId || null,
    action,
    entity_type: 'bar_employees',
    entity_id: entityId || null,
    metadata: metadata || {},
  })
}

async function attachDirectory(db, barId, staff) {
  const emp = await db.from('bar_employees').select('id,bar_id,job_role,permission_role,phone,employee_code,status,start_date,notes').eq('bar_id', barId)
  const byId = Object.fromEntries((emp.error ? [] : emp.data || []).map(row => [row.id, row]))
  return (staff || []).map(person => {
    const extra = byId[person.id]
    return publicEmployee({
      ...person,
      job_role: extra?.job_role || person.cargo || person.role,
      employment_status: extra?.status || 'active',
      phone: extra?.phone || person.contato || '',
      employee_code: extra?.employee_code || '',
      start_date: extra?.start_date || '',
      notes: extra?.notes || person.notas || '',
    })
  })
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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const admin = tryDrinksAdminClient()
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
      return res.status(200).json({
        staff: await attachDirectory(db, barId, staff),
        people: peopleLive.data || [],
        registry: (await runLiveOp(db, {
          table: 'bar_registry',
          mode: 'select',
          columns: '*',
          filters: [{ op: 'eq', k: 'bar_id', v: barId }],
        })).data || [],
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
      if (body.pedido_modo != null) {
        const modo = String(body.pedido_modo)
        row.pedido_modo = ['queda', 'volume', 'segunda'].includes(modo) ? modo : 'queda'
      }
      if (body.pedido_qtd != null) row.pedido_qtd = Math.max(1, Math.min(99, Math.round(+body.pedido_qtd || 1)))
      if (body.pedido_min != null) row.pedido_min = Math.max(0, Math.min(999, Math.round(+body.pedido_min || 0)))
      if (body.pedido_em != null) row.pedido_em = String(body.pedido_em || '').slice(0, 10)
      if (body.pedido_feito != null) row.pedido_feito = String(body.pedido_feito || '').slice(0, 10)
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
        ...profileExtras(body),
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

    if (req.method === 'POST' && body.action === 'createStaff') {
      return res.status(400).json({ error: 'Managers cannot set an employee password. Send an invitation.' })
    }

    if (req.method === 'POST' && body.action === 'inviteEmployee') {
      if (!canManageEmployees(auth.perfil.role)) return res.status(403).json({ error: 'No permission' })
      if (!admin) return res.status(503).json({ error: 'Inviting an employee needs SUPABASE_SERVICE_ROLE_KEY' })
      const invite = invitePayload(body)
      if (invite.error) return res.status(400).json({ error: invite.error })
      const origin = String(req.headers.origin || '').replace(/\/$/, '')
      const redirectTo = isAllowedOrigin(req) ? `${origin}/` : undefined
      const { data: created, error: cErr } = await admin.auth.admin.inviteUserByEmail(invite.email, {
        data: { nome: invite.nome },
        redirectTo,
      })
      if (cErr) return res.status(400).json({ error: cErr.message })
      const uid = created.user.id
      const { error: pErr } = await admin.from('perfis').upsert({
        id: uid,
        nome: invite.nome,
        email: invite.email,
        role: invite.permission,
        bar_id: barId,
      }, { onConflict: 'id' })
      if (pErr) {
        await admin.auth.admin.deleteUser(uid).catch(() => {})
        return res.status(400).json({ error: pErr.message })
      }
      const row = {
        id: uid,
        bar_id: barId,
        job_role: invite.job_role,
        permission_role: invite.permission,
        phone: invite.phone || null,
        employee_code: invite.employee_code || null,
        status: 'invited',
        start_date: invite.start_date,
        notes: invite.notes || null,
        invited_at: new Date().toISOString(),
      }
      const saved = await admin.from('bar_employees').insert(row)
      if (saved.error) {
        await admin.from('perfis').delete().eq('id', uid)
        await admin.auth.admin.deleteUser(uid).catch(() => {})
        const hint = missingRelation(saved.error) ? ' Apply sql/bar_employees.sql in the Supabase SQL editor.' : ''
        return res.status(400).json({ error: saved.error.message + hint })
      }
      await saveStaffExtras(db, uid, { cargo: invite.job_role, contato: invite.phone, notas: invite.notes, ativo: true })
      await writeEmployeeAudit(admin, {
        actorId: auth.user?.id,
        action: 'employee_invited',
        entityId: uid,
        metadata: { bar_id: barId, job_role: invite.job_role, email: invite.email },
      })
      return res.status(200).json({
        ok: true,
        id: uid,
        email: invite.email,
        nome: invite.nome,
        job_role: invite.job_role,
        employment_status: 'invited',
      })
    }

    if (req.method === 'POST' && body.action === 'updateEmployee') {
      if (!canManageEmployees(auth.perfil.role)) return res.status(403).json({ error: 'No permission' })
      if (!body.id) return res.status(400).json({ error: 'id required' })
      if (body.password || body.pin) return res.status(400).json({ error: 'Managers cannot set an employee password' })
      const { data: existing } = await db.from('perfis').select('id,bar_id,role,nome').eq('id', body.id).maybeSingle()
      if (!existing || existing.bar_id !== barId) return res.status(404).json({ error: 'Staff not found' })
      if (existing.role === 'cliente') return res.status(403).json({ error: 'Cannot edit the bar owner' })
      const directory = admin
        ? await admin.from('bar_employees').select('id,bar_id,status,job_role').eq('id', body.id).maybeSingle()
        : await db.from('bar_employees').select('id,bar_id,status,job_role').eq('id', body.id).maybeSingle()
      if (directory.error && missingRelation(directory.error)) {
        return res.status(503).json({ error: 'Apply sql/bar_employees.sql in the Supabase SQL editor.' })
      }
      if (!directory.data || directory.data.bar_id !== barId) return res.status(404).json({ error: 'Staff not found' })
      const userDb = !auth.lane && auth.token ? createStaffUserClient(auth.token) : null
      const status = body.status || directory.data.status
      const job = body.job_role || null
      if (userDb && (body.status || body.job_role)) {
        const changed = await userDb.rpc('bar_set_employee_access', {
          p_employee: body.id,
          p_status: status,
          p_job_role: job,
        })
        if (changed.error) return res.status(400).json({ error: changed.error.message })
      } else if (admin && (body.status || body.job_role)) {
        return res.status(400).json({ error: 'Employee access changes require the manager Supabase session.' })
      }
      const patch = {}
      if (body.phone != null) patch.phone = String(body.phone).trim()
      if (body.notes != null) patch.notes = String(body.notes).trim()
      if (body.employee_code != null) patch.employee_code = String(body.employee_code).trim()
      if (body.start_date != null) patch.start_date = String(body.start_date).slice(0, 10) || null
      if (Object.keys(patch).length) {
        const writer = userDb || admin
        const updated = await writer.from('bar_employees').update(patch).eq('id', body.id).eq('bar_id', barId)
        if (updated.error) return res.status(400).json({ error: updated.error.message })
      }
      if (body.nome != null && admin) {
        await admin.from('perfis').update({ nome: String(body.nome).trim() }).eq('id', body.id).eq('bar_id', barId)
      }
      if (admin && (body.status === 'suspended' || body.status === 'inactive')) {
        await admin.auth.admin.updateUserById(body.id, { ban_duration: '876000h' })
      }
      if (admin && body.status === 'active') {
        await admin.auth.admin.updateUserById(body.id, { ban_duration: 'none' })
      }
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'PATCH') {
      const { id } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: existing } = await db.from('perfis').select('id,bar_id,role,nome').eq('id', id).single()
      if (!existing || existing.bar_id !== barId) return res.status(404).json({ error: 'Staff not found' })
      if (existing.role === 'cliente' && existing.id !== auth.user.id) {
        return res.status(403).json({ error: 'Cannot edit another owner' })
      }
      const patch = {}
      const extraPatch = {}
      if (body.nome != null) patch.nome = body.nome
      Object.assign(extraPatch, profileExtras(body), payExtras(body))
      if (body.ativo != null) extraPatch.ativo = !!body.ativo
      if (body.pin) extraPatch.clock_pin_hash = hashSecret(String(body.pin))
      if (body.role === 'caixa' || body.role === 'bar_staff') patch.role = body.role
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
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
