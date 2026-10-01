export const PROTECTED_REFS = ['ojirgkqtqvugqktyuhem', 'fxsakrshmldmkdmbevna']

export function protectedRefIn(value) {
  const text = String(value || '')
  return PROTECTED_REFS.find(ref => text.includes(ref)) || ''
}

/** Local dev and tests never open the live Drinks or Holding projects. */
export function classifySupabaseTarget(env = {}) {
  const url = String(env.VITE_SUPABASE_URL || '').trim()
  const key = String(env.VITE_SUPABASE_ANON_KEY || '').trim()
  const blockedRef = protectedRefIn(url) || protectedRefIn(key)
  if (blockedRef) return { mode: 'blocked', blockedRef }
  if (!url || !key) return { mode: 'local' }
  return { mode: 'remote', url, key }
}
