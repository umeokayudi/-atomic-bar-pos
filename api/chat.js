import { setCorsHeaders, handleCorsPreflight } from './_cors.js'
import { geminiGenerate } from './_gemini.js'
import { requireStaffOrTrustedOrigin } from './_requireStaff.js'
import { drinksAdminClient } from './_supabaseAdmin.js'

function extractText(data) {
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''
}

function toGeminiContents(messages = []) {
  return messages
    .filter(m => m?.content)
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    }))
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res)

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const admin = drinksAdminClient()
    const auth = await requireStaffOrTrustedOrigin(req, admin)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})

    if (body.module === 'seikyusho') {
      const { handleSeikyushoRequest } = await import('./_seikyushoCore.js')
      return await handleSeikyushoRequest(res, body)
    }

    const { messages, system, image, temperature, maxOutputTokens } = body

    if (!messages?.length && !image?.data) {
      return res.status(400).json({ error: 'messages or image is required' })
    }

    const parts = []
    if (image?.data) {
      parts.push({
        inlineData: {
          mimeType: image.mimeType || 'image/jpeg',
          data: image.data,
        },
      })
    }

    const lastUser = [...(messages || [])].reverse().find(m => m.role === 'user')
    const text = lastUser?.content || messages?.[messages.length - 1]?.content || ''
    if (text) parts.push({ text: String(text) })

    const geminiBody = {
      contents: parts.length
        ? [{ role: 'user', parts }]
        : toGeminiContents(messages),
      generationConfig: {
        temperature: temperature ?? 0.7,
        maxOutputTokens: maxOutputTokens ?? 2048,
      },
    }

    if (system) {
      geminiBody.systemInstruction = { parts: [{ text: String(system) }] }
    } else if (messages?.length > 1 && !image?.data) {
      geminiBody.contents = toGeminiContents(messages)
    }

    const data = await geminiGenerate(geminiBody)
    return res.status(200).json({ text: extractText(data) })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
