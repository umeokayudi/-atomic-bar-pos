/** Visual workboards. A missing series stays blank; it is never drawn as zero. */

export function TrendStage({ title, points = [], valueKey = 'value', caption = 'Not connected' }) {
  const series = points.map(point => ({
    label: point.label || '',
    value: point[valueKey] == null ? null : Number(point[valueKey]),
  }))
  const known = series.filter(point => Number.isFinite(point.value))
  return (
    <section className="trend-stage">
      <header><h2>{title}</h2></header>
      {known.length ? <TrendLine points={series} /> : (
        <div className="trend-empty" role="img" aria-label={caption}>
          <svg viewBox="0 0 640 180" aria-hidden="true">
            <line x1="28" y1="150" x2="612" y2="150" />
            <line x1="28" y1="18" x2="28" y2="150" />
          </svg>
          <p>{caption}</p>
        </div>
      )}
    </section>
  )
}

function TrendLine({ points }) {
  const known = points.filter(point => Number.isFinite(point.value))
  const width = 640
  const height = 180
  const pad = 28
  const max = Math.max(...known.map(point => point.value), 1)
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0
  const x = index => pad + index * step
  const y = value => height - 24 - (value / max) * (height - 48)
  let path = ''
  points.forEach((point, index) => {
    if (!Number.isFinite(point.value)) {
      path += ' M '
      return
    }
    const command = path.endsWith('M ') || path === '' ? 'M' : 'L'
    path += `${command}${x(index)},${y(point.value)} `
  })
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="trend-line" role="img">
      <line x1={pad} y1={height - 24} x2={width - pad} y2={height - 24} />
      <path d={path.trim()} />
      {points.map((point, index) => Number.isFinite(point.value) ? (
        <circle key={`${point.label}-${index}`} cx={x(index)} cy={y(point.value)} r="3.5">
          <title>{`${point.label}: ${point.value}`}</title>
        </circle>
      ) : null)}
    </svg>
  )
}

export function MetricTile({ label, value }) {
  return (
    <article className="metric-tile">
      <span>{label}</span>
      <strong>{value == null || value === '' ? '—' : value}</strong>
    </article>
  )
}

export function SignalBoard({ title, items }) {
  return (
    <aside className="signal-board">
      <h2>{title}</h2>
      <ul>
        {items.map(item => (
          <li key={item.label}>
            <span>{item.label}</span>
            <b>{item.value}</b>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export function BooksClosed({ title, lanes }) {
  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">Not connected</p>
          <h1 className="page-title">{title}</h1>
        </div>
      </header>
      <WorkLanes lanes={lanes.map(name => ({ title: name, state: 'Not connected' }))} />
    </div>
  )
}

export function WorkLanes({ lanes }) {
  return (
    <div className="work-lanes">
      {lanes.map(lane => (
        <article key={lane.title} className="lane">
          <h2>{lane.title}</h2>
          <p>{lane.state}</p>
        </article>
      ))}
    </div>
  )
}
