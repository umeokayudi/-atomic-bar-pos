import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import en from '../locales/en'
import ja from '../locales/ja'

const LANG_KEY = 'jbm_drinks_lang'

export const LANGS = {
  en: { id: 'en', label: 'English', htmlLang: 'en', dict: en, optional: false },
  ja: { id: 'ja', label: '日本語', htmlLang: 'ja', dict: ja, optional: true },
}

export const DEFAULT_LANG = 'en'

function loadLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'ja') return 'ja'
    if (saved === 'en') return 'en'
  } catch { /* ignore */ }
  try {
    const nav = String(navigator.language || '').toLowerCase()
    if (nav.startsWith('ja')) return 'ja'
  } catch { /* ignore */ }
  return DEFAULT_LANG
}

let globalLang = loadLang()
const listeners = new Set()

function resolveDict(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] != null ? acc[key] : undefined), obj)
}

export function setGlobalLang(lang) {
  globalLang = LANGS[lang] ? lang : DEFAULT_LANG
  try { localStorage.setItem(LANG_KEY, globalLang) } catch { /* ignore */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = LANGS[globalLang].htmlLang
  }
  listeners.forEach(fn => fn(globalLang))
}

export function getGlobalLang() {
  return globalLang
}

/** Translate outside React (utils, etc.) */
export function t(key, vars, lang = globalLang) {
  const dict = LANGS[lang]?.dict || en
  let str = resolveDict(dict, key) ?? resolveDict(en, key) ?? key
  if (vars && typeof str === 'string') {
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    })
  }
  return str
}

export function monthLabelI18n(mk, lang = globalLang) {
  if (!mk) return ''
  const [y, m] = mk.split('-')
  const names = LANGS[lang]?.dict?.months?.short || en.months.short
  return `${names[+m - 1]}/${y}`
}

const I18nContext = createContext({
  lang: 'en',
  setLang: () => {},
  t: (key, vars) => t(key, vars),
  monthLabel: monthLabelI18n,
})

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(globalLang)

  useEffect(() => {
    document.documentElement.lang = LANGS[globalLang].htmlLang
    const fn = l => setLangState(l)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])

  const setLang = useCallback(l => setGlobalLang(l), [])
  const translate = useCallback((key, vars) => t(key, vars, lang), [lang])
  const monthLabel = useCallback(mk => monthLabelI18n(mk, lang), [lang])

  return (
    <I18nContext.Provider value={{ lang, setLang, t: translate, monthLabel }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
