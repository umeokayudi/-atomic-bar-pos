/** Official Atomic Bar controls. Presentational only — no data or handlers of their own. */

export function Button({ variant = 'secondary', className = '', children, ...props }) {
  return (
    <button type="button" className={`ab-btn is-${variant}${className ? ` ${className}` : ''}`} {...props}>
      {children}
    </button>
  )
}

export function IconButton({ label, children, className = '', ...props }) {
  return (
    <button type="button" className={`ab-icon-btn${className ? ` ${className}` : ''}`} aria-label={label} {...props}>
      {children}
    </button>
  )
}

export function Card({ title, extra, children, className = '' }) {
  return (
    <section className={`panel ab-card${className ? ` ${className}` : ''}`}>
      {(title || extra) && (
        <header className="panel-head">
          {title ? <h2 className="section-title">{title}</h2> : <span />}
          {extra || null}
        </header>
      )}
      {children}
    </section>
  )
}

export function MetricCard({ label, value, detail }) {
  return (
    <article className="metric-card">
      <div className="eyebrow">{label}</div>
      <div className="metric-value">{value}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
    </article>
  )
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="ab-page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ab-filter">{actions}</div> : null}
    </header>
  )
}

export function SectionHeader({ title, lead, actions }) {
  return (
    <header className="ab-section-header">
      <div>
        <h2 className="section-title">{title}</h2>
        {lead ? <p className="page-subtitle">{lead}</p> : null}
      </div>
      {actions ? <div className="ab-filter">{actions}</div> : null}
    </header>
  )
}

export function StatusBadge({ tone = 'neutral', children }) {
  return <span className={`status-badge is-${tone}`}>{children}</span>
}

export function DataTable({ columns, rows, rowKey }) {
  return (
    <div className="ab-table-wrap">
      <table className="ab-table">
        <thead>
          <tr>
            {columns.map(col => <th key={col.key}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={rowKey(row)}>
              {columns.map(col => (
                <td key={col.key} className={col.wrap ? 'is-wrap' : undefined}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SearchInput({ label, ...props }) {
  return (
    <label className="ab-search ab-field">
      {label ? <span className="form-label">{label}</span> : null}
      <input type="search" {...props} />
    </label>
  )
}

export function FilterBar({ children }) {
  return <div className="ab-filter">{children}</div>
}

export function EmptyState({ title, detail }) {
  return (
    <div className="ab-empty">
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
    </div>
  )
}

export function LoadingState({ label }) {
  return <div className="ab-loading" role="status">{label}</div>
}

export function ErrorState({ title, detail }) {
  return (
    <div className="ab-error" role="alert">
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
    </div>
  )
}

export function ConfirmationDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel, busy = false }) {
  return (
    <div className="ab-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="ab-dialog" role="dialog" aria-modal="true" aria-labelledby="ab-dialog-title" onClick={event => event.stopPropagation()}>
        <h2 id="ab-dialog-title">{title}</h2>
        <p>{body}</p>
        <div className="ab-dialog-actions">
          <Button onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

export function FormField({ label, error, children }) {
  return (
    <label className="ab-field">
      <span className="form-label">{label}</span>
      {children}
      {error ? <small>{error}</small> : null}
    </label>
  )
}

export function NavigationItem({ active = false, icon, children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`nav-item sidebar-link${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

export function ActionPanel({ title, children }) {
  return (
    <section className="panel">
      {title ? <h2 className="section-title">{title}</h2> : null}
      <div className="ab-filter" style={{ marginTop: title ? 12 : 0 }}>{children}</div>
    </section>
  )
}
