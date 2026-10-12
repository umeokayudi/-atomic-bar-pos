import { useCallback, useEffect, useRef, useState } from 'react'
import { drinksAuth } from './supabase'
import { useAuth } from '../components/Auth'

/**
 * Which chart type each person picked for each chart ("columns", "line", "donut"…).
 * Saved on this device at once and on the account (user_metadata.charts), like dashboard layouts.
 */

const KEY = 'jbm_chart_kinds'

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} }
}
function writeAll(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* private mode */ }
}

/** Pure: the kind to show, given what was saved and what this chart allows. */
export function pickKind(saved, kinds = [], fallback) {
  if (saved && kinds.includes(saved)) return saved
  if (fallback && kinds.includes(fallback)) return fallback
  return kinds[0]
}

export function useChartPref(id, fallback) {
  const { user } = useAuth()
  const [pref, setPref] = useState(() => readAll()[id] || null)
  const pulled = useRef(null)
  const timer = useRef(null)

  useEffect(() => {
    if (!user?.id || pulled.current === user.id) return
    pulled.current = user.id
    const remote = user.user_metadata?.charts?.[id]
    if (remote && !readAll()[id]) {
      writeAll({ ...readAll(), [id]: remote })
      setPref(remote)
    }
  }, [user?.id, id])

  useEffect(() => () => clearTimeout(timer.current), [])

  const save = useCallback(next => {
    const value = { ...(readAll()[id] || {}), ...next }
    writeAll({ ...readAll(), [id]: value })
    setPref(value)
    if (!user?.id) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const charts = { ...(user.user_metadata?.charts || {}), ...readAll() }
      drinksAuth.auth.updateUser({ data: { charts } }).catch(() => {})
    }, 800)
  }, [id, user])

  return [pref || { kind: fallback }, save]
}
