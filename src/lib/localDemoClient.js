/**
 * Browser-only store for Preview when no safe database is configured.
 * Floor plan and profile live here. Sales, stock, and cash live in the DEMO ledger.
 */

import {
  applyDiscount,
  closeTicket,
  loadTicket,
  menuRows,
  previewTicket,
  salesRows,
  ticketItem,
} from './demoLedger.js'

const STORAGE_KEY = 'atomic-bar-local-demo'
export const DEMO_BAR_ID = 'demo-bar'
export const DEMO_USER_ID = 'demo-local'

function floorPlan() {
  const spaces = []
  for (let i = 1; i <= 8; i += 1) {
    spaces.push({ nome: `カウンター ${i}`, tipo: 'counter', capacidade: 1, zona: 'counter', ordem: i })
  }
  ;['A', 'B', 'C', 'D'].forEach((letter, i) => {
    spaces.push({ nome: `テーブル ${letter}`, tipo: 'table', capacidade: 4, zona: 'table', ordem: 20 + i })
  })
  spaces.push({ nome: '個室 VIP 1', tipo: 'vip_room', capacidade: 6, zona: 'vip', ordem: 40 })
  spaces.push({ nome: '個室 VIP 2', tipo: 'vip_room', capacidade: 8, zona: 'vip', ordem: 41 })
  spaces.push({ nome: '個室 VIP 3', tipo: 'vip_room', capacidade: 6, zona: 'vip', ordem: 42 })
  return spaces.map((row, i) => ({
    ...row,
    id: `demo-space-${i + 1}`,
    bar_id: DEMO_BAR_ID,
    ativo: true,
  }))
}

function emptyBooks() {
  return {
    bars: [{ id: DEMO_BAR_ID, nome: 'Atomic Bar', ativo: true }],
    perfis: [{
      id: DEMO_USER_ID,
      email: 'demo@local',
      nome: 'Demo',
      role: 'gerente',
      bar_id: DEMO_BAR_ID,
      ativo: true,
    }],
    bar_spaces: floorPlan(),
  }
}

function memoryStore() {
  if (!globalThis.__atomicBarDemoStore) globalThis.__atomicBarDemoStore = emptyBooks()
  return globalThis.__atomicBarDemoStore
}

function readStore() {
  try {
    if (typeof localStorage === 'undefined') return memoryStore()
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const seeded = emptyBooks()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
      return seeded
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyBooks()
    if (!Array.isArray(parsed.bars)) parsed.bars = emptyBooks().bars
    if (!Array.isArray(parsed.perfis)) parsed.perfis = emptyBooks().perfis
    if (!Array.isArray(parsed.bar_spaces)) parsed.bar_spaces = emptyBooks().bar_spaces
    return parsed
  } catch {
    return emptyBooks()
  }
}

