/** Client wrapper: POS/CRM tables go to /api/bar/live-db when Postgres schema is missing. */

export const LIVE_TABLES = new Set([
  'pos_vendas',
  'pos_vendas_itens',
  'vip_members',
  'vip_usages',
  'discount_codes',
  'discount_usages',
  'drink_back_agents',
  'bar_spaces',
  'bar_guests',
  'bar_visits',
  'bar_bottle_keeps',
  'time_clock',
  'bar_geo',
  'staff_extras',
  'drink_menu',
  'bar_pricing',
  'bar_overhead',
  'bar_hq_meta',
  'pos_shifts',
  'pos_settings',
])

let sourcePromise = null

async function detectSource() {
  if (sourcePromise) return sourcePromise
  sourcePromise = (async () => {
    try {
      const r = await fetch('/api/pos-status')
      const j = await r.json()
      return j.source === 'postgres' ? 'postgres' : 'live'
    } catch {
      return 'live'
    }
  })()
  return sourcePromise
}

class LiveQuery {
  constructor(table, rawFrom, getToken) {
    this.table = table
    this.rawFrom = rawFrom
    this.getToken = getToken
    this.spec = {
      table,
      mode: 'select',
      columns: '*',
      filters: [],
      orderBy: null,
      limitN: null,
      wantSingle: false,
      insertRows: null,
      updatePatch: null,
    }
  }

  select(columns = '*') {
    this.spec.columns = columns
    return this
  }

  eq(k, v) { this.spec.filters.push({ op: 'eq', k, v }); return this }
  neq(k, v) { this.spec.filters.push({ op: 'neq', k, v }); return this }
  in(k, v) { this.spec.filters.push({ op: 'in', k, v }); return this }
  gte(k, v) { this.spec.filters.push({ op: 'gte', k, v }); return this }
  lte(k, v) { this.spec.filters.push({ op: 'lte', k, v }); return this }
  gt(k, v) { this.spec.filters.push({ op: 'gt', k, v }); return this }
  lt(k, v) { this.spec.filters.push({ op: 'lt', k, v }); return this }
  is(k, v) { this.spec.filters.push({ op: 'is', k, v }); return this }
  not(k, sub, v) { this.spec.filters.push({ op: 'not', k, sub, v }); return this }
  order(k, opts = {}) { this.spec.orderBy = { k, ascending: opts.ascending !== false }; return this }
  limit(n) { this.spec.limitN = n; return this }
  single() { this.spec.wantSingle = true; return this }
  maybeSingle() { this.spec.wantSingle = 'maybe'; return this }

  insert(rows) {
    this.spec.mode = 'insert'
    this.spec.insertRows = Array.isArray(rows) ? rows : [rows]
    return this
  }

  update(patch) {
    this.spec.mode = 'update'
    this.spec.updatePatch = patch
    return this
  }

  delete() {
    this.spec.mode = 'delete'
    return this
  }

  upsert(rows) {
    this.spec.mode = 'upsert'
    this.spec.insertRows = Array.isArray(rows) ? rows : [rows]
    return this
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject)
  }

  catch(cb) {
    return this.execute().catch(cb)
  }

  async execute() {
    const token = await this.getToken()
    try {
      const r = await fetch('/api/bar/live-db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(this.spec),
        signal: AbortSignal.timeout(12000),
      })
      const j = await r.json().catch(() => ({ error: r.statusText }))
      if (r.ok && !j.error) return { data: j.data, error: null }
      const fallback = await this.executeRaw()
      if (!fallback.error) return fallback
      return { data: this.spec.wantSingle ? null : [], error: { message: j.error || j.message || fallback.error?.message || r.statusText, code: 'LIVE' } }
    } catch (e) {
      try {
        return await this.executeRaw()
      } catch {
        return { data: this.spec.wantSingle ? null : [], error: { message: e.message } }
      }
    }
  }

  async executeRaw() {
    let q = this.rawFrom()
    if (this.spec.mode === 'insert') q = q.insert(this.spec.insertRows.length === 1 ? this.spec.insertRows[0] : this.spec.insertRows)
    else if (this.spec.mode === 'update') q = q.update(this.spec.updatePatch)
    else if (this.spec.mode === 'delete') q = q.delete()
    else if (this.spec.mode === 'upsert') q = q.upsert(this.spec.insertRows.length === 1 ? this.spec.insertRows[0] : this.spec.insertRows)
    if (this.spec.mode === 'select' || this.spec.mode === 'insert' || this.spec.mode === 'update' || this.spec.mode === 'upsert') {
      q = q.select(this.spec.columns)
    }
    for (const f of this.spec.filters) {
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
    if (this.spec.orderBy) q = q.order(this.spec.orderBy.k, { ascending: this.spec.orderBy.ascending })
    if (this.spec.limitN != null) q = q.limit(this.spec.limitN)
    if (this.spec.wantSingle === true) q = q.single()
    if (this.spec.wantSingle === 'maybe') q = q.maybeSingle()
    return q
  }
}

export function wrapBarLive(client) {
  const rawFrom = client.from.bind(client)
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table) => {
          if (!LIVE_TABLES.has(table)) return rawFrom(table)
          return new LiveQuery(table, () => rawFrom(table), async () => {
            const { readLaneToken } = await import('./barLanes.js')
            const lane = readLaneToken()
            if (lane) return lane
            const { data } = await client.auth.getSession()
            return data?.session?.access_token || null
          })
        }
      }
      const val = Reflect.get(target, prop, receiver)
      return typeof val === 'function' ? val.bind(target) : val
    },
  })
}
