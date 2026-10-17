import { createContext, useContext, useEffect, useState } from 'react'

const THEME_KEY = 'jbm_drinks_theme'
const LAYOUT_KEY = 'jbm_drinks_layout'

/** classic = dark, modern = light (attribute values kept for compatibility). "system" follows the OS. */
export const THEMES = { classic: 'classic', modern: 'modern' }
export const THEME_PREFS = { light: 'modern', dark: 'classic', system: 'system' }
export const LAYOUTS = { auto: 'auto', desktop: 'desktop', tablet: 'tablet', mobile: 'mobile' }

function detectDevice() {
  if (typeof window === 'undefined') return { device: 'desktop', pointer: 'fine', orientation: 'landscape' }
  const w = window.innerWidth
  const h = window.innerHeight
  const screenShort = Math.min(window.screen?.width || w, window.screen?.height || h)
  const pointer = window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'
  const orientation = h >= w ? 'portrait' : 'landscape'
  // Phones stay phones in landscape. Width alone was treating them as tablets.
  const phone = screenShort <= 700 || (pointer === 'coarse' && Math.min(w, h) <= 520)
  const device = phone ? 'phone' : (w < 1280 || pointer === 'coarse' ? 'tablet' : 'desktop')
  return { device, pointer, orientation }
}

function layoutFromDevice(device) {
  if (device === 'phone') return LAYOUTS.mobile
  if (device === 'tablet') return LAYOUTS.tablet
  return LAYOUTS.desktop
}

function applyDeviceAttrs() {
  const { device, pointer, orientation } = detectDevice()
  const layout = layoutFromDevice(device)
  document.documentElement.setAttribute('data-device', device)
  document.documentElement.setAttribute('data-pointer', pointer)
  document.documentElement.setAttribute('data-orientation', orientation)
  document.documentElement.setAttribute('data-layout', layout)
  try { localStorage.removeItem(LAYOUT_KEY) } catch { /* ignore */ }
  return layout
}

export function normalizeThemePref(t) {
  if (t === 'dark' || t === 'classic') return THEME_PREFS.dark
  if (t === 'light' || t === 'modern') return THEME_PREFS.light
  return THEME_PREFS.system
}

function systemDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}

export function resolveTheme(pref) {
  const p = normalizeThemePref(pref)
  if (p === THEME_PREFS.system) return systemDark() ? THEMES.classic : THEMES.modern
  return p
}

function loadThemePref() {
  try { return normalizeThemePref(localStorage.getItem(THEME_KEY)) } catch { return THEME_PREFS.system }
}

const UiPrefsContext = createContext({
  theme: THEMES.modern,
  themePref: THEME_PREFS.system,
  layout: LAYOUTS.desktop,
  device: 'desktop',
  setTheme: () => {},
  setThemePref: () => {},
  toggleTheme: () => {},
})

export function UiPrefsProvider({ children }) {
  const [themePref, setThemePrefState] = useState(loadThemePref)
  const [theme, setThemeState] = useState(() => resolveTheme(loadThemePref()))
  const [layout, setLayoutState] = useState(() => {
    if (typeof window === 'undefined') return LAYOUTS.desktop
    return layoutFromDevice(detectDevice().device)
  })
  const [device, setDevice] = useState(() => (typeof window === 'undefined' ? 'desktop' : detectDevice().device))

  useEffect(() => {
    setThemeState(resolveTheme(themePref))
    try { localStorage.setItem(THEME_KEY, themePref) } catch { /* private mode */ }
    if (themePref !== THEME_PREFS.system) return undefined
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => setThemeState(resolveTheme(THEME_PREFS.system))
    mq?.addEventListener?.('change', onChange)
    return () => mq?.removeEventListener?.('change', onChange)
  }, [themePref])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === THEMES.classic ? '#101B19' : '#F4F7F5')
  }, [theme])

  useEffect(() => {
    let last = ''
    let frame = 0
    const onChange = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const snap = detectDevice()
        const nextLayout = layoutFromDevice(snap.device)
        const sig = `${snap.device}|${snap.pointer}|${snap.orientation}|${nextLayout}`
        if (sig === last) return
        last = sig
        applyDeviceAttrs()
        setDevice(snap.device)
        setLayoutState(nextLayout)
      })
    }
    onChange()
    window.addEventListener('resize', onChange)
    window.addEventListener('orientationchange', onChange)
    const mq = window.matchMedia('(pointer: coarse)')
    mq.addEventListener?.('change', onChange)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onChange)
      window.removeEventListener('orientationchange', onChange)
      mq.removeEventListener?.('change', onChange)
    }
  }, [])

  function setThemePref(p) {
    setThemePrefState(normalizeThemePref(p))
  }

  function setTheme(t) {
    setThemePref(t === THEMES.classic ? THEME_PREFS.dark : THEME_PREFS.light)
  }

  function toggleTheme() {
    setThemePref(theme === THEMES.modern ? THEME_PREFS.dark : THEME_PREFS.light)
  }

  return (
    <UiPrefsContext.Provider value={{ theme, themePref, layout, device, setTheme, setThemePref, toggleTheme }}>
      {children}
    </UiPrefsContext.Provider>
  )
}

export function useUiPrefs() {
  return useContext(UiPrefsContext)
}
