import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { drinksAuth } from './supabase'
import { useAuth } from '../components/Auth'
import { moveItem, resolveLayout, serializeLayout } from './dashboardLayoutCore'

export { moveItem, resolveLayout, serializeLayout }

/**
 * Per-person dashboard layout: which cards show, their order and width.
 * Saved on this device right away and on the Supabase account (user_metadata.dashboards[id]),
 * so it follows the person across devices. No table or migration needed.
 */

const storeKey = id => `jbm_dash_${id}`

function readLocal(id) {
  try { return JSON.parse(localStorage.getItem(storeKey(id)) || 'null') } catch { return null }
}

function writeLocal(id, layout) {
  try { localStorage.setItem(storeKey(id), JSON.stringify(layout)) } catch { /* private mode */ }
}

export function useDashboardLayout(id, widgets) {
  const { user } = useAuth()
  const [saved, setSaved] = useState(() => readLocal(id))
  const pulled = useRef(null)

  // On sign-in, adopt the account copy if this device has none or an older one.
  useEffect(() => {
    if (!user?.id || pulled.current === user.id) return
    pulled.current = user.id
    const remote = user.user_metadata?.dashboards?.[id]
    const local = readLocal(id)
    if (remote && (!local || (remote.at || 0) > (local.at || 0))) {
      writeLocal(id, remote)
      setSaved(remote)
    }
  }, [user?.id, id]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => resolveLayout(widgets, saved), [widgets, saved])

  const timer = useRef(null)
  const commit = useCallback(nextItems => {
    const layout = { ...serializeLayout(nextItems), at: Date.now() }
    writeLocal(id, layout)
    setSaved(layout)
    if (!user?.id) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const all = { ...(user.user_metadata?.dashboards || {}), [id]: layout }
      drinksAuth.auth.updateUser({ data: { dashboards: all } }).catch(() => {})
    }, 800)
  }, [id, user])

  useEffect(() => () => clearTimeout(timer.current), [])

  return {
    items,
    toggle: wid => commit(items.map(i => (i.id === wid ? { ...i, hidden: !i.hidden } : i))),
    setSize: (wid, size) => commit(items.map(i => (i.id === wid ? { ...i, size } : i))),
    move: (from, to) => commit(moveItem(items, from, to)),
    reset: () => commit(resolveLayout(widgets, null)),
  }
}
