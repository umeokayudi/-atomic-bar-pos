import { useId, useState } from 'react'
import { deltaPct, niceMax, shortNum } from '../../lib/chartMath'

export { deltaPct, niceMax, shortNum }

/**
 * Small chart kit in the JBM TECH reference style: light gridlines, rounded emerald columns,
 * values on hover/tap, labels that thin out on narrow screens. Plain HTML/SVG, no chart library.
 */

const plain = v => String(v ?? '')



function Axis({ max, ticks = 4 }) {
  return (
    <div className="uc-axis" aria-hidden="true">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * (ticks - i)
        return <div key={i} className="uc-axis-row"><span>{shortNum(v)}</span></div>
      })}
    </div>
  )
}

/** How many labels to skip so they never collide. */
function labelStep(n, labels = []) {
  // Long labels ("Aug 16") need twice the room, so show every other one.
  const wide = labels.some(l => String(l ?? '').length > 4) ? 2 : 1
  return Math.max(1, Math.ceil(baseStep(n) * wide / (n <= 4 ? 2 : 1)))
}

function baseStep(n) {
  if (n <= 8) return 1
  if (n <= 14) return 2
  if (n <= 24) return 3
  return Math.ceil(n / 8)
}

/**
 * Vertical columns with an axis. data: [{ label, value, tip? }]
 * highlight: 'last' | 'max' | index — the stronger column.
 */
export function ColumnChart({ data = [], height = 180, format = plain, highlight = 'max', empty = '—', ariaLabel }) {
  const [on, setOn] = useState(null)
  if (!data.length || data.every(d => !d.value)) return <div className="uc-empty">{empty}</div>
  const max = niceMax(Math.max(...data.map(d => d.value || 0)))
  const peak = highlight === 'max' ? data.reduce((b, d, i) => ((d.value || 0) > (data[b].value || 0) ? i : b), 0)
    : highlight === 'last' ? data.length - 1 : highlight
  const step = labelStep(data.length, data.map(d => d.label))
  return (
    <div className="uc-chart" style={{ '--uc-h': `${height}px` }} role="img" aria-label={ariaLabel}>
      <Axis max={max} />
      <div className="uc-plot">
        <div className="uc-cols" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
          {data.map((d, i) => {
            const h = Math.max(d.value > 0 ? 2 : 0, ((d.value || 0) / max) * 100)
            return (
              <button
                type="button" key={i}
                className={`uc-col${i === peak ? ' is-peak' : ''}${on === i ? ' is-on' : ''}`}
                onMouseEnter={() => setOn(i)} onMouseLeave={() => setOn(null)} onFocus={() => setOn(i)} onBlur={() => setOn(null)}
                aria-label={d.tip || `${d.label}: ${format(d.value)}`}
              >
                <span className="uc-col-bar" style={{ height: `${h}%` }} />
                {on === i && <span className="uc-tip">{d.tip || `${d.label} · ${format(d.value)}`}</span>}
              </button>
            )
          })}
        </div>
        <div className="uc-xlabels" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
          {data.map((d, i) => <span key={i}>{i % step === 0 || i === data.length - 1 ? d.label : ''}</span>)}
        </div>
      </div>
    </div>
  )
}

/** Paired in/out columns (cash in green, cash out red). data: [{ label, in, out }] */
export function InOutChart({ data = [], height = 180, format = plain, labels = ['In', 'Out'], empty = '—' }) {
  const [on, setOn] = useState(null)
  if (!data.length || data.every(d => !d.in && !d.out)) return <div className="uc-empty">{empty}</div>
  const max = niceMax(Math.max(...data.map(d => Math.max(d.in || 0, d.out || 0))))
  const step = labelStep(data.length, data.map(d => d.label))
  const pct = v => Math.max(v > 0 ? 2 : 0, ((v || 0) / max) * 100)
  return (
    <div>
      <div className="uc-legend">
        <span><i className="is-in" />{labels[0]}</span>
        <span><i className="is-out" />{labels[1]}</span>
      </div>
      <div className="uc-chart" style={{ '--uc-h': `${height}px` }}>
        <Axis max={max} />
        <div className="uc-plot">
          <div className="uc-cols" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
            {data.map((d, i) => (
              <button
                type="button" key={i} className={`uc-col is-pair${on === i ? ' is-on' : ''}`}
                onMouseEnter={() => setOn(i)} onMouseLeave={() => setOn(null)} onFocus={() => setOn(i)} onBlur={() => setOn(null)}
                aria-label={`${d.label}: ${labels[0]} ${format(d.in)}, ${labels[1]} ${format(d.out)}`}
              >
                <span className="uc-col-bar is-in" style={{ height: `${pct(d.in)}%` }} />
                <span className="uc-col-bar is-out" style={{ height: `${pct(d.out)}%` }} />
                {on === i && <span className="uc-tip">{d.label}<br />{labels[0]} {format(d.in)}<br />{labels[1]} {format(d.out)}</span>}
              </button>
            ))}
          </div>
          <div className="uc-xlabels" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
            {data.map((d, i) => <span key={i}>{i % step === 0 || i === data.length - 1 ? d.label : ''}</span>)}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Area line with dots and the latest value. data: [{ label, value }] */
export function LineChart({ data = [], height = 160, format = plain, empty = '—' }) {
  const gid = useId().replace(/:/g, '')
  const [on, setOn] = useState(null)
  if (data.length < 2) return <div className="uc-empty">{empty}</div>
  const vals = data.map(d => d.value || 0)
  const lo = Math.min(0, ...vals)
  const max = niceMax(Math.max(...vals) - lo) + lo
  const W = 100, H = 100
  const x = i => (i / (data.length - 1)) * W
  const y = v => H - ((v - lo) / (max - lo || 1)) * H
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const step = labelStep(data.length, data.map(d => d.label))
  const last = data[data.length - 1]
  return (
    <div className="uc-chart" style={{ '--uc-h': `${height}px` }}>
      <Axis max={max} />
      <div className="uc-plot">
        <div className="uc-line-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="uc-line" aria-hidden="true">
            <defs>
              <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--c-accent)" stopOpacity=".28" />
                <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#g${gid})`} />
            <path d={line} fill="none" stroke="var(--c-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {data.map((d, i) => (
            <button
              type="button" key={i} className={`uc-dot${i === data.length - 1 ? ' is-last' : ''}${on === i ? ' is-on' : ''}`}
              style={{ left: `${x(i)}%`, top: `${y(d.value || 0)}%` }}
              onMouseEnter={() => setOn(i)} onMouseLeave={() => setOn(null)} onFocus={() => setOn(i)} onBlur={() => setOn(null)}
              aria-label={d.tip || `${d.label}: ${format(d.value)}`}
            >
              {on === i && <span className="uc-tip">{d.tip || `${d.label} · ${format(d.value)}`}</span>}
            </button>
          ))}
          <span className="uc-end" style={{ top: `${y(last.value || 0)}%` }}>{format(last.value)}</span>
        </div>
        <div className="uc-xlabels" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
          {data.map((d, i) => <span key={i}>{i % step === 0 || i === data.length - 1 ? d.label : ''}</span>)}
        </div>
      </div>
    </div>
  )
}

