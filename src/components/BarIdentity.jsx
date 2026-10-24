import { useEffect, useMemo } from 'react'
import { brandTokens, resolveBrand } from '../lib/barBrand'
import { initialsOf } from '../lib/staffApp'

/** Atomic's mark: an atom in white lines on red. */
export function AtomMark({ size = 36 }) {
  return (
    <span className="sa-barmark is-atom" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 48 48" width="76%" height="76%" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
        <ellipse cx="24" cy="24" rx="20" ry="7.5" />
        <ellipse cx="24" cy="24" rx="20" ry="7.5" transform="rotate(60 24 24)" />
        <ellipse cx="24" cy="24" rx="20" ry="7.5" transform="rotate(120 24 24)" />
        <circle cx="24" cy="24" r="3.6" fill="#fff" stroke="none" />
      </svg>
    </span>
  )
}

/** The bar's square mark: its logo when HQ uploaded one, else the atom (Atomic), else its initials on its colour. */
export function BarMark({ brand, size = 36 }) {
  if (brand.logo) {
    return (
      <span className="sa-barmark is-logo" style={{ width: size, height: size }} aria-hidden="true">
        <img src={brand.logo} alt="" />
      </span>
    )
  }
  if (brand.atomic) return <AtomMark size={size} />
  return (
    <span className="sa-barmark" style={{ width: size, height: size, ...(brand.color ? { background: brand.color } : {}) }} aria-hidden="true">
      {brand.initials || initialsOf(brand.name)}
    </span>
  )
}

/** Logo + name block for the top of the bar's app (sidebar, phone top bar, till header). */
export function BarIdentity({ bar, size = 40, sub, className = '' }) {
  const brand = useMemo(() => ({ ...resolveBrand(bar), initials: initialsOf(bar?.nome) }), [bar])
  return (
    <div className={`bar-identity ${className}`.trim()}>
      <BarMark brand={brand} size={size} />
      <div className="bar-identity-text">
        <div className="bar-identity-name">{brand.name}</div>
        {sub ? <div className="bar-identity-sub">{sub}</div> : null}
      </div>
    </div>
  )
}

/**
 * Paints the whole bar app in the bar's colour while it is open: <html data-bar-brand="atomic|custom"> plus the
 * --bb-* tokens (src/design/barBrand.css maps them onto the theme). Portals (sheets, menus) follow because it is <html>.
 */
export function useBarTheme(bar) {
  const brand = useMemo(() => resolveBrand(bar), [bar])
  useEffect(() => {
    const root = document.documentElement
    if (!brand.theme) return undefined
    const tokens = brand.theme === 'custom' ? brandTokens(brand.color) : null
    root.dataset.barBrand = brand.theme
    if (tokens) Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v))
    const meta = document.querySelector('meta[name="theme-color"]')
    const before = meta?.getAttribute('content')
    if (meta) meta.setAttribute('content', brand.theme === 'atomic' ? '#0E0E0F' : tokens['--bb-chrome'])
    return () => {
      delete root.dataset.barBrand
      if (tokens) Object.keys(tokens).forEach(k => root.style.removeProperty(k))
      if (meta && before != null) meta.setAttribute('content', before)
    }
  }, [brand.theme, brand.color])
  return brand
}
