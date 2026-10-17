import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { SEAT, contentBounds, fitScale, guestSpots, hits, obstacles, pieceRects, safeWalks, seatSpots, standSpot, unitsPerCm, wallPieces } from '../../lib/floor3d'
import { isDecor } from '../../lib/floorEditor'

// Real heights in centimetres; the plan's own scale (units per cm, guessed from its tables) turns
// them into plan units, so walls, tables, seats and people keep their proportions on any plan.
const HEIGHT_CM = { round: 75, square: 75, rect: 75, bar: 105, sofa: 45, wall: 250, door: 2, stage: 25, plant: 90 }
const DECOR_COLOR = { wall: '#9a958c', door: '#b08a5a', stage: '#4a3f5c', plant: '#3f8a4f' }
const SEAT_CM = 45
// Height of a doorway (cm): the wall above it is drawn as a beam.
const DOOR_CM = 210
// Seen from above, walls are cut down to this share of their height so they do not hide the room;
// walking inside, they stand at full height.
const WALL_CUT = 0.55
// A decor piece gets its name written on it only when it is at least this wide (cm), so small
// fridges and posts do not crowd the view.
const DECOR_LABEL_CM = 90
const VIEWS = {
  persp: { tilt: 55, spin: -18 },
  front: { tilt: 68, spin: 0 },
  top: { tilt: 0, spin: 0 },
}
const ZOOM_MIN = 0.4
const ZOOM_MAX = 4
// A finger that moves less than this (screen px) between down and up is a tap, not a drag.
const TAP_SLOP = 8
// A tap that lands just outside a table still opens it when it is this close (screen px), so small
// tables on a phone get an effective target of about 44 px.
const TAP_REACH = 22
// Walk-inside view: eye height and body radius (cm), walking speed (cm per second), turn speed (deg/s).
const EYE_CM = 160
const BODY_CM = 25
const WALK_CM = 150
const TURN = 90

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const angle = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
const rad = d => (d * Math.PI) / 180

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(`f3.${key}`)
    return v == null ? fallback : JSON.parse(v)
  } catch { return fallback }
}
function writePref(key, value) {
  try { localStorage.setItem(`f3.${key}`, JSON.stringify(value)) } catch { /* private mode */ }
}

/** Centre of a table in plan units. */
const centerOf = tb => ({ x: +tb.x + (+tb.largura || 0) / 2, y: +tb.y + (+tb.altura || 0) / 2 })

/** A box with a top face and four sides, standing on the floor at (x, y). */
function Box({ w, d, h, round, className = '', style, children, top }) {
  return (
    <div className={`f3-box ${className}`} style={{ width: w, height: d, ...style }}>
      {round ? (
        [0.25, 0.5, 0.75].map(k => <div key={k} className="f3-layer" style={{ transform: `translateZ(${h * k}px)` }} />)
      ) : (
        <>
          <div className="f3-side is-s" style={{ width: w, height: h, top: d - h }} />
          <div className="f3-side is-n" style={{ width: w, height: h }} />
          <div className="f3-side is-w" style={{ width: h, height: d }} />
          <div className="f3-side is-e" style={{ width: h, height: d, left: w - h }} />
        </>
      )}
      <div className={`f3-top${round ? ' is-round' : ''}`} style={{ transform: `translateZ(${h}px)`, ...top }}>{children}</div>
    </div>
  )
}

/** One guest: stands at a seat, faces the camera, and now and then walks a short loop and comes back. */
function Guest({ g }) {
  return (
    <div className="f3-guest" style={{ left: g.x, top: g.y, '--wx': `${g.wx}px`, '--wy': `${g.wy}px`, '--dur': `${g.dur}s`, '--delay': `${g.delay}s` }}>
      <div className={`f3-guest-walk${g.roam ? ' is-roam' : ''}`}>
        <div className="f3-guest-bb" style={{ '--guest': g.color }}>
          <i className="f3-guest-head" />
          <b className="f3-guest-body" />
        </div>
      </div>
    </div>
  )
}

/**
 * The static part of the scene: floor, walls (with doorways cut out), tables, seats and guests. It does
 * not depend on the camera, so turning, tilting or zooming never re-renders it; guests face the viewer
 * through the `--f3-spin` custom property the camera writes on the world node. Names are drawn on a
 * flat layer over the stage (see `Floor3D`), not in the scene, so they stay sharp.
 */
