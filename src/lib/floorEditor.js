/**
 * Floor editor model: pure functions over { layout, sectors, tables } so the editor, undo and tests share them.
 * Space only: nothing here touches money. Saved with public.floor_save_layout (one transaction, version check).
 */

export const SHAPES = {
  round: { largura: 90, altura: 90, capacidade: 4 },
  square: { largura: 90, altura: 90, capacidade: 4 },
  rect: { largura: 160, altura: 90, capacidade: 6 },
  bar: { largura: 260, altura: 70, capacidade: 8 },
}
export const GRID = 10
export const MIN_SIZE = 40
export const TABLE_COLORS = ['', '#3F7F67', '#83B7A0', '#C9A15B', '#B5655B', '#5B7FB5', '#8A6BB5', '#6B7A75']

export const isTemp = id => String(id || '').startsWith('tmp-')
let seq = 0
export const tempId = () => `tmp-${Date.now().toString(36)}-${(seq++).toString(36)}`

export function snap(v, grid = GRID, on = true) {
  return on ? Math.round(v / grid) * grid : Math.round(v)
}

/** Keep a table fully inside the layout. */
export function clampTable(t, layout) {
  const largura = Math.max(MIN_SIZE, Math.min(t.largura, layout.largura))
  const altura = Math.max(MIN_SIZE, Math.min(t.altura, layout.altura))
  return {
    ...t,
    largura,
    altura,
    x: Math.max(0, Math.min(t.x, layout.largura - largura)),
    y: Math.max(0, Math.min(t.y, layout.altura - altura)),
  }
}

/** Next free name like "12" when names are numbers, else "Mesa 3". */
export function nextTableName(tables = [], prefix = 'Mesa') {
  const nums = tables.map(t => String(t.nome).match(/(\d+)\s*$/)).filter(Boolean).map(m => +m[1])
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const allNumeric = tables.length > 0 && tables.every(t => /^\d+$/.test(String(t.nome)))
  return allNumeric ? String(n) : `${prefix} ${n}`
}

/** A free spot: scan the grid left→right, top→bottom for a place that does not overlap. */
export function freeSpot(tables, layout, w, h, gap = 20) {
  for (let y = gap; y + h <= layout.altura; y += GRID * 2) {
    for (let x = gap; x + w <= layout.largura; x += GRID * 2) {
      const box = { x, y, largura: w, altura: h }
      if (!tables.some(t => t.ativo !== false && overlaps(box, t, gap / 2))) return { x, y }
    }
  }
  return { x: gap, y: gap }
}

export function overlaps(a, b, pad = 0) {
  return a.x < b.x + b.largura + pad && b.x < a.x + a.largura + pad && a.y < b.y + b.altura + pad && b.y < a.y + a.altura + pad
}

export function addTable(state, forma = 'square', extra = {}) {
  const dims = SHAPES[forma] || SHAPES.square
  const spot = freeSpot(state.tables, state.layout, dims.largura, dims.altura)
  const table = clampTable({
    id: tempId(), nome: nextTableName(state.tables), forma, ...dims, ...spot, rotacao: 0, cor: '', sector_id: null, ativo: true, ...extra,
  }, state.layout)
  return { ...state, tables: [...state.tables, table], selected: table.id }
}

export function duplicateTable(state, id) {
  const src = state.tables.find(t => t.id === id)
  if (!src) return state
  const spot = freeSpot(state.tables, state.layout, src.largura, src.altura)
  const copy = clampTable({ ...src, id: tempId(), nome: nextTableName(state.tables), legacy_mesa_id: null, estado_manual: null, ...spot }, state.layout)
  return { ...state, tables: [...state.tables, copy], selected: copy.id }
}

