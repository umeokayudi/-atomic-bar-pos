import { tryDrinksAdminClient, createStaffUserClient } from './_supabaseAdmin.js'
import { requireBarAccount, bearerToken } from './_requireStaff.js'
import { secretsMatch } from './_hash.js'
import { isInsideGeofence } from './_geo.js'
import { staffIdsForNfc } from './_nfcCard.js'
import { applyFilters, isMissingSchemaError, isRlsError, loadBarWithGeo, loadStaffWithExtras, listStaffWithExtras, runLiveOp, readLiveJson } from './_barLiveStore.js'

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

function isManager(perfil) {
  return perfil?.role === 'cliente' || perfil?.role === 'gerente'
}

async function loadBar(db, barId) {
  return loadBarWithGeo(db, barId)
}

async function listPunches(db, spec) {
  let query = db.from('time_clock').select('*').eq('bar_id', spec.barId).order('punched_at', { ascending: false }).limit(500)
  if (spec.staffId) query = query.eq('staff_id', spec.staffId)
  if (spec.from) query = query.gte('punched_at', spec.from)
  if (spec.to) query = query.lte('punched_at', spec.to)
  const { data, error } = await query
  const filters = [{ op: 'eq', k: 'bar_id', v: spec.barId }]
  if (spec.staffId) filters.push({ op: 'eq', k: 'staff_id', v: spec.staffId })
  if (spec.from) filters.push({ op: 'gte', k: 'punched_at', v: spec.from })
  if (spec.to) filters.push({ op: 'lte', k: 'punched_at', v: spec.to })
  const liveRows = applyFilters(await readLiveJson(db, 'time_clock'), filters)
  if (error && !isMissingSchemaError(error) && !isRlsError(error) && !liveRows.length) {
    return { data: null, error }
  }
  const byId = new Map()
  for (const row of [...(error ? [] : (data || [])), ...liveRows]) {
    byId.set(row.id || `${row.staff_id}-${row.punched_at}`, row)
  }
  const merged = [...byId.values()].sort((a, b) => String(b.punched_at || '').localeCompare(String(a.punched_at || '')))
  return { data: merged, error: null }
}

function tabletOk(bar, token) {
  if (!bar?.tablet_token_hash || !token) return false
  return secretsMatch(String(token).trim().toUpperCase(), bar.tablet_token_hash)
}

