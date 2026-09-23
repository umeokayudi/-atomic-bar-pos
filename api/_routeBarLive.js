/** HTTP CRUD for POS/CRM live-store. Never touches JBM ledgers. */

import { drinksAdminClient } from './_supabaseAdmin.js'
import { handleCorsPreflight, setCorsHeaders } from './_cors.js'
import { LIVE_TABLES, ensureBarLiveReady, runLiveOp } from './_barLiveStore.js'
import { resolveBarActor } from './_barLaneAuth.js'

const SECRET_TABLES = new Set(['bar_logins', 'bar_sessions'])
const PG_MENU_TABLES = new Set(['drink_menu', 'bar_pricing', 'bars'])
const GERENTE_WRITE = new Set(['bar_overhead', 'bar_hq_meta'])

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
  if (row && !row.bar_id && table !== 'bar_geo') row.bar_id = barId
  const next = [...(filters || [])]
  if (!next.some(f => f.k === 'bar_id') && table !== 'bar_geo' && table !== 'staff_extras' && table !== 'pos_vendas_itens') {
    next.push({ op: 'eq', k: 'bar_id', v: barId })
  }
  return { filters: next, row, error: null }
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res, 'GET, POST, OPTIONS')

  let admin
  try { admin = drinksAdminClient() } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  const auth = await resolveBarActor(req, admin)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  try {
    await ensureBarLiveReady(admin)
    const body = req.method === 'GET' ? { table: req.query?.table, mode: 'select' } : bodyOf(req)
    const table = String(body.table || '')
    if (SECRET_TABLES.has(table)) return res.status(403).json({ error: 'Forbidden table' })
    if (!LIVE_TABLES.includes(table) && !PG_MENU_TABLES.has(table)) {
      return res.status(400).json({ error: 'Unknown table' })
    }
    if (GERENTE_WRITE.has(table) && (body.mode || 'select') !== 'select') {
      const role = auth.perfil?.role
      if (role !== 'cliente' && role !== 'gerente') {
        return res.status(403).json({ error: 'Only the manager can write HQ books' })
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
      const bad = spec.insertRows.find(r => r && auth.perfil.bar_id && r.bar_id && r.bar_id !== auth.perfil.bar_id && ['cliente', 'gerente', 'caixa', 'bar_staff'].includes(auth.perfil.role))
      if (bad) return res.status(403).json({ error: 'bar_id mismatch' })
    } else {
      const scoped = scopedFilters(auth, table, spec.filters, null)
      if (scoped.error) return res.status(403).json({ error: scoped.error })
      spec.filters = scoped.filters
    }

    if (PG_MENU_TABLES.has(table)) {
      if (spec.mode !== 'select') return res.status(403).json({ error: 'Menu tables are read-only here' })
      const result = await runPgSelect(admin, spec)
      if (result.error) return res.status(400).json(result)
      return res.status(200).json({ data: result.data, error: null })
    }

    const result = await runLiveOp(admin, spec)
    if (result.error) return res.status(400).json(result)
    return res.status(200).json(result)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
