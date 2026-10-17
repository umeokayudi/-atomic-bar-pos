import Icon from './Icon'
import { greetingPart } from '../../lib/greeting'

export { greetingPart }

/** Shared layout primitives — same visual language as PortalCliente */

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
      <div>
        <div className="portal-page-title">{title}</div>
        {subtitle && <div className="portal-page-sub">{subtitle}</div>}
      </div>
      {actions && <div className="page-header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', minWidth: 0, maxWidth: '100%' }}>{actions}</div>}
    </div>
  )
}

/**
 * Welcome header (same idea as kuripuro's dashboard): small kicker, greeting by first name,
 * one line on what the page shows, and the main actions on the right.
 */
export function WelcomeHeader({ kicker, name, lead, actions, greet }) {
  const first = String(name || '').trim().split(/\s+/)[0]
  return (
    <div className="welcome-head">
      <div className="welcome-text">
        {kicker && <div className="welcome-kicker">{kicker}</div>}
        <h1 className="welcome-title">
          {greet(greetingPart(), first)}
          <span className="welcome-wave" aria-hidden="true"><Icon name="wave" size={22} /></span>
        </h1>
        {lead && <p className="welcome-lead">{lead}</p>}
      </div>
      {actions && <div className="welcome-actions">{actions}</div>}
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

/**
 * KPI card like the JBM TECH reference: icon square, label, big value, then the change
 * vs the previous period ("+12% vs last month"). delta is a whole percent or null.
 * deltaGood='down' flips the colours for costs, where going down is good.
 */
export function PortalKpi({ label, value, sub, subColor, color = 'var(--c-text)', onClick, hint, icon, tone = 'accent', delta, deltaLabel, deltaGood = 'up' }) {
  const clickable = typeof onClick === 'function'
  // --navy is the dark chrome colour: as text it vanishes on dark surfaces, so it reads as body text here.
  const valueColor = !color || color === 'var(--navy)' ? 'var(--c-text)' : color
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta)
  const good = hasDelta && (deltaGood === 'down' ? delta <= 0 : delta >= 0)
  return (
    <div
      className={`portal-kpi-card${clickable ? ' is-clickable' : ''}${icon ? ' has-icon' : ''}`}
      onClick={onClick}
      onKeyDown={clickable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) } } : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="portal-kpi-top">
        {icon && <span className={`portal-kpi-icon is-${tone}`}><Icon name={icon} size={18} /></span>}
        <div className="portal-overline">{label}</div>
      </div>
      <div className="portal-kpi-value" style={{ color: valueColor }}>{value}</div>
      {hasDelta && (
        <div className={`portal-kpi-delta ${good ? 'is-good' : 'is-bad'}`}>
          <Icon name={delta >= 0 ? 'trendUp' : 'trendDown'} size={13} />
          <b>{delta > 0 ? '+' : ''}{delta}%</b>{deltaLabel && <span>{deltaLabel}</span>}
        </div>
      )}
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
    amber: { background: 'var(--amber-bg)', border: '1px solid #fcd34d', color: 'inherit' },
    red: { background: 'linear-gradient(135deg,var(--red),#c0392b)', border: 'none', color: 'white' },
    green: { background: 'var(--green-bg)', border: '1px solid #86efac', color: '#166534' },
    navy: { background: 'linear-gradient(135deg,var(--navy),var(--navy2))', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)', color: 'white' },
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
