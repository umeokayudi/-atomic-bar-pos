import { useState } from 'react'
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

export default function UiPrefsPanel() {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()

  return (
    <div className="ui-prefs-wrap">
      <button
        type="button"
        className="ui-prefs-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={open ? t('shell.hideAppearance') : t('shell.showAppearance')}
      >
        {open ? `▾ ${t('shell.appearance')}` : `⚙ ${t('shell.appearance')}`}
      </button>
      {open && (
        <div className="ui-prefs-panel">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      )}
    </div>
  )
}