async function lastPunchTipo(db, barId, staffId) {
  const listed = await listPunches(db, { barId, staffId })
  return listed.data?.[0]?.tipo || null
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const admin = tryDrinksAdminClient()

  try {
    if (req.method === 'GET') {
      const q = req.query || {}
      if (q.roster === '1' || q.action === 'roster') {
        if (!admin) return res.status(503).json({ error: 'Tablet roster unavailable on this preview' })
        const db = admin
        const bar = await loadBar(db, q.bar_id)
        if (!bar) return res.status(404).json({ error: 'Bar not found' })
        if (!tabletOk(bar, q.tabletToken || q.tablet_token)) {
          return res.status(403).json({ error: 'Tablet not paired' })
        }
        const roster = await listStaffWithExtras(db, bar.id)
        return res.status(200).json({
          staff: (roster || [])
            .filter(s => s.ativo !== false)
            .map(s => ({ id: s.id, nome: s.nome, cargo: s.cargo || s.role })),
        })
      }

      const auth = await requireBarAccount(req, admin)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })
      const db = admin || (auth.token ? createStaffUserClient(auth.token) : null)
      if (!db) return res.status(500).json({ error: 'Database client unavailable' })
      const from = q.from
      const to = q.to
      const manager = isManager(auth.perfil)
      const { data, error } = await listPunches(db, {
        barId: auth.perfil.bar_id,
        staffId: manager ? null : (auth.user?.id || auth.perfil.id),
        from,
        to,
      })
      if (error) return res.status(400).json({ error: error.message })
      let adicional = true
      try {
        const goals = await runLiveOp(db, {
          table: 'bar_goals',
          mode: 'select',
          columns: '*',
          filters: [{ op: 'eq', k: 'bar_id', v: auth.perfil.bar_id }],
          wantSingle: 'maybe',
        })
        adicional = goals?.data?.adicional_noturno !== false
      } catch {
        adicional = true
      }
      return res.status(200).json({ punches: data || [], adicional_noturno: adicional })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST or GET' })

    const body = bodyOf(req)
    const tipo = body.tipo === 'out' ? 'out' : 'in'
    const tabletToken = String(body.tabletToken || body.tablet_token || '').trim().toUpperCase()

    let barId = body.bar_id
    let staffId = body.staff_id
    const auth = bearerToken(req) ? await requireBarAccount(req, admin) : null
    const manager = auth && !auth.error && isManager(auth.perfil)
    const managerMark = manager && body.managerMark === true
    if (auth && !auth.error) {
      barId = auth.perfil.bar_id
      if (!staffId || !manager) staffId = auth.user?.id || auth.perfil.id
    }

    const db = admin || (auth?.token ? createStaffUserClient(auth.token) : null)

    // NFC card: a signed-in bar device reads the card, the card says who is punching.
    let nfcPunch = false
    if (body.nfc_uid != null) {
      if (!auth || auth.error) return res.status(401).json({ error: 'Sign in on this device to use NFC cards' })
      if (!db) return res.status(500).json({ error: 'Database client unavailable' })
      const ids = await staffIdsForNfc(db, body.nfc_uid)
      let owner = null
      for (const id of ids) {
        const s = await loadStaffWithExtras(db, id)
        if (s && s.bar_id === barId) { owner = s; break }
      }
      if (!owner) return res.status(404).json({ error: 'Card not linked to anyone in this bar', code: 'card_unknown' })
      const me = auth.user?.id || auth.perfil.id
      if (auth.perfil.role === 'bar_staff' && owner.id !== me) {
        return res.status(403).json({ error: 'This card belongs to someone else', code: 'card_other' })
      }
      staffId = owner.id
      nfcPunch = true
    }

    if (!barId || !staffId) return res.status(400).json({ error: 'bar_id and staff_id required' })
    if (!db) return res.status(500).json({ error: 'Database client unavailable' })

    const bar = await loadBar(db, barId)
    if (!bar) return res.status(404).json({ error: 'Bar not found' })

    const selfPunch = !!(auth && !auth.error && staffId === (auth.user?.id || auth.perfil.id))
    const trusted = managerMark || selfPunch || nfcPunch
    let geo = { ok: true, distance: 0, reason: null }
    if (!trusted) {
      const deviceOk = tabletOk(bar, tabletToken)
      if (!deviceOk) {
        return res.status(403).json({ error: 'Clock-in only on the paired bar tablet', code: 'tablet' })
      }
      geo = isInsideGeofence({
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
    }

    const staff = await loadStaffWithExtras(db, staffId)
    if (!staff || staff.bar_id !== bar.id) return res.status(404).json({ error: 'Staff not found' })
    if (staff.ativo === false) return res.status(403).json({ error: 'Staff inactive' })

    if (!trusted) {
      const pinOk = secretsMatch(String(body.pin || ''), staff.clock_pin_hash)
      if (!pinOk) {
        return res.status(403).json({ error: 'Invalid PIN', code: 'pin' })
      }
    }

    const lastTipo = await lastPunchTipo(db, bar.id, staffId)
    if (tipo === 'in' && lastTipo === 'in') {
      return res.status(400).json({ error: nfcPunch ? `${staff.nome} is already clocked in` : 'Already clocked in', code: 'already_in' })
    }
    if (tipo === 'out' && lastTipo !== 'in') {
      return res.status(400).json({ error: nfcPunch ? `${staff.nome} is not clocked in` : 'Not clocked in', code: 'not_in' })
    }

    const punchRow = {
      bar_id: bar.id,
      staff_id: staffId,
      tipo,
      punched_at: new Date().toISOString(),
      lat: body.lat || null,
      lng: body.lng || null,
      accuracy_m: body.accuracy || null,
      distance_m: Math.round(geo.distance || 0),
      tablet_ok: trusted ? false : true,
      origem: nfcPunch ? 'nfc' : managerMark ? 'hq' : (selfPunch ? 'app' : 'tablet'),
    }
    let punch, pErr
    ;({ data: punch, error: pErr } = await db.from('time_clock').insert(punchRow).select().single())
    if (pErr && (isMissingSchemaError(pErr) || isRlsError(pErr))) {
      const live = await runLiveOp(db, {
        table: 'time_clock',
        mode: 'insert',
        insertRows: [punchRow],
        wantSingle: true,
      })
      punch = live.data
      pErr = live.error
    }
    if (pErr) return res.status(400).json({ error: pErr.message || pErr })

    return res.status(200).json({ ok: true, punch, staff: { id: staff.id, nome: staff.nome } })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
