/**
 * Muse (Meta Model API) — the provider for THINKING: analysis, answers and explanations.
 * Data filling (reading a receipt photo, turning an invoice PDF into rows) stays on Gemini (api/_gemini.js).
 *
 * Endpoint: POST https://api.meta.ai/v1/chat/completions (OpenAI-compatible), `Authorization: Bearer <key>`.
 * Key: Vercel env MUSE_API_KEY (MODEL_API_KEY, the name Meta's docs use, is accepted too). Never in code.
 * Model: MUSE_MODEL, default muse-spark-1.3. Never a "-contributor" id: those let Meta train on the content.
 */

const ENDPOINT = 'https://api.meta.ai/v1/chat/completions'
export const MUSE_DEFAULT_MODEL = 'muse-spark-1.3'

export function museKey() {
  return String(process.env.MUSE_API_KEY || process.env.MODEL_API_KEY || '').trim()
}

export function museConfigured() {
  return !!museKey()
}

export function museModel() {
  const m = String(process.env.MUSE_MODEL || '').trim()
  // Contributor mode shares the content for training: company money data must never go there.
  if (!m || /contributor/i.test(m)) return MUSE_DEFAULT_MODEL
  return m
}

/** Gemini request body ({ systemInstruction, contents, generationConfig }) → chat-completions body. Pure. */
export function geminiBodyToMuse(body = {}, model = MUSE_DEFAULT_MODEL) {
  const messages = []
  const sys = (body.systemInstruction?.parts || []).map(p => p.text).filter(Boolean).join('\n')
  if (sys) messages.push({ role: 'developer', content: sys })
  for (const c of body.contents || []) {
    const role = c.role === 'model' ? 'assistant' : 'user'
    const parts = c.parts || []
    const hasImage = role === 'user' && parts.some(p => p.inlineData?.data)
    if (hasImage) {
      messages.push({
        role,
        content: parts.map(p => p.inlineData?.data
          ? { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType || 'image/jpeg'};base64,${p.inlineData.data}` } }
          : { type: 'text', text: String(p.text || '') }).filter(p => p.type !== 'text' || p.text),
      })
    } else {
      const text = parts.map(p => p.text).filter(Boolean).join('\n')
      if (text) messages.push({ role, content: text })
    }
  }
  const out = { model, messages }
  const max = body.generationConfig?.maxOutputTokens
  if (max) out.max_completion_tokens = max
  return out
}

/** Chat-completions answer → the Gemini answer shape the rest of the app already reads. Pure. */
export function museToGeminiShape(data, model) {
  const text = data?.choices?.[0]?.message?.content
  return {
    candidates: [{ content: { parts: [{ text: typeof text === 'string' ? text : '' }] }, finishReason: data?.choices?.[0]?.finish_reason || '' }],
    provider: 'muse',
    model: data?.model || model,
  }
}

const RETRYABLE = new Set([429, 500, 503])

/** Same call shape as geminiGenerate(body); answers in the Gemini shape with provider:'muse'. */
export async function museGenerate(body, { fetchImpl = fetch, retries = 1 } = {}) {
  const key = museKey()
  if (!key) throw new Error('MUSE_API_KEY is not configured')
  const model = museModel()
  const payload = JSON.stringify(geminiBodyToMuse(body, model))
  let last = ''
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: payload,
    })
    const raw = await resp.text()
    if (resp.ok) {
      let data
      try { data = JSON.parse(raw) } catch { throw new Error('Invalid Muse response') }
      return museToGeminiShape(data, model)
    }
    let type = ''
    try { type = JSON.parse(raw)?.error?.type || '' } catch { /* empty body */ }
    // Never echo the body: it can repeat request content. Status and error type are enough to act on.
    last = `Muse API error ${resp.status}${type ? ` (${type})` : ''}`
    if (!RETRYABLE.has(resp.status) || attempt === retries) break
    await new Promise(r => setTimeout(r, 600 * (attempt + 1)))
  }
  throw new Error(last)
}
