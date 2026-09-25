import { useEffect } from 'react'
import { LogoMobileHeader } from './Logo'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { useUiPrefs } from '../lib/uiPrefs'
import { roleLabel } from './utils'

export function useMobileMenuLock(open) {
  useEffect(() => {
    document.body.classList.toggle('menu-open', open)
    return () => document.body.classList.remove('menu-open')
  }, [open])
}

export function MobileTopBar({ open, onToggle, title, children }) {
  const { perfil, user } = useAuth()
  const { device } = useUiPrefs()
  const { t } = useI18n()
  const name = perfil?.nome || user?.email || ''
  const role = perfil?.role ? roleLabel(perfil.role) : ''
  const deviceLabel = t(device === 'phone' ? 'shell.devicePhone' : device === 'tablet' ? 'shell.deviceTablet' : 'shell.deviceDesktop')
  return (
    <header className="mobile-topbar">
      <button
        type="button"
        className="menu-toggle"
        onClick={onToggle}
        aria-label={open ? t('shell.closeMenu') : t('shell.openMenu')}
        aria-expanded={open}
      >
        <span className={`menu-toggle-icon${open ? ' is-open' : ''}`} />
      </button>
      <div className="mobile-who">
        <div className="mobile-who-title">{title || <LogoMobileHeader />}</div>
        {name && (
          <div className="mobile-who-meta">
            <span className="mobile-who-name">{name}{role ? ` · ${role}` : ''}</span>
            <span className="mobile-device-pill">{deviceLabel}</span>
          </div>
        )}
      </div>
      <div className="mobile-topbar-actions">{children}</div>
    </header>
  )
}

export function ShellOverlay({ open, onClose }) {
  const { t } = useI18n()
  if (!open) return null
  return <button type="button" className="shell-overlay" onClick={onClose} aria-label={t('shell.closeMenu')} />
}

/** Desktop/tablet tools that sit in the page, not the sidebar. */
export function WorkspaceChrome({ children }) {
  if (!children) return null
  return <div className="workspace-chrome">{children}</div>
}
