import { useEffect, useRef, useState } from 'react'
import { useUiPrefs, THEMES } from '../lib/uiPrefs'
import { useI18n, LANGS } from '../lib/i18n'

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n()
  return (
    <div className="layout-toggle">
      <span className="theme-toggle-label">{t('shell.language')}</span>
      <span className="theme-pill layout-pill">
        {Object.values(LANGS).map(opt => (
          <button
            key={opt.id}
            type="button"
            className={lang === opt.id ? 'on' : ''}
            onClick={() => setLang(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </span>
    </div>
  )
}

export function ThemeToggle({ compact }) {
  const { theme, toggleTheme } = useUiPrefs()
  const { t } = useI18n()
  return (
    <button type="button" className="theme-toggle" onClick={toggleTheme}>
      {!compact && <span className="theme-toggle-label">{t('shell.theme')}</span>}
      <span className="theme-pill">
        <span className={theme === THEMES.classic ? 'on' : ''}>{t('shell.classic')}</span>
        <span className={theme === THEMES.modern ? 'on' : ''}>{t('shell.modern')}</span>
      </span>
    </button>
  )
}

export default function UiPrefsPanel({ compact = false }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    const onDoc = e => {
      if (wrapRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`ui-prefs-wrap${compact ? ' is-chrome' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={`ui-prefs-toggle${compact ? ' is-icon' : ''}${open ? ' is-on' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={open ? t('shell.hideAppearance') : t('shell.showAppearance')}
      >
        {compact ? '⚙' : `⚙ ${t('shell.appearance')}`}
      </button>
      {open && (
        <div className="ui-prefs-popover" role="dialog" aria-label={t('shell.appearance')}>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      )}
    </div>
  )
}
