import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { drinksAuth } from './supabase'
import { useAuth } from '../components/Auth'

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

/** Pure merge of a saved layout with the current widget list (new widgets append, removed ones drop). */
export function resolveLayout(widgets, saved) {
  const known = new Map(widgets.map(w => [w.id, w]))
  const order = [...(saved?.order || []).filter(id => known.has(id))]
  for (const w of widgets) if (!order.includes(w.id)) order.push(w.id)
  const hidden = new Set(saved?.hidden ?? widgets.filter(w => w.defaultHidden).map(w => w.id))
  // A widget added after the layout was saved follows its own default.
  if (saved?.order) for (const w of widgets) if (!saved.order.includes(w.id) && w.defaultHidden) hidden.add(w.id)
  const sizes = saved?.sizes || {}
  return order.map(id => ({
    id,
    hidden: hidden.has(id),
    size: sizes[id] || known.get(id).size || 'full',
  }))
}

export function serializeLayout(items) {
  return {
    order: items.map(i => i.id),
    hidden: items.filter(i => i.hidden).map(i => i.id),
    sizes: Object.fromEntries(items.map(i => [i.id, i.size])),
  }
}

export function moveItem(items, from, to) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [it] = next.splice(from, 1)
  next.splice(to, 0, it)
  return next
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
