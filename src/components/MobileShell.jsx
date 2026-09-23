import { useEffect } from 'react'
import { LogoMobileHeader } from './Logo'

export function useMobileMenuLock(open) {
  useEffect(() => {
    document.body.classList.toggle('menu-open', open)
    return () => document.body.classList.remove('menu-open')
  }, [open])
}

export function MobileTopBar({ open, onToggle, title, children }) {
  return (
    <header className="mobile-topbar">
      <button
        type="button"
        className="menu-toggle"
        onClick={onToggle}
        aria-label={open ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={open}
      >
        <span className={`menu-toggle-icon${open ? ' is-open' : ''}`} />
      </button>
      {title || <LogoMobileHeader />}
      <div className="mobile-topbar-actions">{children}</div>
    </header>
  )
}

export function ShellOverlay({ open, onClose }) {
  if (!open) return null
  return <button type="button" className="shell-overlay" onClick={onClose} aria-label="Fechar menu" />
}
