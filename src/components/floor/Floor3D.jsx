import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { SEAT, seatSpots } from '../../lib/floor3d'

// Heights in plan units (the plan is roughly 1 unit = 1 cm).
const TABLE_H = { round: 34, square: 34, rect: 34, bar: 52 }
const SEAT_H = 22
const WALL_H = 46
const VIEWS = {
  persp: { tilt: 55, spin: -18 },
  front: { tilt: 68, spin: 0 },
  top: { tilt: 0, spin: 0 },
}

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
 * 3D view of a floor layout, drawn with CSS 3D transforms (no WebGL, no extra library).
 * Drag to turn and tilt, buttons for preset views and zoom. Tables keep their real size, position,
 * rotation and seats, so the owner can judge space and walking room before changing the layout.
 * `live` tables carry a service state and are clickable; preview tables only show their colour.
 */
export default function Floor3D({ layout, tables = [], sectors = [], onTable, live = false }) {
  const { t } = useI18n()
  const W = +layout.largura || 900
  const D = +layout.altura || 500
  const [cam, setCam] = useState({ ...VIEWS.persp, zoom: 1 })
  const [fit, setFit] = useState(1)
  const boxRef = useRef(null)
  const drag = useRef(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return undefined
    const measure = () => setFit(Math.min(1.4, Math.max(0.25, (el.clientWidth - 32) / (Math.max(W, D) * 1.05))))
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [W, D])

  function down(e) {
    if (e.button !== 0 || e.target.closest('.f3-table')) return
    drag.current = { x: e.clientX, y: e.clientY, cam }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function move(e) {
    const s = drag.current
    if (!s) return
    const spin = s.cam.spin + (e.clientX - s.x) * 0.4
    const tilt = Math.min(80, Math.max(0, s.cam.tilt - (e.clientY - s.y) * 0.3))
    setCam(c => ({ ...c, spin, tilt }))
  }
  function up() { drag.current = null }

  const sectorColor = id => sectors.find(s => s.id === id)?.cor
  const scale = fit * cam.zoom

  return (
    <div className="f3">
      <div className="f3-tools" role="group" aria-label={t('floor.view3d')}>
        <div className="ui-seg" role="radiogroup" aria-label={t('floor.camera')}>
          {Object.keys(VIEWS).map(k => (
            <button key={k} type="button" role="radio" aria-checked={cam.tilt === VIEWS[k].tilt && cam.spin === VIEWS[k].spin} onClick={() => setCam(c => ({ ...c, ...VIEWS[k] }))}>
              {t(`floor.cam.${k}`)}
            </button>
          ))}
        </div>
        <span className="ui-spacer" />
        <button type="button" className="ui-btn is-icon is-sm" onClick={() => setCam(c => ({ ...c, spin: c.spin - 45 }))} aria-label={t('floor.turnLeft')}><Icon name="undo" size={16} /></button>
        <button type="button" className="ui-btn is-icon is-sm" onClick={() => setCam(c => ({ ...c, spin: c.spin + 45 }))} aria-label={t('floor.turnRight')}><Icon name="reopen" size={16} /></button>
        <button type="button" className="ui-btn is-icon is-sm" onClick={() => setCam(c => ({ ...c, zoom: Math.max(0.5, +(c.zoom - 0.15).toFixed(2)) }))} aria-label={t('floor.zoomOut')}><Icon name="zoomOut" size={16} /></button>
        <button type="button" className="ui-btn is-icon is-sm" onClick={() => setCam(c => ({ ...c, zoom: Math.min(2.5, +(c.zoom + 0.15).toFixed(2)) }))} aria-label={t('floor.zoomIn')}><Icon name="zoomIn" size={16} /></button>
      </div>

      <div
        ref={boxRef}
        className="f3-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label={t('floor.view3dHint')}
      >
        <div className="f3-world" style={{ width: W, height: D, marginLeft: -W / 2, marginTop: -D / 2, transform: `scale(${scale}) rotateX(${cam.tilt}deg) rotateZ(${cam.spin}deg)` }}>
          <div className="f3-floor" />
          <Box className="f3-wall" w={W} d={6} h={WALL_H} style={{ left: 0, top: -6 }} />
          <Box className="f3-wall" w={6} d={D} h={WALL_H} style={{ left: -6, top: 0 }} />
          <Box className="f3-wall is-low" w={6} d={D} h={WALL_H / 3} style={{ left: W, top: 0 }} />
          {tables.map(tb => {
            const w = +tb.largura
            const d = +tb.altura
            const h = TABLE_H[tb.forma] || 34
            const color = tb.cor || sectorColor(tb.sector_id) || 'var(--c-accent)'
            const seats = seatSpots(tb.forma, w, d, tb.capacidade)
            const label = live ? `${tb.nome}: ${t(`tabs.state.${tb.state}`)}${tb.open?.length ? `, ${fmtYen(tb.money.total)}` : ''}` : t('floor.tableAria', { name: tb.nome, n: tb.capacidade })
            return (
              <div
                key={tb.id}
                className={`f3-table is-${tb.forma}${live ? ` st-${tb.state}` : ''}${tb.ativo === false ? ' is-off' : ''}`}
                style={{ left: +tb.x, top: +tb.y, width: w, height: d, transform: tb.rotacao ? `rotateZ(${tb.rotacao}deg)` : undefined, ...(live ? null : { '--f3-color': color }) }}
              >
                {seats.map((s, i) => (
                  <Box key={i} className="f3-seat" w={SEAT} d={SEAT} h={SEAT_H} round={tb.forma === 'round'} style={{ left: s.x, top: s.y }} />
                ))}
                <Box w={w} d={d} h={h} round={tb.forma === 'round'} className="f3-surface">
                  <button
                    type="button"
                    className="f3-label"
                    onClick={() => onTable?.(tb)}
                    disabled={!onTable}
                    aria-label={label}
                    style={{ transform: `rotateZ(${-(cam.spin + (+tb.rotacao || 0))}deg)` }}
                  >
                    <strong>{tb.nome}</strong>
                    {live ? <small>{t(`tabs.state.${tb.state}`)}{tb.open?.length ? ` · ${fmtYen(tb.money.total)}` : ''}</small> : <small>{t('tabs.people', { n: tb.capacidade })}</small>}
                  </button>
                </Box>
              </div>
            )
          })}
        </div>
      </div>
      <p className="desk-note f3-hint"><Icon name="move" size={13} /> {t('floor.view3dHint')}</p>
    </div>
  )
}
