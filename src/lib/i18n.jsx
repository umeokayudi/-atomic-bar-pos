import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import en0 from '../locales/en'
import en1 from '../locales/en.redesign'
import en2 from '../locales/en.staffApp'
import en3 from '../locales/en.fixes'
import en4 from '../locales/en.openTabs'
import en5 from '../locales/en.push'
import en6 from '../locales/en.orders'
import en7 from '../locales/en.mission'
import ja0 from '../locales/ja'
import ja1 from '../locales/ja.redesign'
import ja2 from '../locales/ja.staffApp'
import ja3 from '../locales/ja.fixes'
import ja4 from '../locales/ja.openTabs'
import ja5 from '../locales/ja.push'
import ja6 from '../locales/ja.orders'
import ja7 from '../locales/ja.mission'
import pt0 from '../locales/pt'
import pt1 from '../locales/pt.redesign'
import pt2 from '../locales/pt.staffApp'
import pt3 from '../locales/pt.fixes'
import pt4 from '../locales/pt.openTabs'
import pt5 from '../locales/pt.push'
import pt6 from '../locales/pt.orders'
import pt7 from '../locales/pt.mission'
import es0 from '../locales/es'
import es1 from '../locales/es.redesign'
import es2 from '../locales/es.staffApp'
import es3 from '../locales/es.fixes'
import es4 from '../locales/es.openTabs'
import es5 from '../locales/es.push'
import es6 from '../locales/es.orders'
import es7 from '../locales/es.mission'

/** Deep merge (plain objects only) so new screens can keep their strings in their own file. */
export function mergeDict(base, extra) {
  const out = { ...base }
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? mergeDict(base[k], v)
      : v
  }
  return out
}
const build = parts => parts.reduce((acc, part) => mergeDict(acc, part), {})
const en = build([en0, en1, en2, en3, en4, en5, en6, en7])
const ja = build([ja0, ja1, ja2, ja3, ja4, ja5, ja6, ja7])
const pt = build([pt0, pt1, pt2, pt3, pt4, pt5, pt6, pt7])
const es = build([es0, es1, es2, es3, es4, es5, es6, es7])

// Last language used on this device: only for the sign-in page, before the account is known.
const LANG_KEY = 'jbm_drinks_lang'
// The language of each account on this device (the account itself also keeps it, see setAccountLang).
const ACCOUNT_LANG_KEY = 'jbm_lang_account_'

export const LANGS = {
  ja: { id: 'ja', label: '日本語', htmlLang: 'ja', dict: ja },
  pt: { id: 'pt', label: 'Português (BR)', htmlLang: 'pt-BR', dict: pt },
  en: { id: 'en', label: 'English', htmlLang: 'en', dict: en },
  es: { id: 'es', label: 'Español', htmlLang: 'es', dict: es },
}

/** The language is fixed per account. Default 日本語; it changes only in Settings (never in a header or menu). */
export const DEFAULT_LANG = 'ja'

function loadLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (LANGS[saved]) return saved
  } catch { /* ignore */ }
  return DEFAULT_LANG
}

let accountId = null
let accountSaver = null

/**
 * Called when an account signs in (or its profile loads): the app switches to that account's language.
 * `remoteLang` is what the account itself stores (Supabase user metadata); `save` persists a change there.
 */
export function applyAccountLang(id, remoteLang = null, save = null) {
  accountId = id || null
  accountSaver = save
  if (!accountId) return
  let lang = LANGS[remoteLang] ? remoteLang : null
  if (!lang) {
    try { const local = localStorage.getItem(ACCOUNT_LANG_KEY + accountId); if (LANGS[local]) lang = local } catch { /* ignore */ }
  }
  setGlobalLang(lang || DEFAULT_LANG)
}

/** Settings only: change the language of the signed-in account. */
export async function setAccountLang(lang) {
  if (!LANGS[lang]) return
  setGlobalLang(lang)
  if (accountId) { try { localStorage.setItem(ACCOUNT_LANG_KEY + accountId, lang) } catch { /* ignore */ } }
  if (accountSaver) { try { await accountSaver(lang) } catch { /* the device copy still holds */ } }
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
  if (typeof str !== 'string' && !Array.isArray(str)) str = key
  if (vars && typeof str === 'string') {
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    })
    str = pluralize(str)
  }
  return str
}

// "1 delivery(ies)" -> "1 delivery", "3 open invoice(s)" -> "3 open invoices".
// The noun follows its number, with up to three words in between.
const PLURAL_RE = /(\d[\d,.]*)((?:\s+[A-Za-z][\w-]*){0,3}?\s+)([A-Za-z][\w-]*?)\((s|es|ies)\)/g
export function pluralize(str) {
  return str.replace(PLURAL_RE, (_, num, gap, word, suffix) => {
    const one = Number(num.replace(/,/g, '')) === 1
    if (suffix === 'ies') return `${num}${gap}${one ? word : word.replace(/y$/, '') + 'ies'}`
    return `${num}${gap}${word}${one ? '' : suffix}`
  })
}

export function monthLabelI18n(mk, lang = globalLang) {
  if (!mk) return ''
  const [y, m] = mk.split('-')
  const names = LANGS[lang]?.dict?.months?.short || en.months.short
  return `${names[+m - 1]}/${y}`
}

const I18nContext = createContext({
  lang: DEFAULT_LANG,
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

  const setLang = useCallback(l => { setAccountLang(l) }, [])
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
