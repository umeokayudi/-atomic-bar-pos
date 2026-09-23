import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import en from '../locales/en'
import ja from '../locales/ja'

const LANG_KEY = 'jbm_drinks_lang'

const pt = {
  ...en,
  auth: {
    ...en.auth,
    enter: 'Entrar',
    email: 'E-mail',
    password: 'Senha',
    oneLoginHint: 'Um login só. Depois o sistema abre caixa, gerência, ponto ou JBM conforme a conta.',
    keepTablet: 'Manter este tablet conectado',
    wrongCredentials: 'E-mail ou senha incorretos.',
    enterEmailPassword: 'Informe e-mail e senha.',
    badProject: 'Este preview estava no banco errado. Recarregue e tente de novo.',
    network: 'Sem conexão com o servidor. Tente de novo.',
    emailPlaceholder: 'voce@email.com',
    costsNeverMix: 'Caixa, fatura JBM, salário e aluguel ficam em livros separados.',
  },
  cashflow: {
    ...en.cashflow,
    subtitle: 'O que entra, o que sai, e o que vence.',
    tabOverview: 'Resumo',
    tabAgenda: 'Agenda',
    tabIn: 'A receber',
    tabOut: 'A pagar',
    tabCaixa: 'Dinheiro em caixa',
    tabHolding: 'Holding',
    receivedBars: 'Já entrou (bares)',
    receivedBarsSub: 'pago nas faturas',
    paidSuppliers: 'Já saiu (fornecedores)',
    paidSuppliersSub: 'compras marcadas como pagas',
    netCash: 'Quanto tem agora',
    netCashSub: 'entrou − saiu',
    toReceive: 'Ainda a receber',
    toPay: 'Ainda a pagar',
    aiTitle: 'IA do caixa',
    aiHint: 'Pergunte o que cobrar, o que pagar e o que vence esta semana.',
    aiPlaceholder: 'Ex: o que vence esta semana?',
    aiAsk: 'Perguntar',
    aiChipWeek: 'O que vence esta semana?',
    aiChipCollect: 'O que cobrar dos bares?',
    aiChipPay: 'O que pagar aos fornecedores?',
    aiChipWhy: 'Por que o caixa está negativo?',
    aiSummary: 'Caixa agora {net}. Já entrou {in}. Já saiu {out}. Falta receber {receive}. Falta pagar {pay}.',
    aiAskHint: 'Pergunte: o que vence, o que cobrar ou o que pagar.',
    aiNoWeek: 'Nada vence nos próximos 7 dias.',
    aiNoCollect: 'Não há fatura atrasada para cobrar.',
    aiNoPay: 'Não há conta atrasada de fornecedor.',
    agendaAddTitle: 'Colocar na agenda',
    agendaAddSub: 'Reunião, cobrança e pagamento no mesmo calendário.',
    agendaPlaceholder: 'Ex: cobrar Atomic, pagar Le Vin, reunião…',
    agendaKindIn: 'Cobrar',
    agendaKindOut: 'Pagar',
    agendaKindOther: 'Outro',
    agendaSave: 'Adicionar',
    agendaNote: 'Agenda',
    calendarDays: ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'],
  },
}

export const LANGS = {
  pt: { id: 'pt', label: 'Português', htmlLang: 'pt', dict: pt, optional: false },
  en: { id: 'en', label: 'English', htmlLang: 'en', dict: en, optional: false },
  ja: { id: 'ja', label: '日本語', htmlLang: 'ja', dict: ja, optional: true },
}

export const DEFAULT_LANG = 'pt'

function loadLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved && LANGS[saved]) return saved
  } catch { /* ignore */ }
  try {
    const nav = String(navigator.language || '').toLowerCase()
    if (nav.startsWith('ja')) return 'ja'
    if (nav.startsWith('en')) return 'en'
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
