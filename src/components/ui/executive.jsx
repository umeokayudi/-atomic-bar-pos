/** Presentational command-center pieces. They do not load or invent figures. */

import NavIcon from './NavIcon'

export const METRIC_STATUS = {
  AVAILABLE: 'available',
  EMPTY: 'empty',
  INSUFFICIENT: 'insufficient',
  LOADING: 'loading',
  ERROR: 'error',
}

export function DashboardHeader({ kicker, title, subtitle, children }) {
  return (
    <header className="dashboard-header">
      <div>
        {kicker ? <div className="eyebrow">{kicker}</div> : null}
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {children ? <div className="dashboard-header-actions">{children}</div> : null}
    </header>
  )
}

export function QuickAction({ primary = false, icon, children, ...props }) {
  return (
    <button type="button" className={primary ? 'action-primary' : 'action-secondary'} {...props}>
      {icon ? <NavIcon name={icon} /> : null}
      {children}
    </button>
  )
}

export function MetricCard({ label, value, detail, trend, status = METRIC_STATUS.INSUFFICIENT }) {
  const known = status === METRIC_STATUS.AVAILABLE
  const shown = known ? value : status === METRIC_STATUS.LOADING ? '…' : '—'
  return (
    <article className={`metric-card is-${status}`}>
      <div className="metric-card-header">
        <span className="eyebrow">{label}</span>
        {known && trend ? <span className="metric-trend">{trend}</span> : null}
      </div>
      <div className="metric-value">{shown}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
    </article>
  )
}

export function SectionHeader({ title, extra }) {
  return (
    <header className="panel-head">
      <h2 className="section-title">{title}</h2>
      {extra || null}
    </header>
  )
}

export function Panel({ title, extra, children }) {
  return (
    <section className="panel">
      <SectionHeader title={title} extra={extra} />
      {children}
    </section>
  )
}

export function ChartPanel(props) {
  return <Panel {...props} />
}

export function OperationalStatus({ label, value, detail, status = 'available' }) {
  return (
    <div className="ops-status-row">
      <div>
        <div className="ops-status-label">{label}</div>
        {detail ? <div className="metric-detail">{detail}</div> : null}
      </div>
      <strong className={`ops-status-value is-${status}`}>{status === 'available' || status === 'empty' ? value : '—'}</strong>
    </div>
  )
}

export function EmptyState({ icon = 'custos', title, detail }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <NavIcon name={icon} />
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}

export function ChartEmpty(props) {
  return <EmptyState {...props} />
}

export function StatusBadge({ tone = 'available', children }) {
  return <span className={`status-badge is-${tone}`}>{children}</span>
}
