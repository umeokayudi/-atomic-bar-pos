import { useCallback, useEffect, useState } from 'react'
import { useI18n } from './i18n'
import { useUiPrefs } from './uiPrefs'
import Icon from '../components/ui/Icon'

const KEY = 'jbm_sidebar_collapsed'

function read() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/**
 * Side menu that folds to an icon rail on tablet and desktop (saved on this device).
 * Phones keep the slide-in menu, so the rail never applies there.
 */
export function useSidebarCollapse() {
  const { device, layout } = useUiPrefs()
  const [collapsed, setCollapsed] = useState(read)
  const allowed = !(layout === 'mobile' || (layout !== 'desktop' && layout !== 'tablet' && device === 'phone'))
  const on = allowed && collapsed

  useEffect(() => {
    document.documentElement.classList.toggle('sidebar-is-collapsed', on)
    return () => document.documentElement.classList.remove('sidebar-is-collapsed')
  }, [on])

  const toggle = useCallback(() => {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }, [])

  // Ctrl/Cmd + B, the usual editor shortcut for a side bar.
  useEffect(() => {
    if (!allowed) return undefined
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'b') {
        const tag = (e.target?.tagName || '').toLowerCase()
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allowed, toggle])

  return { collapsed: on, allowed, toggle }
}

export function SidebarCollapseButton({ collapsed, onToggle }) {
  const { t } = useI18n()
  const label = collapsed ? t('shell.expandMenu') : t('shell.collapseMenu')
  return (
    <button type="button" className="sidebar-collapse-btn" onClick={onToggle} aria-label={label} title={`${label} (Ctrl+B)`} aria-expanded={!collapsed}>
      <Icon name={collapsed ? 'panelOpen' : 'panelClose'} size={18} />
    </button>
  )
}