const Scene = memo(function Scene({ area, tables, sectors, live, tappable, selectedId, k, walls, blocks }) {
  const sectorColor = id => sectors.find(s => s.id === id)?.cor
  const wallH = HEIGHT_CM.wall * k
  return (
    <>
      <div className="f3-floor" style={{ left: area.x, top: area.y, width: area.w, height: area.h, '--tile': `${Math.round(60 * k)}px` }} />
      {walls.length > 0 && <div className="f3-ceiling" style={{ left: area.x, top: area.y, width: area.w, height: area.h, transform: `translateZ(${wallH}px)` }} />}
      {walls.length === 0 && (
        <>
          <Box className="f3-wall is-cut" w={area.w} d={6} h={wallH} style={{ left: area.x, top: area.y - 6 }} />
          <Box className="f3-wall is-cut" w={6} d={area.h} h={wallH} style={{ left: area.x - 6, top: area.y }} />
        </>
      )}
      {walls.map(p => (
        <div key={p.id} className="f3-table is-wall is-decor" aria-hidden="true"
          style={{ left: p.x, top: p.y, width: p.w, height: p.h, transform: `rotateZ(${p.rot || 0}deg) scaleZ(var(--f3-wallk, 1))`, '--f3-color': p.cor || DECOR_COLOR.wall }}>
          <Box w={p.w} d={p.h} h={wallH} className="f3-surface" />
        </div>
      ))}
      {tables.map(tb => {
        if (tb.forma === 'wall') return null
        const w = +tb.largura
        const d = +tb.altura
        const h = Math.max(2, (HEIGHT_CM[tb.forma] || 75) * k)
        const decor = isDecor(tb.forma)
        const color = tb.cor || DECOR_COLOR[tb.forma] || sectorColor(tb.sector_id) || 'var(--c-accent)'
        const seats = decor || tb.forma === 'sofa' ? [] : seatSpots(tb.forma, w, d, tb.capacidade)
        const guests = live && !decor ? safeWalks(tb, guestSpots(tb, tb.pessoas), blocks, k) : []
        const round = tb.forma === 'round' || tb.forma === 'plant'
        const canTap = !decor && tappable
        const selected = !decor && String(tb.id) === selectedId
        return (
          <div
            key={tb.id}
            data-f3-id={canTap ? tb.id : undefined}
            data-f3-name={decor ? undefined : tb.id}
            data-f3-room={tb.forma === 'stage' && Math.min(w, d) >= DECOR_LABEL_CM * k * 0.5 && Math.max(w, d) >= DECOR_LABEL_CM * k ? tb.id : undefined}
            className={`f3-table is-${tb.forma}${decor ? ' is-decor' : ''}${live && !decor ? ` st-${tb.state}` : ''}${tb.ativo === false ? ' is-off' : ''}${canTap ? ' is-tappable' : ''}${selected ? ' is-selected' : ''}`}
            style={{ left: +tb.x, top: +tb.y, width: w, height: d, transform: `translateZ(var(--f3-lift, 0px)) rotateZ(${+tb.rotacao || 0}deg)`, '--f3-rot': +tb.rotacao || 0, ...(live && !decor ? null : { '--f3-color': color }) }}
          >
            {selected && <div className="f3-glow" />}
            {seats.map((s, i) => (
              <Box key={i} className="f3-seat" w={SEAT} d={SEAT} h={SEAT_CM * k} round={tb.forma === 'round'} style={{ left: s.x, top: s.y }} />
            ))}
            <Box w={w} d={d} h={h} round={round} className="f3-surface" />
            {tb.forma === 'door' && (
              // The top of the doorway: a beam over the gap at door height, so it reads as a door, not a wall.
              <div className="f3-lintel" style={{ transform: `translateZ(${DOOR_CM * k}px) scaleZ(var(--f3-wallk, 1))` }}>
                <Box w={w} d={d} h={wallH - DOOR_CM * k} className="f3-surface" />
              </div>
            )}
            {guests.map((g, i) => <Guest key={i} g={g} />)}
            {selected && (
              <div className="f3-pin" style={{ left: w / 2, top: d / 2, '--h': `${h + 30}px` }} aria-hidden="true">
                <div className="f3-pin-bb"><Icon name="downArrow" size={22} /></div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
})

/**
 * 3D view of a floor layout, drawn with CSS 3D transforms (no WebGL, no extra library).
 *
 * Map view: one finger (or the mouse) moves the map, or turns and tilts it in "Turn" mode; the right
 * mouse button or Shift does the other one. Two fingers pinch to zoom, move and twist. The wheel zooms.
 * "Crop" draws only the part of the room that has tables and frames it; the frame button fits it again.
 * A tap on a table (or a row in the side list) picks it: it rises, the camera centres on it and a
 * card shows what is going on there. With `confirm`, a second tap or the card's Open button calls
 * `onTable`; without it the first tap already does.
 *
 * Walk view (POV): the camera stands inside the room at eye height. Drag sideways to look around and
 * up or down to walk; the arrow pad, arrow keys or WASD do the same.
 *
 * `live` tables carry a service state and the number of guests on their open tabs; guests are drawn
 * at the table and now and then get up for a short walk.
 * The camera lives in refs and is written straight to the world node once per animation frame, so
 * moving it never re-renders React.
 */
export default function Floor3D({ layout, tables = [], sectors = [], onTable, live = false, confirm = live }) {
  const { t } = useI18n()
  const W = +layout.largura || 900
  const D = +layout.altura || 500
  // Plan units per centimetre; only the tables' sizes change it.
  const sizeKey = tables.map(tb => `${tb.forma}:${tb.largura}:${tb.altura}:${tb.capacidade}`).join('|')
  const k = useMemo(() => unitsPerCm(tables), [sizeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const kRef = useRef(k)
  kRef.current = k
  const [view, setView] = useState('persp')
  const [mode, setModeState] = useState('map')
  const [drag, setDragState] = useState(() => readPref('drag', 'move'))
  const [crop, setCropState] = useState(() => readPref('crop', true))
  // The editor has its own side panel, so the table list is a service-view thing.
  const [listPref, setShowListState] = useState(() => readPref('list', true))
  const showList = live && listPref
  const [selectedId, setSelectedId] = useState(null)

  const stageRef = useRef(null)
  const worldRef = useRef(null)
  const cam = useRef({ ...VIEWS.persp, zoom: 1, px: 0, py: 0, cx: W / 2, cy: D / 2 })
  const pov = useRef({ x: W / 2, y: D, yaw: 0, pitch: 0 })
  const fit = useRef(1)
  const persp = useRef(600)
  const frame = useRef(0)
  const pointers = useRef(new Map())
  const gesture = useRef(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const dragRef = useRef(drag)
  dragRef.current = drag
  const walking = useRef({ fwd: 0, turn: 0, last: 0, raf: 0 })

  const onTableRef = useRef(onTable)
  onTableRef.current = onTable
  const byId = useMemo(() => new Map(tables.map(tb => [String(tb.id), tb])), [tables])
  const byIdRef = useRef(byId)
  byIdRef.current = byId
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  // The tables' footprint only changes when the plan does, not on every live refresh.
  const geomKey = tables.map(tb => `${tb.id}:${tb.x}:${tb.y}:${tb.largura}:${tb.altura}:${tb.rotacao || 0}`).join('|')
  const bounds = useMemo(() => contentBounds(tables, W, D, 8), [geomKey, W, D]) // eslint-disable-line react-hooks/exhaustive-deps
  const area = useMemo(() => (crop ? bounds : { x: 0, y: 0, w: W, h: D }), [crop, bounds, W, D])
  const areaRef = useRef(area)
  areaRef.current = area
  // Walls with doorways cut out. The walker bumps into walls and counters; guests also keep off
  // sofas, rooms and the rest of the furniture that is not a table.
  const walls = useMemo(() => wallPieces(tables), [geomKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const solids = useMemo(() => {
    const wallR = pieceRects(walls)
    const pieces = tables.filter(tb => !['wall', 'door', 'round', 'square', 'rect'].includes(tb.forma))
    return { walk: [...wallR, ...obstacles(pieces.filter(tb => tb.forma === 'bar' || tb.forma === 'sofa'))], guests: [...wallR, ...obstacles(pieces)] }
  }, [walls, geomKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const wallsRef = useRef(solids.walk)
  wallsRef.current = solids.walk
  const overlayRef = useRef(null)
  const measureTimer = useRef(0)
  const measureRef = useRef(() => {})
  const [chips, setChips] = useState([])

  const setMode = m => setModeState(m)
  const setDrag = v => { setDragState(v); writePref('drag', v) }
  const setCrop = v => { setCropState(v); writePref('crop', v) }
  const setShowList = v => { setShowListState(v); writePref('list', v) }

  const apply = useCallback(() => {
    frame.current = 0
    const el = worldRef.current
    if (!el) return
    if (modeRef.current === 'pov') {
      const p = pov.current
      el.style.transform = `translateZ(${persp.current - 1}px) rotateX(${90 + p.pitch}deg) rotateZ(${p.yaw}deg) translate3d(${-p.x}px, ${-p.y}px, ${-EYE_CM * kRef.current}px)`
      el.style.setProperty('--f3-tilt', String(90 + p.pitch))
      el.style.setProperty('--f3-ls', '1')
      el.style.setProperty('--f3-wallk', '1')
    } else {
      const c = cam.current
      const s = fit.current * c.zoom
      el.style.transform = `translate3d(${c.px}px, ${c.py}px, 0) scale(${s}) rotateX(${c.tilt}deg) rotateZ(${c.spin}deg) translate3d(${-c.cx}px, ${-c.cy}px, 0)`
      // Labels keep a readable size on screen however far the camera is, and stand facing it.
      el.style.setProperty('--f3-tilt', String(Math.round(c.tilt)))
      el.style.setProperty('--f3-ls', String(clamp(1.15 / s, 0.8, 3).toFixed(2)))
      el.style.setProperty('--f3-wallk', String(WALL_CUT))
    }
    el.style.setProperty('--f3-u', String(kRef.current))
    // Names are placed once the camera stops (map moves ease for ~0.45 s); they hide while it moves.
    overlayRef.current?.classList.add('is-moving')
    clearTimeout(measureTimer.current)
    measureTimer.current = setTimeout(() => measureRef.current(), modeRef.current === 'pov' ? 60 : 500)
  }, [])
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }, [apply])
  // Labels and guests turn to face the viewer. Updated when the camera settles, not on every frame of a drag.
  const settleLabels = useCallback(() => {
    const spin = modeRef.current === 'pov' ? pov.current.yaw : cam.current.spin
    worldRef.current?.style.setProperty('--f3-spin', String(Math.round(spin * 10) / 10))
  }, [])

  /**
   * Where each table's name goes on screen: the centre of its top as drawn now. In the walk view only
   * what is ahead and not too far gets a name. Names are flat, upright HTML over the stage, so they stay
   * sharp and readable at any angle.
   */
  measureRef.current = () => {
    const st = stageRef.current
    if (!st) return
    const sr = st.getBoundingClientRect()
    const isPov = modeRef.current === 'pov'
    const p = pov.current
    const fx = -Math.sin(rad(p.yaw))
    const fy = -Math.cos(rad(p.yaw))
    const k0 = kRef.current
    const out = []
    for (const node of st.querySelectorAll('[data-f3-name], [data-f3-room]')) {
      const room = node.hasAttribute('data-f3-room')
      const id = node.getAttribute(room ? 'data-f3-room' : 'data-f3-name')
      const tb = byIdRef.current.get(String(id))
      if (!tb) continue
      if (isPov) {
        const c = centerOf(tb)
        const ahead = (c.x - p.x) * fx + (c.y - p.y) * fy
        const far = Math.hypot(c.x - p.x, c.y - p.y)
        if (ahead < 40 * k0 || far > (room ? 700 : 1400) * k0) continue
      }
      const top = node.querySelector(':scope > .f3-surface > .f3-top')
      if (!top) continue
      const r = top.getBoundingClientRect()
      const x = r.left + r.width / 2 - sr.left
      const y = r.top + r.height / 2 - sr.top
      if (x < 0 || y < 0 || x > sr.width || y > sr.height) continue
      const far = isPov ? Math.hypot(centerOf(tb).x - p.x, centerOf(tb).y - p.y) : 0
      out.push({ id: String(id), x: Math.round(x), y: Math.round(y), room, far, name: String(tb.nome || '') })
    }
    // Keep names from piling up: the picked table first, then tables (nearest first when walking),
    // then room names; a name that would cover one already placed is left out.
    const sel = selectedRef.current
    out.sort((a, b) => (b.id === sel) - (a.id === sel) || a.room - b.room || a.far - b.far)
    const placed = []
    const kept = []
    for (const c of out) {
      const w = c.room ? c.name.length * 6.5 + 14 : Math.max(64, c.name.length * 8 + 26)
      const h = c.room ? 18 : 36
      const box = c.room ? { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 } : { x0: c.x - w / 2, y0: c.y - h - 6, x1: c.x + w / 2, y1: c.y - 6 }
      if (placed.some(q => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0)) continue
      placed.push(box)
      kept.push(c)
    }
    kept.sort((a, b) => a.y - b.y)
    setChips(kept)
    overlayRef.current?.classList.remove('is-moving')
  }

  /** Fit the scale to the stage for the current view angle. */
  const refit = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    const a = areaRef.current
    const c = cam.current
    fit.current = fitScale(el.clientWidth, el.clientHeight, a.w, a.h, c.tilt, c.spin)
    persp.current = clamp(Math.round(el.clientWidth * 0.55), 320, 900)
  }, [])

  /** Centre the area, reset zoom and pan, fit it to the stage. */
  const frameArea = useCallback(() => {
    const a = areaRef.current
    Object.assign(cam.current, { zoom: 1, px: 0, py: 0, cx: a.x + a.w / 2, cy: a.y + a.h / 2 })
    refit()
    schedule()
  }, [refit, schedule])

  useEffect(() => () => {
    clearTimeout(measureTimer.current)
    cancelAnimationFrame(frame.current)
    cancelAnimationFrame(walking.current.raf)
  }, [])

  // First paint already has the camera framed on the area, no jump. Re-frame when the area changes.
  useLayoutEffect(() => {
    frameArea()
    apply()
    settleLabels()
  }, [area, frameArea, apply, settleLabels])

  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { refit(); schedule() })
    ro.observe(el)
    return () => ro.disconnect()
  }, [refit, schedule])

  // Mode switches re-place the camera.
  useLayoutEffect(() => {
    apply()
    settleLabels()
  }, [mode, apply, settleLabels])

  // Drop a selection whose table went away.
  useEffect(() => {
    if (selectedId && !byId.has(selectedId)) setSelectedId(null)
  }, [byId, selectedId])

  /** Keep the walker inside the room. */
  const clampPov = () => {
    const p = pov.current
    p.x = clamp(p.x, 0, W)
    p.y = clamp(p.y, 0, D)
  }
  /** Walk, sliding along walls instead of going through them. */
  const walkBy = (fwd, strafe = 0) => {
    const p = pov.current
    const a = rad(p.yaw)
    // Forward is plan -y turned by the yaw; right is plan +x turned by the yaw.
    const dx = -Math.sin(a) * fwd + Math.cos(a) * strafe
    const dy = -Math.cos(a) * fwd - Math.sin(a) * strafe
    const r = BODY_CM * kRef.current
    const solid = wallsRef.current
    if (hits(solid, p.x, p.y, r)) { p.x += dx; p.y += dy } // already inside one: let them walk out
    else if (!hits(solid, p.x + dx, p.y + dy, r)) { p.x += dx; p.y += dy }
    else if (!hits(solid, p.x + dx, p.y, r)) p.x += dx
    else if (!hits(solid, p.x, p.y + dy, r)) p.y += dy
    clampPov()
  }

  // Wheel / trackpad zoom (walks in POV). Native listeners so they can call preventDefault.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const wheel = e => {
      e.preventDefault()
      if (modeRef.current === 'pov') {
        walkBy(-e.deltaY * 0.6 * kRef.current)
        schedule()
        return
      }
      const c = cam.current
      c.zoom = clamp(c.zoom * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX)
      schedule()
    }
    // Taps are resolved from pointer events. Cancel the click the browser would synthesise after a
    // touch, or it would land on whatever just opened under the finger (e.g. a drawer's scrim on iPad).
    const touchEnd = e => { if (e.cancelable) e.preventDefault() }
    const menu = e => e.preventDefault()
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('touchend', touchEnd, { passive: false })
    el.addEventListener('contextmenu', menu)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('touchend', touchEnd)
      el.removeEventListener('contextmenu', menu)
    }
  }, [schedule]) // eslint-disable-line react-hooks/exhaustive-deps

  // Held walk buttons and keys: move every frame while held.
  const walkLoop = useCallback(ts => {
    const w = walking.current
    const dt = w.last ? Math.min(0.05, (ts - w.last) / 1000) : 0
    w.last = ts
    if (!w.fwd && !w.turn) { w.raf = 0; w.last = 0; settleLabels(); return }
    pov.current.yaw += w.turn * TURN * dt
    walkBy(w.fwd * WALK_CM * kRef.current * dt)
    apply()
    w.raf = requestAnimationFrame(walkLoop)
  }, [apply, settleLabels]) // eslint-disable-line react-hooks/exhaustive-deps
  const hold = useCallback((fwd, turn) => {
    const w = walking.current
    w.fwd = fwd
    w.turn = turn
    if ((fwd || turn) && !w.raf) w.raf = requestAnimationFrame(walkLoop)
  }, [walkLoop])

  useEffect(() => {
    if (mode !== 'pov') return undefined
    const keys = new Set()
    const sync = () => {
      const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0)
      // A positive yaw turns the walker left.
      const r = (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0)
      hold(f, r)
    }
    const isField = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable
    const onDown = e => {
      const k = e.key.toLowerCase()
      if (isField(e) || !['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return
      e.preventDefault()
      keys.add(k)
      sync()
    }
    const onUp = e => { keys.delete(e.key.toLowerCase()); sync() }
    const onBlur = () => { keys.clear(); sync() }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      hold(0, 0)
    }
  }, [mode, hold])

  function startDrag() {
    const el = stageRef.current
    if (!el || el.classList.contains('is-dragging')) return
    el.classList.add('is-dragging')
    if (modeRef.current === 'map') setView(null)
  }

  /** (Re)start the gesture from the pointers that are down now. */
  function begin(moved, target = null, alt = false) {
    const pts = [...pointers.current.values()]
    const c = cam.current
    const p = pov.current
    if (pts.length >= 2) {
      gesture.current = {
        kind: 'pinch', moved: true, d: Math.max(1, dist(pts[0], pts[1])), m: mid(pts[0], pts[1]), a: angle(pts[0], pts[1]),
        zoom: c.zoom, px: c.px, py: c.py, spin: c.spin, pos: { x: p.x, y: p.y },
      }
    } else if (pts.length === 1) {
      const turn = alt ? dragRef.current !== 'turn' : dragRef.current === 'turn'
      gesture.current = {
        kind: modeRef.current === 'pov' ? 'look' : turn ? 'turn' : 'pan',
        moved, target, x: pts[0].x, y: pts[0].y, spin: c.spin, tilt: c.tilt, px: c.px, py: c.py, yaw: p.yaw, pos: { x: p.x, y: p.y },
      }
    } else {
      gesture.current = null
    }
  }

  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    if (pointers.current.size === 1) {
      begin(false, e.target.closest?.('[data-f3-id]')?.getAttribute('data-f3-id') ?? null, e.button === 2 || e.shiftKey)
    } else {
      begin(true)
      startDrag()
    }
  }

  function move(e) {
    const pt = pointers.current.get(e.pointerId)
    const g = gesture.current
    if (!pt || !g) return
    pt.x = e.clientX
    pt.y = e.clientY
    const c = cam.current
    const p = pov.current
    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()]
      if (pts.length < 2) return
      const m = mid(pts[0], pts[1])
      if (modeRef.current === 'pov') {
        p.x = g.pos.x
        p.y = g.pos.y
        walkBy((dist(pts[0], pts[1]) - g.d) * 2.5 * kRef.current)
      } else {
        c.zoom = clamp((g.zoom * dist(pts[0], pts[1])) / g.d, ZOOM_MIN, ZOOM_MAX)
        c.px = g.px + m.x - g.m.x
        c.py = g.py + m.y - g.m.y
        c.spin = g.spin + (angle(pts[0], pts[1]) - g.a)
      }
    } else {
      const dx = pt.x - g.x
      const dy = pt.y - g.y
      if (!g.moved) {
        if (Math.hypot(dx, dy) < TAP_SLOP) return
        g.moved = true
        startDrag()
      }
      if (g.kind === 'look') {
        p.yaw = g.yaw + dx * 0.3 // drag the room: pulling it right turns you left
        p.x = g.pos.x
        p.y = g.pos.y
        walkBy(dy * 2 * kRef.current)
      } else if (g.kind === 'turn') {
        c.spin = g.spin + dx * 0.4
        c.tilt = clamp(g.tilt - dy * 0.3, 0, 80)
      } else {
        c.px = g.px + dx
        c.py = g.py + dy
      }
    }
    schedule()
  }

  function up(e) {
    if (!pointers.current.has(e.pointerId)) return
    const g = gesture.current
    const wasTap = e.type === 'pointerup' && g && g.kind !== 'pinch' && !g.moved && pointers.current.size === 1
    const at = { x: e.clientX, y: e.clientY }
    pointers.current.delete(e.pointerId)
    if (pointers.current.size) {
      begin(true) // a finger is still down after a pinch: keep going from here, never a tap
      return
    }
    gesture.current = null
    stageRef.current?.classList.remove('is-dragging')
    settleLabels()
    if (wasTap) tap(g.target, at)
  }

  /** Centre the map camera on a table and come a little closer. */
  const flyTo = useCallback(tb => {
    if (modeRef.current !== 'map') return
    const c = centerOf(tb)
    Object.assign(cam.current, { cx: c.x, cy: c.y, px: 0, py: 0, zoom: Math.max(cam.current.zoom, 1.35) })
    schedule()
  }, [schedule])

  const pick = useCallback((tb, { fly = true } = {}) => {
    const id = String(tb.id)
    setSelectedId(id)
    if (fly) flyTo(tb)
  }, [flyTo])

  function tap(id, at) {
    let hit = id
    if (!hit) {
      // Forgiving hit test: the nearest table top within reach of the finger.
      let best = TAP_REACH
      for (const node of stageRef.current?.querySelectorAll('[data-f3-id]') || []) {
        const r = (node.querySelector('.f3-surface > .f3-top') || node).getBoundingClientRect()
        const d = Math.hypot(Math.max(r.left - at.x, 0, at.x - r.right), Math.max(r.top - at.y, 0, at.y - r.bottom))
        if (d < best) { best = d; hit = node.getAttribute('data-f3-id') }
      }
    }
    const tb = hit != null && byIdRef.current.get(String(hit))
    if (!tb) { setSelectedId(null); return }
    if (!confirm || selectedRef.current === String(tb.id)) {
      setSelectedId(String(tb.id))
      onTableRef.current?.(tb)
      return
    }
    pick(tb, { fly: modeRef.current === 'map' })
  }

  function preset(patch, key = null) {
    Object.assign(cam.current, patch)
    setView(key)
    schedule()
    settleLabels()
  }
  const turn = deg => preset({ spin: cam.current.spin + deg })
  const zoomBy = dz => preset({ zoom: clamp(+(cam.current.zoom * (1 + dz)).toFixed(2), ZOOM_MIN, ZOOM_MAX) }, view)
  const reframe = () => {
    Object.assign(cam.current, VIEWS[view || 'persp'])
    setView(view || 'persp')
    frameArea()
    settleLabels()
  }

  /** Stand somewhere sensible: in front of a table looking at it, or at the door, or at the front of the room. */
  function enterPov(tb = null) {
    const a = areaRef.current
    const p = pov.current
    const target = tb || (selectedRef.current && byIdRef.current.get(selectedRef.current))
    if (target) {
      const c = centerOf(target)
      const back = Math.max(+target.largura || 0, +target.altura || 0) / 2 + 150 * kRef.current
      // Stand a step back from the table on the first side that is not a wall, and look at it.
      const r = BODY_CM * kRef.current
      const sides = [[0, 1, 0], [0, -1, 180], [1, 0, 90], [-1, 0, -90]]
      const free = sides.find(([sx, sy]) => !hits(wallsRef.current, c.x + sx * back, c.y + sy * back, r)) || sides[0]
      Object.assign(p, { x: c.x + free[0] * back, y: c.y + free[1] * back, yaw: free[2], pitch: -14 })
    } else {
      // Inside the room, on the open spot with the most space, looking at the tables.
      const s = standSpot(tables, a, kRef.current)
      Object.assign(p, { x: s.x, y: s.y, yaw: s.yaw, pitch: -8 })
    }
    clampPov()
    refit()
    setMode('pov')
  }
  function exitPov() {
    hold(0, 0)
    setMode('map')
  }

  const tappable = !!onTable
  const scene = useMemo(
    () => <Scene area={area} tables={tables} sectors={sectors} live={live} tappable={tappable} selectedId={selectedId} k={k} walls={walls} blocks={solids.guests} />,
    [area, tables, sectors, live, tappable, selectedId, k, walls, solids],
  )
  // A new scene (live refresh, picked table rising) moves the names too.
  useEffect(() => {
    clearTimeout(measureTimer.current)
    measureTimer.current = setTimeout(() => measureRef.current(), 420)
  }, [scene])

  const selected = selectedId ? byId.get(selectedId) : null
  const listed = useMemo(
    () => tables.filter(tb => !isDecor(tb.forma) && tb.ativo !== false)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), undefined, { numeric: true })),
    [tables],
  )
  const guestsTotal = live ? listed.reduce((n, tb) => n + (+tb.pessoas || 0), 0) : 0

  const holdProps = (fwd, trn) => ({
    onPointerDown: e => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* gone */ } hold(fwd, trn) },
    onPointerUp: () => hold(0, 0),
    onPointerCancel: () => hold(0, 0),
    onLostPointerCapture: () => hold(0, 0),
    onContextMenu: e => e.preventDefault(),
  })

  return (
    <div className={`f3${showList ? ' has-list' : ''}`}>
      <div className="f3-tools" role="group" aria-label={t('floor.view3d')}>
        {mode === 'map' ? (
          <>
            <div className="ui-seg" role="radiogroup" aria-label={t('floor.dragMode')}>
              <button type="button" role="radio" aria-checked={drag === 'move'} onClick={() => setDrag('move')}><Icon name="move" size={14} />{t('floor.dragMove')}</button>
              <button type="button" role="radio" aria-checked={drag === 'turn'} onClick={() => setDrag('turn')}><Icon name="rotate3d" size={14} />{t('floor.dragTurn')}</button>
            </div>
            <div className="ui-seg" role="radiogroup" aria-label={t('floor.camera')}>
              {Object.keys(VIEWS).map(k => (
                <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => { preset({ ...VIEWS[k] }, k); refit(); schedule() }}>
                  {t(`floor.cam.${k}`)}
                </button>
              ))}
            </div>
            <span className="ui-spacer" />
            <button type="button" className="ui-btn is-icon is-sm f3-turnbtn" onClick={() => turn(-45)} aria-label={t('floor.turnLeft')} title={t('floor.turnLeft')}><Icon name="undo" size={16} /></button>
            <button type="button" className="ui-btn is-icon is-sm f3-turnbtn" onClick={() => turn(45)} aria-label={t('floor.turnRight')} title={t('floor.turnRight')}><Icon name="reopen" size={16} /></button>
            <button type="button" className="ui-btn is-icon is-sm" onClick={() => zoomBy(-0.2)} aria-label={t('floor.zoomOut')} title={t('floor.zoomOut')}><Icon name="zoomOut" size={16} /></button>
            <button type="button" className="ui-btn is-icon is-sm" onClick={() => zoomBy(0.2)} aria-label={t('floor.zoomIn')} title={t('floor.zoomIn')}><Icon name="zoomIn" size={16} /></button>
            <button type="button" className="ui-btn is-icon is-sm" onClick={reframe} aria-label={t('floor.resetView')} title={t('floor.resetView')}><Icon name="fit" size={16} /></button>
            <button type="button" className="ui-btn is-sm f3-toggle" aria-pressed={crop} onClick={() => setCrop(!crop)} title={t('floor.cropHint')} aria-label={t('floor.crop')}><Icon name="crop" size={15} /><span className="f3-tlabel">{t('floor.crop')}</span></button>
            <button type="button" className="ui-btn is-sm f3-toggle" onClick={() => enterPov()} title={t('floor.povHint')} aria-label={t('floor.pov')}><Icon name="pov" size={15} /><span className="f3-tlabel">{t('floor.pov')}</span></button>
          </>
        ) : (
          <>
            <button type="button" className="ui-btn is-sm is-primary" onClick={exitPov}><Icon name="map" size={15} />{t('floor.povExit')}</button>
            <span className="ui-muted f3-povnote">{t('floor.povHint')}</span>
            <span className="ui-spacer" />
          </>
        )}
        {live && (
          <button type="button" className="ui-btn is-sm f3-toggle" aria-pressed={showList} onClick={() => setShowList(!showList)} aria-label={t('floor.tableList')}><Icon name="list" size={15} /><span className="f3-tlabel">{t('floor.tableList')}</span></button>
        )}
      </div>

      <div className="f3-body">
        <div className={`f3-view${mode === 'pov' ? ' is-pov' : ''}`}>
          <div
            ref={stageRef}
            className={`f3-stage${mode === 'pov' ? ' is-pov' : ''}`}
            style={mode === 'pov' ? { perspective: `${persp.current}px` } : undefined}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onLostPointerCapture={up}
            aria-label={mode === 'pov' ? t('floor.povHint') : t('floor.view3dHint')}
          >
            <div ref={worldRef} className="f3-world">
              {scene}
            </div>
          </div>

          <div ref={overlayRef} className="f3-names">
            {chips.map(c => {
              const tb = byId.get(c.id)
              if (!tb) return null
              if (c.room) return <span key={c.id} className="f3-room" style={{ left: c.x, top: c.y }} aria-hidden="true">{tb.nome}</span>
              const label = live ? `${tb.nome}: ${t(`tabs.state.${tb.state}`)}${tb.open?.length ? `, ${fmtYen(tb.money.total)}` : ''}` : t('floor.tableAria', { name: tb.nome, n: tb.capacidade })
              return (
                <button
                  key={c.id} type="button"
                  className={`f3-name${live ? ` st-${tb.state}` : ''}${c.id === selectedId ? ' is-on' : ''}`}
                  style={{ left: c.x, top: c.y, ...(live ? null : { '--st': tb.cor || sectors.find(x => x.id === tb.sector_id)?.cor || 'var(--c-accent)' }) }}
                  onClick={() => tap(c.id, null)}
                  disabled={!onTable}
                  aria-label={label}
                >
                  <strong>{tb.nome}</strong>
                  <small>{live ? `${t(`tabs.state.${tb.state}`)}${tb.open?.length ? ` · ${fmtYen(tb.money.total)}` : ''}` : t('tabs.people', { n: tb.capacidade })}</small>
                </button>
              )
            })}
          </div>

          {live && guestsTotal > 0 && (
            <div className="f3-badge" aria-live="polite"><Icon name="people" size={13} /> {t('floor.guestsNow', { n: guestsTotal })}</div>
          )}

          {selected && (
            <div className={`f3-card${live ? ` st-${selected.state}` : ''}`} role="status">
              <div className="f3-card-main">
                <strong>{selected.nome}</strong>
                <small>
                  {live ? t(`tabs.state.${selected.state}`) : t('tabs.people', { n: selected.capacidade })}
                  {live && (+selected.pessoas > 0) ? ` · ${t('floor.guestsAt', { n: selected.pessoas, cap: selected.capacidade || '–' })}` : ''}
                  {live && selected.open?.length ? ` · ${fmtYen(selected.money.total)}` : ''}
                </small>
              </div>
              <div className="f3-card-actions">
                {mode === 'map' && (
                  <button type="button" className="ui-btn is-sm is-icon" onClick={() => enterPov(selected)} aria-label={t('floor.viewFrom')} title={t('floor.viewFrom')}><Icon name="pov" size={16} /></button>
                )}
                {onTable && <button type="button" className="ui-btn is-sm is-primary" onClick={() => onTableRef.current?.(selected)}>{t('floor.openSel')}</button>}
                <button type="button" className="ui-btn is-sm is-icon" onClick={() => setSelectedId(null)} aria-label={t('common.close')}><Icon name="close" size={16} /></button>
              </div>
            </div>
          )}

          {mode === 'pov' && (
            <div className="f3-pad" aria-label={t('floor.povPad')} role="group">
              <span />
              <button type="button" className="ui-btn is-icon" aria-label={t('floor.walkFwd')} {...holdProps(1, 0)}><Icon name="up" size={18} /></button>
              <span />
              <button type="button" className="ui-btn is-icon" aria-label={t('floor.lookLeft')} {...holdProps(0, 1)}><Icon name="back" size={18} /></button>
              <button type="button" className="ui-btn is-icon" aria-label={t('floor.walkBack')} {...holdProps(-1, 0)}><Icon name="downArrow" size={18} /></button>
              <button type="button" className="ui-btn is-icon" aria-label={t('floor.lookRight')} {...holdProps(0, -1)}><Icon name="next" size={18} /></button>
            </div>
          )}
        </div>

        {showList && (
          <aside className="f3-list" aria-label={t('floor.tableList')}>
            <ul>
              {listed.map(tb => {
                const on = String(tb.id) === selectedId
                return (
                  <li key={tb.id}>
                    <button
                      type="button"
                      className={`f3-row${live ? ` st-${tb.state}` : ''}${on ? ' is-on' : ''}`}
                      style={live ? undefined : { '--st': tb.cor || sectors.find(s => s.id === tb.sector_id)?.cor || 'var(--c-accent)' }}
                      aria-pressed={on}
                      onClick={() => {
                        if (on && confirm) onTableRef.current?.(tb)
                        else if (!confirm) { pick(tb); onTableRef.current?.(tb) }
                        else pick(tb)
                      }}
                    >
                      <i className="f3-dot" />
                      <span className="f3-row-name">{tb.nome}</span>
                      <span className="f3-row-sub">
                        {live ? t(`tabs.state.${tb.state}`) : t('tabs.people', { n: tb.capacidade })}
                        {live && +tb.pessoas > 0 && <> · <Icon name="people" size={11} /> {tb.pessoas}</>}
                      </span>
                      {live && tb.open?.length > 0 && <span className="f3-row-money num">{fmtYen(tb.money.total)}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>
        )}
      </div>
      <p className="desk-note f3-hint"><Icon name="move" size={13} /> {mode === 'pov' ? t('floor.povHint') : t(confirm ? 'floor.view3dHintPick' : 'floor.view3dHint')}</p>
    </div>
  )
}
