import { useState } from 'react'
import { useUiPrefs, THEMES, LAYOUTS } from '../lib/uiPrefs'
import { useI18n, LANGS } from '../lib/i18n'

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n()
  return (
    <div>
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
              {opt.id === 'ja' ? t('shell.langJaOptional') : opt.label}
            </button>
          ))}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, paddingLeft: 2 }}>{t('shell.languageHint')}</div>
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

export function LayoutToggle() {
  const { layout, setLayout } = useUiPrefs()
  const { t } = useI18n()
  return (
    <div className="layout-toggle">
      <span className="theme-toggle-label">{t('shell.layout')}</span>
      <span className="theme-pill layout-pill">
        {[
          { id: LAYOUTS.auto, label: t('shell.layoutAuto') },
          { id: LAYOUTS.desktop, label: t('shell.layoutDesktop') },
          { id: LAYOUTS.tablet, label: t('shell.layoutTablet') },
          { id: LAYOUTS.mobile, label: t('shell.layoutMobile') },
        ].map(opt => (
          <button
            key={opt.id}
            type="button"
            className={layout === opt.id ? 'on' : ''}
            onClick={() => setLayout(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </span>
    </div>
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
          <LayoutToggle />
        </div>
      )}
    </div>
  )
}