/** Horizontal bars with share of total (main expenses). items: [{ label, value, sub?, tone? }] */
export function HBarList({ items = [], format = plain, total, max = 6, empty = '—', showPct = true }) {
  const list = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value).slice(0, max)
  if (!list.length) return <div className="uc-empty">{empty}</div>
  const sum = total || items.reduce((s, i) => s + (i.value > 0 ? i.value : 0), 0) || 1
  const top = list[0].value || 1
  return (
    <ul className="uc-hbars">
      {list.map((it, i) => (
        <li key={it.key || it.label || i}>
          <div className="uc-hbar-head">
            <span className="uc-hbar-label">{it.label}</span>
            <span className="uc-hbar-val">{format(it.value)}{showPct && <em>{Math.round((it.value / sum) * 100)}%</em>}</span>
          </div>
          <div className="uc-hbar-track"><span className={`uc-hbar-fill${it.tone ? ` is-${it.tone}` : ''}`} style={{ width: `${(it.value / top) * 100}%` }} /></div>
          {it.sub && <div className="uc-hbar-sub">{it.sub}</div>}
        </li>
      ))}
    </ul>
  )
}

/** Numbered ranking (top products / top bars). items: [{ label, value, sub? }] */
export function RankList({ items = [], format = plain, max = 5, empty = '—', onPick }) {
  const list = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value).slice(0, max)
  if (!list.length) return <div className="uc-empty">{empty}</div>
  const top = list[0].value || 1
  return (
    <ol className="uc-rank">
      {list.map((it, i) => {
        const Row = onPick ? 'button' : 'div'
        return (
          <li key={it.key || it.label || i}>
            <Row className="uc-rank-row" {...(onPick ? { type: 'button', onClick: () => onPick(it) } : {})}>
              <span className={`uc-rank-n${i === 0 ? ' is-first' : ''}`}>{i + 1}</span>
              <span className="uc-rank-main">
                <span className="uc-rank-label">{it.label}</span>
                <span className="uc-rank-track"><span style={{ width: `${(it.value / top) * 100}%` }} /></span>
              </span>
              <span className="uc-rank-val">{format(it.value)}{it.sub && <small>{it.sub}</small>}</span>
            </Row>
          </li>
        )
      })}
    </ol>
  )
}

const DONUT_TONES = ['var(--c-accent)', 'var(--c-info)', 'var(--c-warning)', 'var(--c-danger)', 'var(--c-text-3)', 'var(--c-success)']

/** Donut with a legend. segments: [{ label, value }] */
export function Donut({ segments = [], format = plain, center, size = 140, empty = '—' }) {
  const list = segments.filter(s => s.value > 0)
  const sum = list.reduce((a, s) => a + s.value, 0)
  if (!sum) return <div className="uc-empty">{empty}</div>
  const r = 40, c = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="uc-donut">
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--c-surface-2)" strokeWidth="14" />
        {list.map((s, i) => {
          const len = (s.value / sum) * c
          const el = (
            <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={s.color || DONUT_TONES[i % DONUT_TONES.length]} strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)" />
          )
          acc += len
          return el
        })}
        {center && <text x="50" y="54" textAnchor="middle" className="uc-donut-center">{center}</text>}
      </svg>
      <ul className="uc-donut-legend">
        {list.map((s, i) => (
          <li key={i}>
            <i style={{ background: s.color || DONUT_TONES[i % DONUT_TONES.length] }} />
            <span>{s.label}</span>
            <b>{format(s.value)} <em>{Math.round((s.value / sum) * 100)}%</em></b>
          </li>
        ))}
      </ul>
    </div>
  )
}

