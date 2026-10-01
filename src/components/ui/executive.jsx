/** Presentational executive dashboard pieces. They do not load or invent figures. */

import NavIcon from './NavIcon'

export function MetricCard({ label, value, detail, trend, status }) {
  return (
    <article className="metric-card">
      <div className="metric-card-header">
        <span className="eyebrow">{label}</span>
        {status === 'available' && trend ? <span className="metric-trend">{trend}</span> : null}
      </div>
      <div className="metric-value">{status === 'available' ? value : '—'}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
    </article>
  )
}

export function Panel({ title, extra, children }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="section-title">{title}</h2>
        {extra || null}
      </header>
      {children}
    </section>
  )
}

export function ChartEmpty({ title, detail }) {
  return (
    <div className="chart-empty">
      <div className="chart-empty-icon">
        <NavIcon name="custos" />
      </div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}
