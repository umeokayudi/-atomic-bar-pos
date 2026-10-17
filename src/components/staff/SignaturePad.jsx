import { useEffect, useRef, useState } from 'react'

/**
 * Finger / mouse signature on a canvas. onChange gets a small PNG data URL ('' when cleared).
 * Pointer events cover touch on iPhone/iPad and the mouse on a Mac.
 */
export default function SignaturePad({ onChange, label, clearLabel, hint }) {
  const canvas = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const w = c.clientWidth || 320
    const h = c.clientHeight || 140
    c.width = Math.round(w * ratio)
    c.height = Math.round(h * ratio)
    const ctx = c.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#13201D'
  }, [])

  function point(e) {
    const r = canvas.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function down(e) {
    e.preventDefault()
    canvas.current.setPointerCapture?.(e.pointerId)
    drawing.current = true
    last.current = point(e)
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvas.current.getContext('2d')
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (empty) setEmpty(false)
  }

  function up() {
    if (!drawing.current) return
    drawing.current = false
    // Downscale to keep the stored PNG small.
    const src = canvas.current
    const out = document.createElement('canvas')
    out.width = Math.min(480, src.clientWidth || 320)
    out.height = Math.round(out.width * (src.height / src.width))
    const ctx = out.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(src, 0, 0, out.width, out.height)
    onChange?.(out.toDataURL('image/png'))
  }

  function clear() {
    const c = canvas.current
    const ctx = c.getContext('2d')
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.restore()
    setEmpty(true)
    onChange?.('')
  }

  return (
    <div className="sa-sign">
      <div className="sa-sign-head">
        <span>{label}</span>
        <button type="button" className="sa-link" onClick={clear} disabled={empty}>{clearLabel}</button>
      </div>
      <div className="sa-sign-box">
      <canvas
        ref={canvas}
        className={`sa-sign-pad${empty ? ' is-empty' : ''}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        aria-label={label}
        role="img"
      />
      {empty && hint ? <span className="sa-sign-hint" aria-hidden="true">{hint}</span> : null}
      </div>
    </div>
  )
}
