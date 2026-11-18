/**
 * One door for every AI call, so the provider rule lives in one place:
 *  - purpose 'think' (analyse, answer, explain, propose actions) → Muse (Meta Model API)
 *  - purpose 'fill'  (read a photo/PDF into fields)              → Gemini
 * If Muse is not configured or fails, thinking falls back to Gemini and the answer says so
 * (`provider`, `fallback`), so nobody believes Muse answered when it did not.
 */
import { geminiGenerate } from './_gemini.js'
import { museConfigured, museGenerate } from './_muse.js'

export function providerFor(purpose) {
  return purpose === 'fill' ? 'gemini' : 'muse'
}

export async function aiGenerate(body, { purpose = 'think', deps = {} } = {}) {
  const gemini = deps.gemini || geminiGenerate
  const muse = deps.muse || museGenerate
  const configured = deps.museConfigured || museConfigured
  if (providerFor(purpose) === 'gemini') {
    const data = await gemini(body)
    return { ...data, provider: 'gemini' }
  }
  if (!configured()) {
    const data = await gemini(body)
    return { ...data, provider: 'gemini', fallback: 'muse_not_configured' }
  }
  try {
    return await muse(body)
  } catch (e) {
    const data = await gemini(body)
    return { ...data, provider: 'gemini', fallback: 'muse_failed', fallbackReason: String(e?.message || e).slice(0, 160) }
  }
}
