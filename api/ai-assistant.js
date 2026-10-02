import { setCorsHeaders, handleCorsPreflight } from './_cors.js'
import { answerAssistantTurn, describeProvider } from '../src/lib/aiAssistant.js'

function readBody(req) {
  if (!req?.body) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}') } catch { return {} }
  }
  return req.body
}

async function generateWithGemini({ system, messages }) {
  const { geminiGenerate } = await import('./_gemini.js')
  const data = await geminiGenerate({
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
  })
  return data.candidates?.[0]?.content?.parts?.map(part => part.text).join('') || ''
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res)
  const provider = describeProvider()

  if (req.method === 'GET') {
    return res.status(200).json(provider)
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = readBody(req)
  const result = await answerAssistantTurn(body, {
    configured: provider.configured,
    generate: provider.configured && !body.demo ? generateWithGemini : async () => {
      throw new Error('Model generation was not permitted')
    },
  })
  return res.status(result.status).json(result.body)
}
