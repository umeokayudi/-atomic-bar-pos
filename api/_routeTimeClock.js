/** Ponto eletrônico: só no tablet pareado, só dentro do GPS do bar. */

import { drinksAdminClient } from './_supabaseAdmin.js'
import { requireBarAccount, bearerToken } from './_requireStaff.js'
import { secretsMatch, hashSecret } from './_hash.js'
import { isInsideGeofence } from './_geo.js'
import { isMissingSchemaError, loadBarWithGeo, loadStaffWithExtras, listStaffWithExtras, runLiveOp } from './_barLiveStore.js'

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

async function loadBar(admin, barId) {
  return loadBarWithGeo(admin, barId)
}

async function listPunches(admin, spec) {
  let query = admin.from('time_clock').select('*').eq('bar_id', spec.barId).order('punched_at', { ascending: false }).limit(500)
  if (spec.staffId) query = query.eq('staff_id', spec.staffId)
  if (spec.from) query = query.gte('punched_at', spec.from)
  if (spec.to) query = query.lte('punched_at', spec.to)
  const { data, error } = await query
  if (!error) return { data: data || [], error: null }
  if (!isMissingSchemaError(error)) return { data: null, error }
  const filters = [{ op: 'eq', k: 'bar_id', v: spec.barId }]
  if (spec.staffId) filters.push({ op: 'eq', k: 'staff_id', v: spec.staffId })
  if (spec.from) filters.push({ op: 'gte', k: 'punched_at', v: spec.from })
  if (spec.to) filters.push({ op: 'lte', k: 'punched_at', v: spec.to })
  return runLiveOp(admin, {
    table: 'time_clock',
    mode: 'select',
    columns: '*',
    filters,
    orderBy: { k: 'punched_at', ascending: false },
    limitN: 500,
  })
}

function tabletOk(bar, token) {
  if (!bar?.tablet_token_hash || !token) return false
  return secretsMatch(String(token).trim().toUpperCase(), bar.tablet_token_hash)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let admin
  try { admin = drinksAdminClient() } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  try {
    if (req.method === 'GET') {
      const q = req.query || {}
      if (q.roster === '1' || q.action === 'roster') {
        const bar = await loadBar(admin, q.bar_id)
        if (!bar) return res.status(404).json({ error: 'Bar not found' })
        if (!tabletOk(bar, q.tabletToken || q.tablet_token)) {
          return res.status(403).json({ error: 'Tablet not paired' })
        }
        const roster = await listStaffWithExtras(admin, bar.id)
        return res.status(200).json({
          staff: (roster || [])
            .filter(s => s.ativo !== false)
            .map(s => ({ id: s.id, nome: s.nome, cargo: s.cargo || s.role })),
        })
      }

      const auth = await requireBarAccount(req, admin)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })
      const from = q.from
      const to = q.to
      const manager = auth.perfil.role === 'cliente' || auth.perfil.role === 'gerente'
      const { data, error } = await listPunches(admin, {
        barId: auth.perfil.bar_id,
        staffId: manager ? null : (auth.user?.id || auth.perfil.id),
        from,
        to,
      })
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ punches: data || [] })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST or GET' })

    const body = bodyOf(req)
    const tipo = body.tipo === 'out' ? 'out' : 'in'
    const tabletToken = String(body.tabletToken || body.tablet_token || '').trim().toUpperCase()

    let barId = body.bar_id
    let staffId = body.staff_id
    const auth = bearerToken(req) ? await requireBarAccount(req, admin) : null
    if (auth && !auth.error) {
      barId = auth.perfil.bar_id
      const manager = auth.perfil.role === 'cliente' || auth.perfil.role === 'gerente'
      if (!staffId || !manager) staffId = auth.user?.id || auth.perfil.id
    }

    if (!barId || !staffId) return res.status(400).json({ error: 'bar_id and staff_id required' })

    const bar = await loadBar(admin, barId)
    if (!bar) return res.status(404).json({ error: 'Bar not found' })

    const deviceOk = tabletOk(bar, tabletToken)
    if (!deviceOk) {
      return res.status(403).json({ error: 'Clock-in only on the paired bar tablet', code: 'tablet' })
    }

    const geo = isInsideGeofence({
      lat: body.lat,
      lng: body.lng,
      barLat: bar.lat,
      barLng: bar.lng,
      radiusM: bar.geofence_m,
      accuracyM: body.accuracy,
    })
    if (!geo.ok) {
      return res.status(403).json({
        error: geo.reason === 'no_location'
          ? 'Bar GPS not configured'
          : geo.reason === 'accuracy'
            ? 'GPS too imprecise'
            : `Outside bar (${Math.round(geo.distance || 0)}m)`,
        code: geo.reason,
        distance: geo.distance,
      })
    }

    const staff = await loadStaffWithExtras(admin, staffId)
    if (!staff || staff.bar_id !== bar.id) return res.status(404).json({ error: 'Staff not found' })
    if (staff.ativo === false) return res.status(403).json({ error: 'Staff inactive' })

    const pinOk = secretsMatch(String(body.pin || ''), staff.clock_pin_hash)
    if (!pinOk) {
      return res.status(403).json({ error: 'Invalid PIN', code: 'pin' })
    }

    let lastTipo = null
    const lastPg = await admin.from('time_clock')
      .select('tipo')
      .eq('bar_id', bar.id)
      .eq('staff_id', staffId)
      .order('punched_at', { ascending: false })
      .limit(1)
    if (!lastPg.error) lastTipo = lastPg.data?.[0]?.tipo
    else if (isMissingSchemaError(lastPg.error)) {
      const lastLive = await runLiveOp(admin, {
        table: 'time_clock',
        mode: 'select',
        columns: 'tipo',
        filters: [
          { op: 'eq', k: 'bar_id', v: bar.id },
          { op: 'eq', k: 'staff_id', v: staffId },
        ],
        orderBy: { k: 'punched_at', ascending: false },
        limitN: 1,
      })
      lastTipo = lastLive.data?.[0]?.tipo
    } else {
      return res.status(400).json({ error: lastPg.error.message })
    }
    if (tipo === 'in' && lastTipo === 'in') {
      return res.status(400).json({ error: 'Already clocked in' })
    }
    if (tipo === 'out' && lastTipo !== 'in') {
      return res.status(400).json({ error: 'Not clocked in' })
    }

    const punchRow = {
      bar_id: bar.id,
      staff_id: staffId,
      tipo,
      punched_at: new Date().toISOString(),
      lat: body.lat,
      lng: body.lng,
      accuracy_m: body.accuracy || null,
      distance_m: Math.round(geo.distance),
      tablet_ok: true,
      origem: 'tablet',
    }
    let punch, pErr
    ;({ data: punch, error: pErr } = await admin.from('time_clock').insert(punchRow).select().single())
    if (pErr && isMissingSchemaError(pErr)) {
      const live = await runLiveOp(admin, {
        table: 'time_clock',
        mode: 'insert',
        insertRows: [punchRow],
        wantSingle: true,
      })
      punch = live.data
      pErr = live.error
    }
    if (pErr) return res.status(400).json({ error: pErr.message })

    return res.status(200).json({ ok: true, punch, staff: { id: staff.id, nome: staff.nome } })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
