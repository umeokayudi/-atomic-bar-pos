import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { SEAT, seatSpots } from '../../lib/floor3d'
import { isDecor } from '../../lib/floorEditor'

// Heights in plan units (the plan is roughly 1 unit = 1 cm).
const TABLE_H = { round: 34, square: 34, rect: 34, bar: 52, sofa: 26, wall: 120, door: 3, stage: 22, plant: 70 }
const DECOR_COLOR = { wall: '#9a958c', door: '#b08a5a', stage: '#4a3f5c', plant: '#3f8a4f' }
const SEAT_H = 22
const WALL_H = 46
const VIEWS = {
  persp: { tilt: 55, spin: -18 },
  front: { tilt: 68, spin: 0 },
  top: { tilt: 0, spin: 0 },
}
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
// A finger that moves less than this (screen px) between down and up is a tap, not a drag.
const TAP_SLOP = 8
// A tap that lands just outside a table still opens it when it is this close (screen px), so small
// tables on a phone get an effective target of about 44 px.
const TAP_REACH = 22

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

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

/**
 * The static part of the scene: walls, tables, seats and labels. It does not depend on the camera,
 * so turning, tilting or zooming never re-renders it; labels face the viewer through the
 * `--f3-spin` custom property the camera writes on the world node.
 */
const Scene = memo(function Scene({ W, D, tables, sectors, live, tappable, onKeyOpen, t }) {
  const sectorColor = id => sectors.find(s => s.id === id)?.cor
  return (
    <>
      <div className="f3-floor" />
      <Box className="f3-wall" w={W} d={6} h={WALL_H} style={{ left: 0, top: -6 }} />
      <Box className="f3-wall" w={6} d={D} h={WALL_H} style={{ left: -6, top: 0 }} />
      <Box className="f3-wall is-low" w={6} d={D} h={WALL_H / 3} style={{ left: W, top: 0 }} />
      {tables.map(tb => {
        const w = +tb.largura
        const d = +tb.altura
        const h = TABLE_H[tb.forma] || 34
        const decor = isDecor(tb.forma)
        const color = tb.cor || DECOR_COLOR[tb.forma] || sectorColor(tb.sector_id) || 'var(--c-accent)'
        const seats = decor || tb.forma === 'sofa' ? [] : seatSpots(tb.forma, w, d, tb.capacidade)
        const round = tb.forma === 'round' || tb.forma === 'plant'
        const label = live ? `${tb.nome}: ${t(`tabs.state.${tb.state}`)}${tb.open?.length ? `, ${fmtYen(tb.money.total)}` : ''}` : t('floor.tableAria', { name: tb.nome, n: tb.capacidade })
        const canTap = !decor && tappable
        return (
          <div
            key={tb.id}
            data-f3-id={canTap ? tb.id : undefined}
            className={`f3-table is-${tb.forma}${decor ? ' is-decor' : ''}${live && !decor ? ` st-${tb.state}` : ''}${tb.ativo === false ? ' is-off' : ''}${canTap ? ' is-tappable' : ''}`}
            style={{ left: +tb.x, top: +tb.y, width: w, height: d, transform: tb.rotacao ? `rotateZ(${tb.rotacao}deg)` : undefined, '--f3-rot': +tb.rotacao || 0, ...(live && !decor ? null : { '--f3-color': color }) }}
          >
            {seats.map((s, i) => (
              <Box key={i} className="f3-seat" w={SEAT} d={SEAT} h={SEAT_H} round={tb.forma === 'round'} style={{ left: s.x, top: s.y }} />
            ))}
            <Box w={w} d={d} h={h} round={round} className="f3-surface">
              {decor ? (tb.forma === 'stage' && <span className="f3-label is-static"><strong>{tb.nome}</strong></span>) : (
                <button
                  type="button"
                  className="f3-label"
                  // Pointer taps are resolved by the stage (tap vs drag); this only answers keyboard activation.
                  onClick={e => { if (e.detail === 0) onKeyOpen(tb.id) }}
                  disabled={!tappable}
                  aria-label={label}
                >
                  <strong>{tb.nome}</strong>
                  {live ? <small>{t(`tabs.state.${tb.state}`)}{tb.open?.length ? ` · ${fmtYen(tb.money.total)}` : ''}</small> : <small>{t('tabs.people', { n: tb.capacidade })}</small>}
                </button>
              )}
            </Box>
          </div>
        )
      })}
    </>
  )
})

