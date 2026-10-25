import { tryDrinksAdminClient, createStaffUserClient } from './_supabaseAdmin.js'
import { requireBarAccount, bearerToken } from './_requireStaff.js'
import { secretsMatch } from './_hash.js'
import { isInsideGeofence } from './_geo.js'
import { evaluatePunchGeo, venueOf } from '../src/lib/clockGeo.js'
import { canAccess, canAccessAny } from '../src/lib/barAccess.js'
import { isMissingSchemaError, isRlsError, loadBarWithGeo, loadStaffWithExtras, listStaffWithExtras, runLiveOp } from './_barLiveStore.js'
import { listPunches } from './_punchStore.js'
import { punchAllowed } from '../src/lib/clockRule.js'
import { checkoutContext, cleanCheckout, createDayReport, recordOffTime } from './_staffSelf.js'

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

function isManager(perfil) {
  // A manager limited in "Users & access" sees and marks everyone's clock only with the clock or team area.
  return (perfil?.role === 'cliente' || perfil?.role === 'gerente') && canAccessAny(perfil, 'clock|team')
}

async function loadBar(db, barId) {
  return loadBarWithGeo(db, barId)
}

function tabletOk(bar, token) {
  if (!bar?.tablet_token_hash || !token) return false
  return secretsMatch(String(token).trim().toUpperCase(), bar.tablet_token_hash)
}

async function lastPunch(db, barId, staffId) {
  const listed = await listPunches(db, { barId, staffId })
  return listed.data?.[0] || null
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
      // Whether clock-ins are checked against the bar's location (staff need it to ask for a reason before sending).
      let venue = null
      try { venue = venueOf(await loadBar(db, auth.perfil.bar_id)) } catch { venue = null }
      return res.status(200).json({
        punches: data || [],
        adicional_noturno: adicional,
        venue: venue ? { configured: true, lat: venue.lat, lng: venue.lng, radius_m: venue.radius_m } : { configured: false },
      })
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
      if (!manager && !canAccess(auth.perfil, 'clock')) {
        return res.status(403).json({ error: 'This login has no access to this area', area: 'clock', code: 'area' })
      }
      barId = auth.perfil.bar_id
      if (!staffId || !manager) staffId = auth.user?.id || auth.perfil.id
    }

    if (!barId || !staffId) return res.status(400).json({ error: 'bar_id and staff_id required' })

    const db = admin || (auth?.token ? createStaffUserClient(auth.token) : null)
    if (!db) return res.status(500).json({ error: 'Database client unavailable' })

    const bar = await loadBar(db, barId)
    if (!bar) return res.status(404).json({ error: 'Bar not found' })

    const selfPunch = !!(auth && !auth.error && staffId === (auth.user?.id || auth.perfil.id))
    let geo = { ok: true, distance: 0, reason: null }
    if (!managerMark && !selfPunch) {
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

    // Own punch from the staff app (phone): GPS against the bar location, or a written reason. The owner is never on the clock.
    let geoRule = null
    if (selfPunch && auth.perfil.role !== 'cliente') {
      geoRule = evaluatePunchGeo({
        venue: venueOf(bar),
        position: { lat: body.lat, lng: body.lng, accuracy: body.accuracy },
        geoError: body.geo_error,
        justification: body.justification,
      })
      if (!geoRule.ok) {
        return res.status(400).json({
          error: geoRule.error,
          code: geoRule.code,
          geo_status: geoRule.geo_status,
          distance_m: geoRule.distance_m,
        })
      }
    }

    const staff = await loadStaffWithExtras(db, staffId)
    if (!staff || staff.bar_id !== bar.id) return res.status(404).json({ error: 'Staff not found' })
    if (staff.ativo === false) return res.status(403).json({ error: 'Staff inactive' })

    if (!managerMark && !selfPunch) {
      const pinOk = secretsMatch(String(body.pin || ''), staff.clock_pin_hash)
      if (!pinOk) {
        return res.status(403).json({ error: 'Invalid PIN', code: 'pin' })
      }
    }

    // The phone names the clock-in it closes: the server's copy of the punch file can be a moment behind.
    const last = await lastPunch(db, bar.id, staffId)
    const allowed = punchAllowed({
      tipo,
      last,
      claim: tipo === 'out' && body.open_in_at ? { id: body.open_in_id, at: body.open_in_at } : null,
    })
    if (!allowed.ok) return res.status(400).json({ error: allowed.error, code: tipo === 'out' ? 'not_in' : 'already_in' })

    // Clock-out from the staff app with the day summary: check it before the punch is saved.
    let checkout = null
    let dayCtx = null
    if (tipo === 'out' && selfPunch && body.checkout && typeof body.checkout === 'object') {
      checkout = cleanCheckout(body.checkout)
      dayCtx = await checkoutContext(db, { bar, staff, inAt: last?.tipo === 'in' ? last.punched_at : body.open_in_at })
      if (dayCtx.goal.missed && checkout.improve.length < 5) {
        return res.status(400).json({ error: 'The goal was not reached: write how the night went and what to improve.', code: 'improve_required' })
      }
    }

    const fromApp = selfPunch && !!geoRule
    const position = fromApp ? geoRule.geo : null
    const punchRow = {
      bar_id: bar.id,
      staff_id: staffId,
      tipo,
      punched_at: new Date().toISOString(),
      lat: fromApp ? (position?.lat ?? null) : (body.lat || null),
      lng: fromApp ? (position?.lng ?? null) : (body.lng || null),
      accuracy_m: fromApp ? (position?.accuracy ?? null) : (body.accuracy || null),
      distance_m: fromApp ? geoRule.distance_m : Math.round(geo.distance || 0),
      tablet_ok: managerMark || selfPunch ? false : true,
      origem: managerMark && !selfPunch ? 'hq' : (selfPunch ? 'app' : 'tablet'),
      geo: position,
      geo_status: fromApp ? geoRule.geo_status : (managerMark || selfPunch ? 'manual' : 'ok'),
      geo_error: fromApp ? geoRule.geo_error : null,
      justification: fromApp ? geoRule.justification : null,
    }
    if (tipo === 'in' && selfPunch && body.ack === true) {
      punchRow.ack_at = punchRow.punched_at
      punchRow.role_today = String(body.ack_role || '').trim().slice(0, 80) || null
      punchRow.ack_mission = String(body.ack_mission || '').trim().slice(0, 300) || null
    }
    if (tipo === 'out') {
      punchRow.in_punch_id = allowed.inPunchId || null
      if (allowed.recovered) punchRow.recovered_in = true
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

    // Day report for the owner (summary, notes, signature, AI text). The staff member gets only its id back.
    let reportId = null
    if (checkout && dayCtx) {
      try {
        reportId = await createDayReport(db, { bar, staff, punch: punch || punchRow, inPunchId: punchRow.in_punch_id, checkout, ctx: dayCtx })
      } catch { reportId = null }
      // Past the planned end or before it: the owner gets it in the staff inbox to confirm.
      if (checkout.offTime) {
        try { await recordOffTime(db, admin, { barId: bar.id, staff, night: dayCtx.night, offTime: checkout.offTime }) } catch { /* the punch and report are saved */ }
      }
    }

    return res.status(200).json({ ok: true, punch, staff: { id: staff.id, nome: staff.nome }, report_id: reportId })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