function writeStore(store) {
  try {
    if (typeof localStorage === 'undefined') {
      globalThis.__atomicBarDemoStore = store
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    globalThis.__atomicBarDemoStore = store
  }
}

function newId() {
  return globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function match(row, filter) {
  const val = row?.[filter.k]
  if (filter.op === 'eq') return val === filter.v
  if (filter.op === 'neq') return val !== filter.v
  if (filter.op === 'in') return Array.isArray(filter.v) && filter.v.includes(val)
  if (filter.op === 'gte') return val >= filter.v
  if (filter.op === 'lte') return val <= filter.v
  if (filter.op === 'gt') return val > filter.v
  if (filter.op === 'lt') return val < filter.v
  if (filter.op === 'is') return filter.v == null ? val == null : val === filter.v
  if (filter.op === 'not' && filter.sub === 'is') return val != null
  return true
}

function project(row, columns) {
  if (!columns || columns === '*') return { ...row }
  const names = String(columns).split(',').map(part => part.trim()).filter(name => name && !name.includes('('))
  if (!names.length) return { ...row }
  const out = {}
  for (const name of names) {
    if (name in row) out[name] = row[name]
  }
  return Object.keys(out).length ? out : { ...row }
}

class DemoQuery {
  constructor(table) {
    this.table = table
    this.filters = []
    this.mode = 'select'
    this.columns = '*'
    this.patch = null
    this.incoming = null
    this.limitN = null
    this.orderBy = null
    this.wantSingle = false
    this.countMode = null
  }

  select(columns = '*', opts) {
    this.columns = columns || '*'
    if (opts?.count) this.countMode = opts.count
    return this
  }

  eq(k, v) { this.filters.push({ op: 'eq', k, v }); return this }
  neq(k, v) { this.filters.push({ op: 'neq', k, v }); return this }
  in(k, v) { this.filters.push({ op: 'in', k, v }); return this }
  gte(k, v) { this.filters.push({ op: 'gte', k, v }); return this }
  lte(k, v) { this.filters.push({ op: 'lte', k, v }); return this }
  gt(k, v) { this.filters.push({ op: 'gt', k, v }); return this }
  lt(k, v) { this.filters.push({ op: 'lt', k, v }); return this }
  is(k, v) { this.filters.push({ op: 'is', k, v }); return this }
  not(k, sub, v) { this.filters.push({ op: 'not', k, sub, v }); return this }
  order(k, opts = {}) { this.orderBy = { k, ascending: opts.ascending !== false }; return this }
  limit(n) { this.limitN = n; return this }
  single() { this.wantSingle = true; return this }
  maybeSingle() { this.wantSingle = 'maybe'; return this }

  insert(rows) {
    this.mode = 'insert'
    this.incoming = Array.isArray(rows) ? rows : [rows]
    return this
  }

  update(patch) {
    this.mode = 'update'
    this.patch = patch || {}
    return this
  }

  delete() {
    this.mode = 'delete'
    return this
  }

  upsert(rows) {
    this.mode = 'upsert'
    this.incoming = Array.isArray(rows) ? rows : [rows]
    return this
  }

  then(resolve, reject) {
    return this.run().then(resolve, reject)
  }

  catch(cb) {
    return this.run().catch(cb)
  }

  async run() {
    const store = readStore()
    const table = this.table
    const ledgerTable = table === 'drink_menu' || table === 'pos_vendas'
    if (ledgerTable && this.mode !== 'select') {
      return { data: null, error: { message: 'DEMO books change only through the simulated register' }, count: 0 }
    }
    const rows = ledgerTable
      ? (table === 'drink_menu' ? menuRows() : salesRows())
      : (Array.isArray(store[table]) ? store[table] : [])
    const filtered = () => rows.filter(row => this.filters.every(filter => match(row, filter)))

    if (this.mode === 'insert' || this.mode === 'upsert') {
      const created = (this.incoming || []).map(row => ({ id: row?.id || newId(), ...row }))
      store[table] = rows.concat(created)
      writeStore(store)
      return finish(created, this)
    }

    if (this.mode === 'update') {
      const next = rows.map(row => (this.filters.every(filter => match(row, filter)) ? { ...row, ...this.patch } : row))
      store[table] = next
      writeStore(store)
      return finish(next.filter(row => this.filters.every(filter => match(row, filter))), this)
    }

    if (this.mode === 'delete') {
      const removed = filtered()
      store[table] = rows.filter(row => !this.filters.every(filter => match(row, filter)))
      writeStore(store)
      return finish(removed, this)
    }

    let data = filtered()
    if (this.orderBy) {
      const { k, ascending } = this.orderBy
      data = [...data].sort((a, b) => {
        if (a?.[k] === b?.[k]) return 0
        if (a?.[k] > b?.[k]) return ascending ? 1 : -1
        return ascending ? -1 : 1
      })
    }
    const count = data.length
    if (this.limitN != null) data = data.slice(0, this.limitN)
    return finish(data, this, count)
  }
}

function finish(rows, query, count = rows.length) {
  const projected = rows.map(row => project(row, query.columns))
  if (query.wantSingle === true) {
    if (projected.length !== 1) {
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, count }
    }
    return { data: projected[0], error: null, count }
  }
  if (query.wantSingle === 'maybe') {
    if (projected.length > 1) {
      return { data: null, error: { message: 'JSON object requested, multiple rows returned', code: 'PGRST116' }, count }
    }
    return { data: projected[0] || null, error: null, count }
  }
  return { data: projected, error: null, count: query.countMode ? count : null }
}

function demoSession() {
  return {
    access_token: 'local-demo',
    user: { id: DEMO_USER_ID, email: 'demo@local' },
  }
}

const DEMO_PORTALS = new Set(['gerente', 'caixa', 'funcionario', 'fornecedor', 'admin'])

/** Local preview only. Changes the fictional profile in this browser. */
export function writeDemoRole(role) {
  if (!DEMO_PORTALS.has(role)) return false
  const store = readStore()
  const perfil = store.perfis?.[0]
  if (!perfil) return false
  perfil.role = role
  perfil.bar_id = DEMO_BAR_ID
  writeStore(store)
  return true
}

export function createLocalDemoClient() {
  const client = {
    __localDemo: true,
    from(table) {
      return new DemoQuery(table)
    },
    async rpc(name, args = {}) {
      if (name === 'pos_bottle_board') return { data: [], error: null }
      if (name === 'pos_load_ticket') return loadTicket(args)
      if (name === 'pos_preview_ticket') return previewTicket(args)
      if (name === 'pos_ticket_item') return ticketItem(args)
      if (name === 'pos_apply_discount') return applyDiscount(args)
      if (name === 'pos_close_ticket') return closeTicket(args)
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    },
    auth: {
      async getSession() {
        return { data: { session: demoSession() }, error: null }
      },
      onAuthStateChange(cb) {
        queueMicrotask(() => cb('INITIAL_SESSION', demoSession()))
        return { data: { subscription: { unsubscribe() {} } } }
      },
      async signInWithPassword() {
        return { data: { user: demoSession().user, session: demoSession() }, error: null }
      },
      async signOut() {
        return { error: null }
      },
      async signUp() {
        return { data: { user: null, session: null }, error: { message: 'Demo mode does not create accounts' } }
      },
      async refreshSession() {
        return { data: { session: demoSession() }, error: null }
      },
      async getUser() {
        return { data: { user: demoSession().user }, error: null }
      },
    },
    storage: {
      from() {
        return {
          upload: async () => ({ data: null, error: { message: 'Demo mode has no file storage' } }),
          getPublicUrl: () => ({ data: { publicUrl: '' } }),
        }
      },
    },
  }
  return client
}
