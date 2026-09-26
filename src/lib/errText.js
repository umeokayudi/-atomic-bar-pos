/** Turn API / PostgREST errors into a string React can render. */
export function errText(v, fallback = '') {
  if (v == null || v === '') return fallback
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Error) return errText(v.message, v.name || fallback)
  if (typeof v === 'object') {
    const nested = errText(v.message, '') || errText(v.error, '') || errText(v.hint, '') || errText(v.details, '') || errText(v.code, '')
    if (nested) return nested
    try {
      const json = JSON.stringify(v)
      if (json && json !== '{}' && json !== '[]') return json.slice(0, 280)
    } catch { /* circular */ }
    return fallback
  }
  return fallback || String(v)
}

/** Values that are safe to put in JSX text nodes. */
export function asReactText(v, fallback = '') {
  if (v == null || v === false) return fallback
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return errText(v, fallback)
}
