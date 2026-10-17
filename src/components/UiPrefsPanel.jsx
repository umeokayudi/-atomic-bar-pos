import { useEffect, useRef, useState } from 'react'
import { useUiPrefs, THEME_PREFS } from '../lib/uiPrefs'
import Icon from './ui/Icon'
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

/** Light / Dark / System. Persisted on the device and, when signed in, on the account. */
export function ThemeToggle() {
  const { themePref, setThemePref } = useUiPrefs()
  const { t } = useI18n()
  const opts = [
    { id: THEME_PREFS.light, icon: 'sun', label: t('theme.light') },
    { id: THEME_PREFS.dark, icon: 'moon', label: t('theme.dark') },
    { id: THEME_PREFS.system, icon: 'system', label: t('theme.system') },
  ]
  return (
    <div className="layout-toggle">
      <span className="theme-toggle-label">{t('theme.label')}</span>
      <div className="ui-seg" role="radiogroup" aria-label={t('theme.label')}>
        {opts.map(o => (
          <button key={o.id} type="button" role="radio" aria-checked={themePref === o.id} onClick={() => setThemePref(o.id)}>
            <Icon name={o.icon} size={14} />{o.label}
          </button>
        ))}
      </div>
    </div>
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
        <Icon name="settings" size={18} />{!compact && <span>{t('shell.appearance')}</span>}
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
