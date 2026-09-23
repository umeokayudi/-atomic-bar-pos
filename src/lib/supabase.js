import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const BAR_ID = import.meta.env.VITE_BAR_ID || 'local-bar'

const LS_KEY = 'atomic-bar-local-db'

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now()
}

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {}
  } catch {
    return {}
  }
}

function saveStore(store) {
  localStorage.setItem(LS_KEY, JSON.stringify(store))
}

function createLocalClient() {
  const applyFilters = (rows, filters) => rows.filter(row => filters.every(fn => fn(row)))

  function from(table) {
    const state = { filters: [], orderCol: null, orderAsc: true, gte: [] }

    const runSelect = () => {
      const store = loadStore()
      let rows = [...(store[table] || [])]
      rows = applyFilters(rows, state.filters)
      if (state.orderCol) {
        rows.sort((a, b) => {
          const av = a[state.orderCol], bv = b[state.orderCol]
          if (av === bv) return 0
          const cmp = av > bv ? 1 : -1
          return state.orderAsc ? cmp : -cmp
        })
      }
      return { data: rows, error: null }
    }

    const builder = {
      select() { return builder },
      eq(col, val) {
        state.filters.push(row => row[col] === val)
        return builder
      },
      gte(col, val) {
        state.filters.push(row => String(row[col] || '') >= String(val))
        return builder
      },
      order(col, opts = {}) {
        state.orderCol = col
        state.orderAsc = opts.ascending !== false
        return builder
      },
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload]
        const store = loadStore()
        const tableRows = store[table] || []
        const inserted = rows.map(r => ({ id: r.id || uuid(), created_at: new Date().toISOString(), ...r }))
        store[table] = [...tableRows, ...inserted]
        saveStore(store)
        const result = { data: inserted, error: null }
        return {
          select() {
            return {
              single() { return Promise.resolve({ data: inserted[0], error: null }) },
              then: (res, rej) => Promise.resolve(result).then(res, rej),
            }
          },
          then: (res, rej) => Promise.resolve(result).then(res, rej),
        }
      },
      update(payload) {
        return {
          eq(col, val) {
            const store = loadStore()
            const tableRows = store[table] || []
            store[table] = tableRows.map(r => r[col] === val ? { ...r, ...payload } : r)
            saveStore(store)
            return Promise.resolve({ data: store[table].filter(r => r[col] === val), error: null })
          },
        }
      },
      then(resolve, reject) {
        return Promise.resolve(runSelect()).then(resolve, reject)
      },
    }
    return builder
  }

  return {
    from,
    rpc() { return Promise.resolve({ data: null, error: null }) },
    channel() {
      return {
        on() { return this },
        subscribe() { return this },
      }
    },
    removeChannel() {},
  }
}

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, { realtime: { params: { eventsPerSecond: 10 } } })
  : createLocalClient()
