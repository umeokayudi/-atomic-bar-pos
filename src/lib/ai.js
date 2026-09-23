async function readApiJson(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: text?.slice(0, 200) || res.statusText || 'Resposta inválida do servidor' }
  }
}

export async function callGeminiChat({ messages, system, image, temperature, maxOutputTokens }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system, image, temperature, maxOutputTokens }),
  })
  const data = await readApiJson(res)
  if (!res.ok || data.error) return `Error: ${data.error || res.statusText}`
  return data.text || 'No response'
}

export function parseJsonFromAI(text) {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim()
  return JSON.parse(cleaned)
}

export function imageDataUrlToParts(dataUrl) {
  if (!dataUrl?.includes(',')) return null
  const [meta, data] = dataUrl.split(',')
  const mimeType = meta.split(';')[0].split(':')[1] || 'image/jpeg'
  return { mimeType, data }
}