/**
 * 3D view of a floor layout, drawn with CSS 3D transforms (no WebGL, no extra library).
 * One finger (or the mouse) drags to turn and tilt, two fingers pinch to zoom and move, the wheel
 * zooms, buttons give preset views. The camera lives in a ref and is written straight to the world
 * node's transform once per animation frame, so moving it never re-renders React.
 * Tables keep their real size, position, rotation and seats. `live` tables carry a service state;
 * a tap on a table (a press that moved less than TAP_SLOP) calls `onTable`.
 */
export default function Floor3D({ layout, tables = [], sectors = [], onTable, live = false }) {
  const { t } = useI18n()
  const W = +layout.largura || 900
  const D = +layout.altura || 500
  const [view, setView] = useState('persp')

  const stageRef = useRef(null)
  const worldRef = useRef(null)
  const cam = useRef({ ...VIEWS.persp, zoom: 1, px: 0, py: 0 })
  const fit = useRef(1)
  const frame = useRef(0)
  const pointers = useRef(new Map())
  const gesture = useRef(null)

  const onTableRef = useRef(onTable)
  onTableRef.current = onTable
  const byId = useMemo(() => new Map(tables.map(tb => [String(tb.id), tb])), [tables])
  const byIdRef = useRef(byId)
  byIdRef.current = byId

  const apply = useCallback(() => {
    frame.current = 0
    const el = worldRef.current
    if (!el) return
    const c = cam.current
    el.style.transform = `translate3d(${c.px}px, ${c.py}px, 0) scale(${fit.current * c.zoom}) rotateX(${c.tilt}deg) rotateZ(${c.spin}deg)`
  }, [])
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }, [apply])
  // Labels turn to face the viewer. Updated when the camera settles, not on every frame of a drag.
  const settleLabels = useCallback(() => {
    worldRef.current?.style.setProperty('--f3-spin', String(cam.current.spin))
  }, [])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const measure = () => {
      fit.current = clamp((el.clientWidth - 32) / (Math.max(W, D) * 1.05), 0.25, 1.4)
      schedule()
    }
    fit.current = clamp((el.clientWidth - 32) / (Math.max(W, D) * 1.05), 0.25, 1.4)
    apply() // first paint already has the camera, no jump
    settleLabels()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [W, D, apply, schedule, settleLabels])

  // Wheel / trackpad zoom. Native listeners so they can call preventDefault.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const wheel = e => {
      e.preventDefault()
      const c = cam.current
      c.zoom = clamp(c.zoom * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX)
      schedule()
    }
    // Taps are resolved from pointer events. Cancel the click the browser would synthesise after a
    // touch, or it would land on whatever just opened under the finger (e.g. a drawer's scrim on iPad).
    const touchEnd = e => { if (e.cancelable) e.preventDefault() }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('touchend', touchEnd, { passive: false })
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('touchend', touchEnd)
    }
  }, [schedule])

  function startDrag() {
    const el = stageRef.current
    if (!el || el.classList.contains('is-dragging')) return
    el.classList.add('is-dragging')
    setView(null)
  }

  /** (Re)start the gesture from the pointers that are down now. */
  function begin(moved, target = null) {
    const pts = [...pointers.current.values()]
    const c = cam.current
    if (pts.length >= 2) {
      gesture.current = { kind: 'pinch', moved: true, d: Math.max(1, dist(pts[0], pts[1])), m: mid(pts[0], pts[1]), zoom: c.zoom, px: c.px, py: c.py }
    } else if (pts.length === 1) {
      gesture.current = { kind: 'turn', moved, target, x: pts[0].x, y: pts[0].y, spin: c.spin, tilt: c.tilt }
    } else {
      gesture.current = null
    }
  }

  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    if (pointers.current.size === 1) {
      begin(false, e.target.closest?.('[data-f3-id]')?.getAttribute('data-f3-id') ?? null)
    } else {
      begin(true)
      startDrag()
    }
  }

  function move(e) {
    const p = pointers.current.get(e.pointerId)
    const g = gesture.current
    if (!p || !g) return
    p.x = e.clientX
    p.y = e.clientY
    const c = cam.current
    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()]
      if (pts.length < 2) return
      const m = mid(pts[0], pts[1])
      c.zoom = clamp((g.zoom * dist(pts[0], pts[1])) / g.d, ZOOM_MIN, ZOOM_MAX)
      c.px = g.px + m.x - g.m.x
      c.py = g.py + m.y - g.m.y
    } else {
      const dx = p.x - g.x
      const dy = p.y - g.y
      if (!g.moved) {
        if (Math.hypot(dx, dy) < TAP_SLOP) return
        g.moved = true
        startDrag()
      }
      c.spin = g.spin + dx * 0.4
      c.tilt = clamp(g.tilt - dy * 0.3, 0, 80)
    }
    schedule()
  }

  function up(e) {
    if (!pointers.current.has(e.pointerId)) return
    const g = gesture.current
    const wasTap = e.type === 'pointerup' && g?.kind === 'turn' && !g.moved && pointers.current.size === 1
    const at = { x: e.clientX, y: e.clientY }
    pointers.current.delete(e.pointerId)
    if (pointers.current.size) {
      begin(true) // a finger is still down after a pinch: keep turning from here, never a tap
      return
    }
    gesture.current = null
    stageRef.current?.classList.remove('is-dragging')
    settleLabels()
    if (wasTap) tap(g.target, at)
  }

  function tap(id, at) {
    const open = onTableRef.current
    if (!open) return
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
    const tb = hit != null && byIdRef.current.get(hit)
    if (tb) open(tb)
  }

  const onKeyOpen = useCallback(id => {
    const tb = byIdRef.current.get(String(id))
    if (tb) onTableRef.current?.(tb)
  }, [])

  function preset(patch, key = null) {
    Object.assign(cam.current, patch)
    setView(key)
    schedule()
    settleLabels()
  }
  const turn = deg => preset({ spin: cam.current.spin + deg })
  const zoomBy = dz => preset({ zoom: clamp(+(cam.current.zoom + dz).toFixed(2), ZOOM_MIN, ZOOM_MAX) }, view)
  const reset = () => preset({ ...VIEWS.persp, zoom: 1, px: 0, py: 0 }, 'persp')

  const tappable = !!onTable
  const scene = useMemo(
    () => <Scene W={W} D={D} tables={tables} sectors={sectors} live={live} tappable={tappable} onKeyOpen={onKeyOpen} t={t} />,
    [W, D, tables, sectors, live, tappable, onKeyOpen, t],
  )

  return (
    <div className="f3">
      <div className="f3-tools" role="group" aria-label={t('floor.view3d')}>
        <div className="ui-seg" role="radiogroup" aria-label={t('floor.camera')}>
          {Object.keys(VIEWS).map(k => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => preset({ ...VIEWS[k] }, k)}>
              {t(`floor.cam.${k}`)}
            </button>
          ))}
        </div>
        <span className="ui-spacer" />
        <button type="button" className="ui-btn is-icon is-sm" onClick={() => turn(-45)} aria-label={t('floor.turnLeft')}><Icon name="undo" size={16} /></button>
        <button type="button" className="ui-btn is-icon is-sm" onClick={() => turn(45)} aria-label={t('floor.turnRight')}><Icon name="reopen" size={16} /></button>
        <button type="button" className="ui-btn is-icon is-sm" onClick={reset} aria-label={t('floor.resetView')} title={t('floor.resetView')}><Icon name="fit" size={16} /></button>
        <button type="button" className="ui-btn is-icon is-sm" onClick={() => zoomBy(-0.15)} aria-label={t('floor.zoomOut')}><Icon name="zoomOut" size={16} /></button>
        <button type="button" className="ui-btn is-icon is-sm" onClick={() => zoomBy(0.15)} aria-label={t('floor.zoomIn')}><Icon name="zoomIn" size={16} /></button>
      </div>

      <div
        ref={stageRef}
        className="f3-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        aria-label={t('floor.view3dHint')}
      >
        <div ref={worldRef} className="f3-world" style={{ width: W, height: D, marginLeft: -W / 2, marginTop: -D / 2 }}>
          {scene}
        </div>
      </div>
      <p className="desk-note f3-hint"><Icon name="move" size={13} /> {t('floor.view3dHint')}</p>
    </div>
  )
}
