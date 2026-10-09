import { handleCorsPreflight, setCorsHeaders } from './_cors.js'
import { loginLane } from './_barLaneAuth.js'

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res, 'POST, OPTIONS')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })
  try {
    const { email, password } = bodyOf(req)
    const result = await loginLane(email, password)
    if (result.error) return res.status(result.status || 401).json({ error: result.error })
    return res.status(200).json(result)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
