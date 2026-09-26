/** Shared layout primitives — same visual language as PortalCliente */

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
      <div>
        <div className="portal-page-title">{title}</div>
        {subtitle && <div className="portal-page-sub">{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </div>
  )
}

export function PortalHero({ label, value, sub, alert, onClick, style }) {
  const clickable = typeof onClick === 'function'
  return (
    <div
      className={`portal-hero-card${clickable ? ' is-clickable' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      style={style}
    >
      {label && <div className="portal-overline portal-overline-light">{label}</div>}
      <div className="portal-hero-value">{value}</div>
      {sub && <div className="portal-hero-sub">{sub}</div>}
      {alert}
    </div>
  )
}

export function PortalKpi({ label, value, sub, subColor, color = 'var(--navy)', onClick, hint }) {
  const clickable = typeof onClick === 'function'
  return (
    <div
      className={`portal-kpi-card${clickable ? ' is-clickable' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="portal-overline">{label}</div>
      <div className="portal-kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="portal-kpi-sub" style={subColor ? { color: subColor, fontWeight: 600 } : undefined}>{sub}</div>}
      {hint && <div className="portal-kpi-hint">{hint}</div>}
    </div>
  )
}

export function PortalSurface({ title, sub, children, style, headerRight }) {
  return (
    <div className="portal-surface-card" style={style}>
      {(title || headerRight) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: sub || children ? 16 : 0, gap: 12, flexWrap: 'wrap' }}>
          <div>
            {title && <div className="portal-section-title">{title}</div>}
            {sub && <div className="portal-section-sub">{sub}</div>}
          </div>
          {headerRight}
        </div>
      )}
      {children}
    </div>
  )
}

export function PortalPills({ options, value, onChange, scrollable }) {
  return (
    <div className={scrollable ? 'portal-pills-scroll' : undefined} style={scrollable ? undefined : { display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`portal-pill-btn${value === id ? ' active' : ''}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function AdminPage({ title, subtitle, actions, children, wide = false }) {
  return (
    <div className="fade-in" style={{ maxWidth: wide ? 1100 : 1000 }}>
      {(title || subtitle || actions) && (
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
      )}
      {children}
    </div>
  )
}

export function PortalAlert({ variant = 'amber', children, onClick }) {
  const styles = {
    amber: { background: '#fffbeb', border: '1px solid #fcd34d', color: 'inherit' },
    red: { background: 'linear-gradient(135deg,#ff3b30,#c0392b)', border: 'none', color: 'white' },
    green: { background: '#f0fdf4', border: '1px solid #86efac', color: '#166534' },
    navy: { background: 'linear-gradient(135deg,var(--navy),var(--navy2))', border: '1px solid rgba(193,156,86,0.3)', color: 'white' },
  }
  const s = styles[variant] || styles.amber
  return (
    <div
      className="portal-alert"
      style={{ ...s, borderRadius: 16, padding: '14px 18px', marginBottom: 16, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {children}
    </div>
  )
}
