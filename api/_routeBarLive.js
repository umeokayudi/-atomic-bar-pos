/** HTTP CRUD for POS/CRM live-store. Never touches JBM ledgers. */

import { tryDrinksAdminClient, createStaffUserClient } from './_supabaseAdmin.js'
import { handleCorsPreflight, setCorsHeaders } from './_cors.js'
import { LIVE_TABLES, ensureBarLiveReady, runLiveOp } from './_barLiveStore.js'
import { areaOpen, loadLock } from './_barVault.js'
import { resolveBarActor } from './_barLaneAuth.js'
import { errText } from '../src/lib/errText.js'
import { LIVE_TABLE_AREA, canAccessAny } from '../src/lib/barAccess.js'
import { frontDeleteError, frontSaleWriteError, guardSalePatch, isFrontLogin, stampSaleRows } from './_posSaleStamp.js'

function sendResult(res, result) {
  if (result?.error) {
    return res.status(400).json({
      data: result.data ?? null,
      error: errText(result.error, 'Query failed'),
      code: result.error.code || undefined,
    })
  }
  return res.status(200).json({ data: result.data, error: null })
}

// staff_requests / staff_day_reports / staff_availability / staff_schedule / staff_fines / staff_payouts: only /api/bar-staff reads them (own rows for staff, the bar's for owner/manager).
const SECRET_TABLES = new Set([
  'bar_logins', 'bar_sessions', 'bar_locks', 'staff_requests', 'staff_day_reports',
  'staff_availability', 'staff_schedule', 'staff_fines', 'staff_payouts',
])
// Raw rows behind the owner's PIN: cost registry (money) and pay per person (payroll). The app reads them via /api/bar-staff.
const VAULT_TABLES = { bar_registry: 'money', staff_extras: 'payroll' }
const PG_MENU_TABLES = new Set(['drink_menu', 'bar_pricing', 'bars'])
const GERENTE_WRITE = new Set(['bar_overhead', 'bar_hq_meta'])
// The floor plan is drawn by the owner/manager; everyone at the bar can read it.
const FLOOR_WRITE = new Set(['floor_layouts', 'floor_sectors', 'floor_tables'])
// The bar's colour and logo are set in HQ → Bars; the bar itself only reads them.
const HQ_WRITE = new Set(['bar_brand', 'jbm_company', 'bar_profile'])
// Writes to these tables leave a line in the activity log (who, when, what), stamped here on the server.
const AUDITED = new Set(['pos_vendas', 'pos_vendas_itens', 'pos_shifts', 'pos_close_checks', 'bar_overhead', 'bar_guest_ledger', 'bar_profile', 'jbm_company'])
const AUDIT_TABLE = 'audit_events'
const AUDIT_KEEP = 4000

function actorOf(auth) {
  return {
    user_id: auth.user?.id || null,
    user_nome: auth.perfil?.nome || auth.perfil?.email || auth.user?.email || null,
    role: auth.perfil?.role || null,
  }
}

function trimJson(v) {
  try {
    const txt = JSON.stringify(v ?? null)
    return txt.length > 2000 ? JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 200 ? x.slice(0, 200) : x))) : v
  } catch { return null }
}

