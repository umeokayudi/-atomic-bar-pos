import { createContext, useContext, useEffect, useState } from 'react'

const THEME_KEY = 'jbm_drinks_theme'
const LAYOUT_KEY = 'jbm_drinks_layout'

/** Igual JBM Holding: classic = escuro, modern = claro */
export const THEMES = { classic: 'classic', modern: 'modern' }
export const LAYOUTS = { auto: 'auto', desktop: 'desktop', tablet: 'tablet', mobile: 'mobile' }

function detectDevice() {
  if (typeof window === 'undefined') return { device: 'desktop', pointer: 'fine', orientation: 'landscape' }
  const w = window.innerWidth
  const device = w < 768 ? 'phone' : w < 1280 ? 'tablet' : 'desktop'
  const pointer = window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'
  const orientation = window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape'
  return { device, pointer, orientation }
}

function applyDeviceAttrs() {
  const { device, pointer, orientation } = detectDevice()
  document.documentElement.setAttribute('data-device', device)
  document.documentElement.setAttribute('data-pointer', pointer)
  document.documentElement.setAttribute('data-orientation', orientation)
}

function loadTheme() {
  const t = localStorage.getItem(THEME_KEY)
  if (t === 'dark' || t === 'classic') return THEMES.classic
  if (t === 'light' || t === 'modern') return THEMES.modern
  return THEMES.modern
}

const UiPrefsContext = createContext({
  theme: THEMES.modern,
  layout: LAYOUTS.auto,
  setTheme: () => {},
  setLayout: () => {},
  toggleTheme: () => {},
})

export function UiPrefsProvider({ children }) {
  const [theme, setThemeState] = useState(loadTheme)
  const [layout, setLayoutState] = useState(() => localStorage.getItem(LAYOUT_KEY) || LAYOUTS.auto)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-layout', layout)
    localStorage.setItem(LAYOUT_KEY, layout)
  }, [layout])

  useEffect(() => {
    applyDeviceAttrs()
    const onChange = () => applyDeviceAttrs()
    window.addEventListener('resize', onChange)
    window.addEventListener('orientationchange', onChange)
    const mq = window.matchMedia('(pointer: coarse)')
    mq.addEventListener?.('change', onChange)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('orientationchange', onChange)
      mq.removeEventListener?.('change', onChange)
    }
  }, [])

  function setTheme(t) {
    setThemeState(t === THEMES.classic ? THEMES.classic : THEMES.modern)
  }

  function toggleTheme() {
    setThemeState(t => t === THEMES.modern ? THEMES.classic : THEMES.modern)
  }

  function setLayout(l) {
    setLayoutState(Object.values(LAYOUTS).includes(l) ? l : LAYOUTS.auto)
  }

  return (
    <UiPrefsContext.Provider value={{ theme, layout, setTheme, setLayout, toggleTheme }}>
      {children}
    </UiPrefsContext.Provider>
  )
}

export function useUiPrefs() {
  return useContext(UiPrefsContext)
}
