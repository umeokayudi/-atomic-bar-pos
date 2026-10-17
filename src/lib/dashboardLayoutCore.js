/** Pure helpers behind useDashboardLayout (no React, no Supabase), so they can be unit tested. */

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
