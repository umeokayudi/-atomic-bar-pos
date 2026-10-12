/**
 * Floor editor model: pure functions over { layout, sectors, tables } so the editor, undo and tests share them.
 * Space only: nothing here touches money. Saved with public.floor_save_layout (one transaction, version check).
 */

export const SHAPES = {
  round: { largura: 90, altura: 90, capacidade: 4 },
  square: { largura: 90, altura: 90, capacidade: 4 },
  rect: { largura: 160, altura: 90, capacidade: 6 },
  bar: { largura: 260, altura: 70, capacidade: 8 },
  sofa: { largura: 200, altura: 80, capacidade: 4 },
  wall: { largura: 300, altura: 16, capacidade: 0 },
  door: { largura: 90, altura: 16, capacidade: 0 },
  stage: { largura: 300, altura: 150, capacidade: 0 },
  plant: { largura: 50, altura: 50, capacidade: 0 },
  // Entertainment: no seats, no tab. Saved as forma 'stage' + nota "Fun: <kind>" (no migration needed).
  darts: { largura: 60, altura: 60, capacidade: 0 },
  pool: { largura: 230, altura: 130, capacidade: 0 },
  karaoke: { largura: 90, altura: 90, capacidade: 0 },
  tv: { largura: 140, altura: 20, capacidade: 0 },
  arcade: { largura: 70, altura: 70, capacidade: 0 },
  dj: { largura: 140, altura: 80, capacidade: 0 },
  game: { largura: 100, altura: 100, capacidade: 0 },
  dance: { largura: 250, altura: 250, capacidade: 0 },
}
export const FUN = new Set(['darts', 'pool', 'karaoke', 'tv', 'arcade', 'dj', 'game', 'dance'])
export const isFun = forma => FUN.has(forma)
/** Pieces of the room that are not tables: no tab, no seats, not counted in the service view. */
export const DECOR = new Set(['wall', 'door', 'stage', 'plant', ...FUN])
export const isDecor = forma => DECOR.has(forma)

const FUN_NOTE = /^Fun:\s*([a-z]+)\s*$/im

/** A floor_tables row as the app sees it: entertainment comes back as its own shape. */
export function fromDbTable(row) {
  const m = row?.forma === 'stage' && String(row?.nota || '').match(FUN_NOTE)
  return m && FUN.has(m[1]) ? { ...row, forma: m[1] } : row
}

/** forma + nota to store (the database only knows the original shapes). */
export function toDbShape(t) {
  if (isFun(t.forma)) return { forma: 'stage', nota: `Fun: ${t.forma}` }
  if (FUN_NOTE.test(String(t.nota || ''))) return { forma: t.forma, nota: null }
  return { forma: t.forma }
}
export const GRID = 10
export const MIN_SIZE = 10
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
  const seats = state.tables.filter(t => !isDecor(t.forma))
  const table = clampTable({
    id: tempId(), nome: nextTableName(seats), forma, ...dims, ...spot, rotacao: 0, cor: '', sector_id: null, ativo: true, ...extra,
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
      nome: String(t.nome || '').trim() || '?', ...toDbShape(t), x: Math.round(t.x), y: Math.round(t.y),
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
  const names = state.tables.filter(t => t.ativo !== false && !isDecor(t.forma)).map(t => String(t.nome || '').trim().toLowerCase())
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

export const FLOOR_SCALE_DEFAULTS = { pxPerM: 50, m2PerPerson: 1.5 }

/** Floor scale from pos_settings (floor_px_m: pixels per metre, floor_m2_pessoa: standing m² per guest). */
export function floorScale(settings = {}) {
  const px = +settings?.floor_px_m
  const m2 = +settings?.floor_m2_pessoa
  return {
    pxPerM: px >= 5 && px <= 500 ? px : FLOOR_SCALE_DEFAULTS.pxPerM,
    m2PerPerson: m2 >= 0.3 && m2 <= 10 ? m2 : FLOOR_SCALE_DEFAULTS.m2PerPerson,
  }
}

/**
 * Size and capacity of a layout: real size in metres, area, area taken by furniture, seats,
 * an estimate of standing guests on the free floor, and the entertainment pieces.
 */
export function floorMetrics(state, { pxPerM = 50, m2PerPerson = 1.5 } = {}) {
  const px2 = pxPerM * pxPerM
  const L = state?.layout || {}
  const live = (state?.tables || []).filter(t => t.ativo !== false)
  const areaM2 = (+L.largura * +L.altura) / px2 || 0
  const blocks = live.filter(t => t.forma !== 'wall' && t.forma !== 'door' && t.forma !== 'dance')
  const furnitureM2 = blocks.reduce((a, t) => a + (+t.largura * +t.altura) / px2, 0)
  const freeM2 = Math.max(0, areaM2 - furnitureM2)
  const tables = live.filter(t => !isDecor(t.forma))
  const seats = tables.reduce((a, t) => a + Math.max(0, +t.capacidade || 0), 0)
  const standing = m2PerPerson > 0 ? Math.floor(freeM2 / m2PerPerson) : 0
  const fun = {}
  for (const t of live) if (isFun(t.forma)) fun[t.forma] = (fun[t.forma] || 0) + 1
  const r1 = v => Math.round(v * 10) / 10
  return {
    widthM: r1(+L.largura / pxPerM || 0),
    heightM: r1(+L.altura / pxPerM || 0),
    areaM2: r1(areaM2),
    furnitureM2: r1(furnitureM2),
    freeM2: r1(freeM2),
    tables: tables.length,
    seats,
    standing,
    capacity: seats + standing,
    m2PerSeat: seats ? r1(areaM2 / seats) : 0,
    fun: Object.entries(fun).map(([kind, n]) => ({ kind, n })),
  }
}
