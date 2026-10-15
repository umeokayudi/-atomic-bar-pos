import { useEffect, useState } from 'react'
import { initialsOf } from '../../lib/staffApp'
import { getGlobalLang } from '../../lib/i18n'
import { dateLocale } from '../../lib/tokyo'
import Icon from '../ui/Icon'

const TZ = 'Asia/Tokyo'

export function fmtDay(value, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(dateLocale(getGlobalLang()), { timeZone: TZ, ...opts })
}

export function fmtTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(dateLocale(getGlobalLang()), { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

export function fmtHours(h) {
  const total = Math.round((+h || 0) * 60)
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
}

/** Ticks every `ms` while `on` (live shift timer). */
export function useNow(on, ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return undefined
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [on, ms])
  return now
}

export function Avatar({ name, url, size = 44, onClick, label }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) }
  const inner = url ? <img src={url} alt="" /> : <span>{initialsOf(name)}</span>
  if (onClick) {
    return <button type="button" className="sa-avatar" style={style} onClick={onClick} aria-label={label || name}>{inner}</button>
  }
  return <span className="sa-avatar" style={style} aria-hidden={!label} aria-label={label}>{inner}</span>
}

export function Card({ title, right, children, className = '', tone }) {
  return (
    <section className={`sa-card${tone ? ` is-${tone}` : ''} ${className}`.trim()}>
      {(title || right) && (
        <header className="sa-card-head">
          {title && <h2>{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Row({ title, meta, value, tone, children }) {
  return (
    <div className="sa-row">
      <div className="sa-row-main">
        <strong>{title}</strong>
        {meta && <span>{meta}</span>}
        {children}
      </div>
      {value !== undefined && <div className={`sa-row-value${tone ? ` is-${tone}` : ''}`}>{value}</div>}
    </div>
  )
}

/** Small neutral note (empty data, payroll not set up yet): never a big error panel. */
export function Note({ icon = 'info', children }) {
  return (
    <p className="sa-note"><Icon name={icon} size={15} /> <span>{children}</span></p>
  )
}

export function Stat({ label, value, sub, tone, onClick }) {
  const body = (
    <>
      <span>{label}</span>
      <strong className={tone ? `is-${tone}` : ''}>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </>
  )
  return onClick
    ? <button type="button" className="sa-stat" onClick={onClick}>{body}</button>
    : <div className="sa-stat">{body}</div>
}

export function Seg({ value, options, onChange, label }) {
  return (
    <div className="sa-seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'is-on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