/** One activity-log line; never blocks or fails the write it describes. */
async function appendAudit(admin, auth, entry) {
  if (!admin) return
  try {
    const row = {
      id: `ae_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      criado_em: new Date().toISOString(),
      ...actorOf(auth),
      bar_id: (['cliente', 'gerente', 'caixa', 'bar_staff'].includes(auth.perfil?.role) ? auth.perfil?.bar_id : entry.bar_id) || auth.perfil?.bar_id || null,
      tabela: String(entry.tabela || ''),
      registro_id: entry.registro_id ? String(entry.registro_id) : null,
      acao: ['insert', 'update', 'delete', 'upsert'].includes(entry.acao) ? entry.acao : 'update',
      antes: trimJson(entry.antes),
      depois: trimJson(entry.depois),
      fonte: entry.fonte || 'app',
    }
    await runLiveOp(admin, { table: AUDIT_TABLE, mode: 'insert', insertRows: [row] })
    // Keep the JSON store small: drop the oldest lines past the limit.
    const all = await runLiveOp(admin, { table: AUDIT_TABLE, mode: 'select', columns: 'id,criado_em', orderBy: { k: 'criado_em', ascending: false } })
    const extra = (all.data || []).slice(AUDIT_KEEP).map(r => r.id)
    if (extra.length) await runLiveOp(admin, { table: AUDIT_TABLE, mode: 'delete', filters: [{ op: 'in', k: 'id', v: extra }] })
  } catch { /* the log must never break the write */ }
}

function auditEntryOf(table, spec) {
  const idFilter = (spec.filters || []).find(f => f.k === 'id' && f.op === 'eq')
  const barFilter = (spec.filters || []).find(f => f.k === 'bar_id' && f.op === 'eq')
  if (spec.mode === 'insert' || spec.mode === 'upsert') {
    const rows = spec.insertRows || []
    return rows.map(r => ({ tabela: table, acao: spec.mode === 'upsert' ? 'update' : 'insert', registro_id: r?.id || null, bar_id: r?.bar_id || barFilter?.v || null, depois: r }))
  }
  return [{ tabela: table, acao: spec.mode, registro_id: idFilter?.v || null, bar_id: barFilter?.v || null, depois: spec.mode === 'update' ? spec.updatePatch : null, antes: spec.mode === 'delete' ? { filters: spec.filters } : null }]
}

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

async function runPgSelect(admin, spec) {
  let q = admin.from(spec.table).select(spec.columns || '*')
  for (const f of spec.filters || []) {
    if (f.op === 'eq') q = q.eq(f.k, f.v)
    else if (f.op === 'neq') q = q.neq(f.k, f.v)
    else if (f.op === 'in') q = q.in(f.k, f.v)
    else if (f.op === 'gte') q = q.gte(f.k, f.v)
    else if (f.op === 'lte') q = q.lte(f.k, f.v)
    else if (f.op === 'gt') q = q.gt(f.k, f.v)
    else if (f.op === 'lt') q = q.lt(f.k, f.v)
    else if (f.op === 'is') q = q.is(f.k, f.v)
    else if (f.op === 'not') q = q.not(f.k, f.sub, f.v)
  }
  if (spec.orderBy) q = q.order(spec.orderBy.k, { ascending: spec.orderBy.ascending !== false })
  if (spec.limitN != null) q = q.limit(spec.limitN)
  if (spec.wantSingle === true) q = q.single()
  if (spec.wantSingle === 'maybe') q = q.maybeSingle()
  return q
}

function scopedFilters(auth, table, filters, row) {
  const barRoles = ['cliente', 'gerente', 'caixa', 'bar_staff']
  if (!barRoles.includes(auth.perfil?.role) || !auth.perfil.bar_id) return { filters, row, error: null }
  const barId = auth.perfil.bar_id
  if (table === 'staff_extras') return { filters, row, error: null }
  if (table === 'pos_vendas_itens') return { filters, row, error: null }
  if (row && row.bar_id && row.bar_id !== barId) return { error: 'bar_id mismatch' }
  // jbm_company is one row for the whole company (the receipt issuer), not a bar's row.
  if (table === 'jbm_company') return { filters, row, error: null }
  if (row && !row.bar_id && table !== 'bar_geo') row.bar_id = barId
  const next = [...(filters || [])]
  if (!next.some(f => f.k === 'bar_id') && table !== 'bar_geo' && table !== 'staff_extras' && table !== 'pos_vendas_itens') {
    next.push({ op: 'eq', k: 'bar_id', v: barId })
  }
  return { filters: next, row, error: null }
}

async function runPgOp(db, spec) {
  const table = spec.table
  if (spec.mode === 'select' || !spec.mode) return runPgSelect(db, spec)

  if (spec.mode === 'insert') {
    const rows = spec.insertRows || []
    let q = db.from(table).insert(rows.length === 1 ? rows[0] : rows).select(spec.columns || '*')
    if (spec.wantSingle === true) q = q.single()
    return q
  }
  if (spec.mode === 'upsert') {
    const rows = spec.insertRows || []
    let q = db.from(table).upsert(rows.length === 1 ? rows[0] : rows).select(spec.columns || '*')
    if (spec.wantSingle === true) q = q.single()
    return q
  }
  if (spec.mode === 'update') {
    let q = db.from(table).update(spec.updatePatch || {})
    for (const f of spec.filters || []) {
      if (f.op === 'eq') q = q.eq(f.k, f.v)
      else if (f.op === 'neq') q = q.neq(f.k, f.v)
      else if (f.op === 'in') q = q.in(f.k, f.v)
    }
    q = q.select(spec.columns || '*')
    if (spec.wantSingle === true) q = q.single()
    return q
  }
  if (spec.mode === 'delete') {
    let q = db.from(table).delete()
    for (const f of spec.filters || []) {
      if (f.op === 'eq') q = q.eq(f.k, f.v)
      else if (f.op === 'in') q = q.in(f.k, f.v)
    }
    return q
  }
  return { data: null, error: { message: 'Unknown mode' } }
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res, 'GET, POST, OPTIONS')

  const admin = tryDrinksAdminClient()
  const auth = await resolveBarActor(req, admin)
  if (auth.error) return res.status(auth.status).json({ error: errText(auth.error, 'Unauthorized') })
  if (auth.disabled && auth.perfil?.role !== 'cliente') return res.status(403).json({ error: 'This login is turned off' })

  const db = admin || (auth.token ? createStaffUserClient(auth.token) : null)
  if (!db) return res.status(500).json({ error: 'Database client unavailable' })

  try {
    if (admin) await ensureBarLiveReady(admin)
    const body = req.method === 'GET' ? { table: req.query?.table, mode: 'select' } : bodyOf(req)
    const table = String(body.table || '')
    if (SECRET_TABLES.has(table)) return res.status(403).json({ error: 'Forbidden table' })
    if (!LIVE_TABLES.includes(table) && !PG_MENU_TABLES.has(table)) {
      return res.status(400).json({ error: 'Unknown table' })
    }
    const barRole = ['cliente', 'gerente', 'caixa', 'bar_staff'].includes(auth.perfil?.role)
    // Login extras (pay, area list, on/off) change only through /api/bar-staff; the app never writes them here.
    if (table === 'staff_extras' && barRole && (body.mode || 'select') !== 'select') {
      return res.status(403).json({ error: 'Use the team screens to change staff details' })
    }
    // A login limited in "Users & access" reaches money/payroll/team tables only with that area.
    if (LIVE_TABLE_AREA[table] && !canAccessAny(auth.perfil, LIVE_TABLE_AREA[table])) {
      return res.status(403).json({ error: 'This login has no access to this area', area: LIVE_TABLE_AREA[table].split('|')[0], code: 'area' })
    }
    if (VAULT_TABLES[table]) {
      const lock = await loadLock(db, auth.perfil?.bar_id)
      if (!areaOpen(req, lock, VAULT_TABLES[table], { barId: auth.perfil?.bar_id, uid: auth.user?.id || '' })) {
        return res.status(423).json({ error: 'Locked: enter the PIN first', locked: VAULT_TABLES[table] })
      }
    }
    if (GERENTE_WRITE.has(table) && (body.mode || 'select') !== 'select') {
      const role = auth.perfil?.role
      if (role !== 'cliente' && role !== 'gerente') {
        return res.status(403).json({ error: 'Only the manager can write HQ books' })
      }
    }
    if (table === AUDIT_TABLE) {
      const mode = body.mode || 'select'
      const role = auth.perfil?.role
      // Read: HQ (everything) and the bar owner/manager (own bar, scoped below). Write: only "insert", and the
      // server stamps who and when; nobody edits or deletes log lines.
      if (mode === 'select' && !['admin', 'jbm', 'cliente', 'gerente'].includes(role)) return res.status(403).json({ error: 'Forbidden' })
      if (mode !== 'select' && mode !== 'insert') return res.status(403).json({ error: 'The activity log cannot be changed' })
      if (mode === 'insert') {
        if (!['admin', 'jbm', 'cliente', 'gerente'].includes(role)) return res.status(403).json({ error: 'Forbidden' })
        for (const r of body.insertRows || []) await appendAudit(admin, auth, { ...r, fonte: 'app' })
        return res.status(200).json({ data: null, error: null })
      }
    }
    if (HQ_WRITE.has(table) && (body.mode || 'select') !== 'select' && !['admin', 'jbm'].includes(auth.perfil?.role)) {
      return res.status(403).json({ error: table === 'bar_brand' ? 'Only HQ can change the bar look' : 'Only HQ can change this' })
    }
    if (FLOOR_WRITE.has(table) && (body.mode || 'select') !== 'select') {
      const role = auth.perfil?.role
      if (!['cliente', 'gerente', 'admin', 'jbm'].includes(role)) {
        return res.status(403).json({ error: 'Only the manager can change the floor plan' })
      }
    }

    const spec = {
      table,
      mode: body.mode || 'select',
      columns: body.columns || '*',
      filters: body.filters || [],
      orderBy: body.orderBy || null,
      limitN: body.limitN ?? null,
      wantSingle: body.wantSingle || false,
      insertRows: body.insertRows || null,
      updatePatch: body.updatePatch || null,
    }

    if (spec.mode === 'insert' || spec.mode === 'upsert') {
      spec.insertRows = (spec.insertRows || []).map(row => {
        const scoped = scopedFilters(auth, table, spec.filters, { ...row })
        return scoped.row
      })
      // Who rang the sale up comes from the signed-in login, never from the browser.
      spec.insertRows = stampSaleRows(table, spec.insertRows, auth)
      const bad = spec.insertRows.find(r => r && auth.perfil.bar_id && r.bar_id && r.bar_id !== auth.perfil.bar_id && ['cliente', 'gerente', 'caixa', 'bar_staff'].includes(auth.perfil.role))
      if (bad) return res.status(403).json({ error: 'bar_id mismatch' })
    } else {
      if (spec.mode === 'update') spec.updatePatch = guardSalePatch(table, spec.updatePatch, auth)
      const scoped = scopedFilters(auth, table, spec.filters, null)
      if (scoped.error) return res.status(403).json({ error: scoped.error })
      spec.filters = scoped.filters
    }

    const frontErr = frontSaleWriteError(table, spec, auth)
    if (frontErr) return res.status(403).json({ error: frontErr })
    if (spec.mode === 'delete' && isFrontLogin(auth) && (table === 'pos_vendas' || table === 'pos_vendas_itens')) {
      const sel = q => (admin ? runLiveOp(admin, { mode: 'select', ...q }) : runPgSelect(db, q))
      let saleRows = []
      if (table === 'pos_vendas') {
        saleRows = (await sel({ table, columns: 'id,criado_por,criado_em', filters: spec.filters })).data || []
      } else {
        const items = (await sel({ table, columns: 'pos_venda_id', filters: spec.filters })).data || []
        const ids = [...new Set(items.map(r => r.pos_venda_id).filter(Boolean))]
        if (ids.length) {
          saleRows = (await sel({ table: 'pos_vendas', columns: 'id,criado_por,criado_em,bar_id', filters: [{ op: 'in', k: 'id', v: ids }, { op: 'eq', k: 'bar_id', v: auth.perfil.bar_id }] })).data || []
          if (saleRows.length !== ids.length) return res.status(403).json({ error: 'Only the owner or a manager can delete a sale' })
        }
      }
      const delErr = frontDeleteError(saleRows, auth)
      if (delErr) return res.status(403).json({ error: delErr })
    }

    if (PG_MENU_TABLES.has(table)) {
      if (spec.mode !== 'select') return res.status(403).json({ error: 'Menu tables are read-only here' })
      return sendResult(res, await runPgSelect(db, spec))
    }

    if (!admin) {
      return sendResult(res, await runPgOp(db, spec))
    }

    const result = await runLiveOp(admin, spec)
    if (!result?.error && spec.mode !== 'select' && AUDITED.has(table)) {
      for (const entry of auditEntryOf(table, spec)) await appendAudit(admin, auth, entry)
    }
    return sendResult(res, result)
  } catch (e) {
    return res.status(500).json({ error: errText(e, 'live-db failed') })
  }
}
