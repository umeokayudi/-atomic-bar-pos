/**
 * /api/time-clock end to end with a fake Supabase (no network): the server enforces the GPS justification,
 * stores the geo fields, and a clock-out is saved even when the server's punch copy missed the clock-in.
 *   node scripts/timeClockRoute.test.mjs
 */
import assert from 'node:assert/strict'

process.env.VITE_SUPABASE_URL = 'http://supabase.test'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'

const BAR_ID = '00000000-0000-4000-8000-0000000000b1'
const BAR_NOGPS = '00000000-0000-4000-8000-0000000000b2'
const BARS = {
  [BAR_ID]: { id: BAR_ID, nome: 'Bar Demo', lat: 35.659482, lng: 139.700553, geofence_m: 150, tablet_token_hash: null },
  [BAR_NOGPS]: { id: BAR_NOGPS, nome: 'Bar No GPS', lat: null, lng: null, geofence_m: 150, tablet_token_hash: null },
}
const STAFF = {
  s1: { id: 's1', bar_id: BAR_ID, role: 'bar_staff', nome: 'Aiko', ativo: true, cargo: 'Bartender', salario_hora: 1200 },
  s2: { id: 's2', bar_id: BAR_ID, role: 'bar_staff', nome: 'Ken', ativo: true },
  s3: { id: 's3', bar_id: BAR_NOGPS, role: 'bar_staff', nome: 'Lucia', ativo: true },
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const missing = table => json(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` })

// Fake PostgREST + Storage: bars and perfis exist; every other table is "missing" so the live store (memory) is used.
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.pathname.startsWith('/storage/v1/')) {
    if ((init.method || 'GET') === 'GET') return json(404, { statusCode: '404', error: 'not_found', message: 'Object not found' })
    return json(200, { Key: 'ok' })
  }
  const table = url.pathname.split('/rest/v1/')[1]
  const id = (url.searchParams.get('id') || '').replace(/^eq\./, '')
  if (table === 'bars') return BARS[id] ? json(200, BARS[id]) : json(406, { code: 'PGRST116', message: 'no rows' })
  if (table === 'perfis') return STAFF[id] ? json(200, STAFF[id]) : json(406, { code: 'PGRST116', message: 'no rows' })
  return missing(table)
}

const { signLanePayload } = await import('../api/_hash.js')
const { default: handler } = await import('../api/_routeTimeClock.js')

function tokenFor(staff) {
  return signLanePayload({ id: staff.id, email: `${staff.id}@x.test`, nome: staff.nome, role: staff.role, bar_id: staff.bar_id, exp: Date.now() + 3600e3 })
}

async function call(staff, method, body = {}, query = {}) {
  const req = { method, body, query, headers: { authorization: `Bearer ${tokenFor(staff)}` } }
  let status = 200
  let payload = null
  const res = {
    status(code) { status = code; return this },
    json(obj) { payload = obj; return this },
    end() { return this },
  }
  await handler(req, res)
  return { status, body: payload }
}

const north = m => ({ lat: 35.659482 + m / 111_320, lng: 139.700553 })
let n = 0
const test = async (name, fn) => { await fn(); n++; console.log(`ok ${n} - ${name}`) }

await test('clock-in with GPS denied and no reason → 400 justification_required (cannot be bypassed)', async () => {
  const r = await call(STAFF.s1, 'POST', { tipo: 'in', geo_error: 'denied' })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'justification_required')
  assert.equal(r.body.geo_status, 'denied')
})

await test('clock-in outside the radius without a reason → 400; with a short reason → 400', async () => {
  const far = north(800)
  let r = await call(STAFF.s1, 'POST', { tipo: 'in', ...far, accuracy: 15 })
  assert.equal(r.status, 400)
  assert.equal(r.body.geo_status, 'outside')
  assert.ok(r.body.distance_m > 790)
  r = await call(STAFF.s1, 'POST', { tipo: 'in', ...far, accuracy: 15, justification: 'ok' })
  assert.equal(r.status, 400)
})

await test('clock-in outside with a reason → saved with geo, distance, status and the reason', async () => {
  const r = await call(STAFF.s1, 'POST', { tipo: 'in', ...north(800), accuracy: 15, justification: 'Picking up ice', ack: true, ack_role: 'Bar', ack_mission: 'Sell 3 bottles' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const p = r.body.punch
  assert.equal(p.geo_status, 'outside')
  assert.equal(p.justification, 'Picking up ice')
  assert.ok(p.distance_m > 790)
  assert.deepEqual(Object.keys(p.geo).sort(), ['accuracy', 'lat', 'lng'])
  assert.equal(p.origem, 'app')
  assert.equal(p.ack_at, p.punched_at)
  assert.equal(p.role_today, 'Bar')
})

await test('second clock-in while on shift → 400 Already clocked in', async () => {
  const r = await call(STAFF.s1, 'POST', { tipo: 'in', ...north(10), accuracy: 10 })
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'Already clocked in')
})

await test('clock-out inside the radius → saved, linked to the clock-in, geo ok', async () => {
  const r = await call(STAFF.s1, 'POST', { tipo: 'out', ...north(30), accuracy: 10 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.punch.tipo, 'out')
  assert.equal(r.body.punch.geo_status, 'ok')
  assert.ok(r.body.punch.in_punch_id)
  const list = await call(STAFF.s1, 'GET', {}, {})
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.punches.filter(p => p.staff_id === 's1').map(p => p.tipo), ['out', 'in'])
  assert.deepEqual(list.body.venue, { configured: true, lat: 35.659482, lng: 139.700553, radius_m: 150 })
})

await test('clock-out BUG regression: server copy without the clock-in still saves the out when the phone names it', async () => {
  // s2 has no clock-in in the server's copy (another instance saved it). Before: 400 "Not clocked in".
  const denied = await call(STAFF.s2, 'POST', { tipo: 'out', ...north(10), accuracy: 10 })
  assert.equal(denied.status, 400)
  assert.equal(denied.body.code, 'not_in')
  const inAt = new Date(Date.now() - 3 * 3600e3).toISOString()
  const r = await call(STAFF.s2, 'POST', { tipo: 'out', ...north(10), accuracy: 10, open_in_id: 'in-elsewhere', open_in_at: inAt })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.punch.in_punch_id, 'in-elsewhere')
  assert.equal(r.body.punch.recovered_in, true)
})

await test('clock-out with GPS unavailable needs a reason too', async () => {
  const inAt = new Date(Date.now() - 3600e3).toISOString()
  const r = await call(STAFF.s2, 'POST', { tipo: 'out', geo_error: 'timeout', open_in_at: inAt })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'justification_required')
})

await test('bar without a location → punch goes through as no_venue, no reason needed', async () => {
  const r = await call(STAFF.s3, 'POST', { tipo: 'in', geo_error: 'denied' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.punch.geo_status, 'no_venue')
  assert.equal(r.body.punch.justification, null)
  const list = await call(STAFF.s3, 'GET', {}, {})
  assert.deepEqual(list.body.venue, { configured: false })
})

console.log(`\n${n} tests passed`)
