/** Presentational pieces. They do not load data or change calculations. */

export function SectionHeader({ title, lead, actions }) {
  return (
    <header className="ops-section">
      <div>
        <h2>{title}</h2>
        {lead ? <p>{lead}</p> : null}
      </div>
      {actions ? <div className="ops-section-actions">{actions}</div> : null}
    </header>
  )
}

export function KpiCard({ label, value, detail, meter }) {
  return (
    <article className="desk-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <em>{detail}</em> : null}
      {meter != null && (
        <i className="desk-kpi-meter" aria-hidden="true">
          <b style={{ width: `${Math.max(0, Math.min(meter, 100))}%` }} />
        </i>
      )}
    </article>
  )
}

export function GoalProgress({ label, current, target, pct, remaining, extra }) {
  return (
    <article className="desk-goal-card">
      <span>{label}</span>
      <strong>{current}{target ? ` / ${target}` : ''}</strong>
      <em>{pct == null ? '' : `${pct}%`}</em>
      {remaining ? <small>{remaining}</small> : null}
      {extra ? <small>{extra}</small> : null}
      {pct != null && (
        <i className="desk-kpi-meter" aria-hidden="true">
          <b style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
        </i>
      )}
    </article>
  )
}

export function StatusBadge({ tone = 'neutral', children }) {
  return <span className={`ops-badge is-${tone}`}>{children}</span>
}

export function EmptyState({ children }) {
  return <div className="desk-empty">{children}</div>
}

export function InsightCard({ kicker, title, body }) {
  return (
    <article className="ops-insight">
      <span>{kicker}</span>
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
    </article>
  )
}

export function MetricSwitch({ options, value, onChange }) {
  return (
    <div className="ops-switch" role="tablist">
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          className={value === option.id ? 'is-on' : ''}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