export function updateTable(state, id, patch, { grid = true } = {}) {
  return {
    ...state,
    tables: state.tables.map(t => {
      if (t.id !== id) return t
      const next = { ...t, ...patch }
      for (const k of ['x', 'y', 'largura', 'altura']) if (k in patch) next[k] = snap(+next[k] || 0, GRID, grid)
      if ('capacidade' in patch) next.capacidade = Math.max(0, Math.min(500, Math.round(+patch.capacidade || 0)))
      if ('rotacao' in patch) next.rotacao = ((Math.round(+patch.rotacao || 0) % 360) + 360) % 360
      if (patch.forma === 'round' || patch.forma === 'square') {
        const side = Math.max(next.largura, next.altura)
        next.largura = side
        next.altura = side
      }
      return clampTable(next, state.layout)
    }),
  }
}

/**
 * Remove a table. A table that has an open tab is refused here (and again by the database trigger),
 * so the operation never loses a running tab.
 */
export function removeTable(state, id, busyTableIds = new Set()) {
  if (busyTableIds.has(id)) return { ...state, error: 'floor.errBusyTable' }
  return { ...state, tables: state.tables.filter(t => t.id !== id), selected: state.selected === id ? null : state.selected, error: '' }
}

export function addSector(state, nome, cor = '') {
  const sector = { id: tempId(), nome: String(nome || '').trim() || `Setor ${state.sectors.length + 1}`, cor, ordem: state.sectors.length }
  return { ...state, sectors: [...state.sectors, sector] }
}

export function removeSector(state, id) {
  return {
    ...state,
    sectors: state.sectors.filter(s => s.id !== id),
    tables: state.tables.map(t => (t.sector_id === id ? { ...t, sector_id: null } : t)),
  }
}

/** The arguments of floor_save_layout: new rows have no id; new sectors are linked by key. */
export function toSavePayload(state) {
  const sectors = state.sectors.map((s, i) => (isTemp(s.id)
    ? { key: s.id, nome: s.nome, cor: s.cor || null, ordem: i }
    : { id: s.id, nome: s.nome, cor: s.cor || null, ordem: i }))
  const tables = state.tables.map(t => {
    const row = {
      nome: String(t.nome || '').trim() || '?', forma: t.forma, x: Math.round(t.x), y: Math.round(t.y),
      largura: Math.round(t.largura), altura: Math.round(t.altura), rotacao: Math.round(t.rotacao || 0),
      capacidade: Math.round(t.capacidade || 0), cor: t.cor || null, ativo: t.ativo !== false,
    }
    if (!isTemp(t.id)) row.id = t.id
    if (t.sector_id && isTemp(t.sector_id)) row.sector_key = t.sector_id
    else if (t.sector_id) row.sector_id = t.sector_id
    return row
  })
  return {
    layoutId: state.layout.id, versao: state.layout.versao, nome: state.layout.nome,
    largura: Math.round(state.layout.largura), altura: Math.round(state.layout.altura), sectors, tables,
  }
}

/** Problems to fix before saving (names must be unique and present). Returns error keys. */
export function validateLayout(state) {
  const errors = []
  const names = state.tables.filter(t => t.ativo !== false).map(t => String(t.nome || '').trim().toLowerCase())
  if (names.some(n => !n)) errors.push('floor.errNoName')
  if (new Set(names).size !== names.length) errors.push('floor.errDupName')
  return errors
}

/** Undo/redo over snapshots of { layout, sectors, tables }. */
export function createHistory(present) {
  return { past: [], present, future: [] }
}
export function pushHistory(h, next, limit = 80) {
  if (next === h.present) return h
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] }
}
export function undo(h) {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}
export function redo(h) {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

/** Zoom that fits the whole layout in a viewport, with a margin. */
export function fitZoom(viewW, viewH, layout, margin = 24) {
  if (!viewW || !viewH) return 1
  const z = Math.min((viewW - margin) / layout.largura, (viewH - margin) / layout.altura)
  return Math.max(0.25, Math.min(2, Math.round(z * 100) / 100))
}

export function isDirty(saved, current) {
  return JSON.stringify(toSavePayload({ ...saved, selected: null })) !== JSON.stringify(toSavePayload({ ...current, selected: null }))
}
