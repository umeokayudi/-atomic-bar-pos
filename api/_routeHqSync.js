/** GET/POST /api/bar/hq-sync — gerente HQ. Read-only on JBM ledgers. */

import { tryDrinksAdminClient, createStaffUserClient } from './_supabaseAdmin.js'
import { handleCorsPreflight, setCorsHeaders } from './_cors.js'
import { requireBarAccount } from './_requireStaff.js'
import { buildHqSnapshot, saveHqRent, saveBarCost } from './_hqSnapshot.js'
import { errText } from '../src/lib/errText.js'

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res, 'GET, POST, OPTIONS')

  const admin = tryDrinksAdminClient()
  const auth = await requireBarAccount(req, admin, { roles: ['cliente', 'gerente'] })
  if (auth.error) return res.status(auth.status).json({ error: errText(auth.error, 'Unauthorized') })
  const db = admin || (auth.token ? createStaffUserClient(auth.token) : null)
  if (!db) return res.status(500).json({ error: 'Database client unavailable' })

  try {
    if (req.method === 'POST') {
      const body = bodyOf(req)
      if (body.rent && (body.rent.amount != null || body.rent.note != null)) {
        const saved = await saveHqRent(db, auth.perfil.bar_id, body.rent)
        if (!saved.ok) return res.status(400).json({ error: errText(saved.error, 'Rent save failed') })
      }
      if (body.cost) {
        const saved = await saveBarCost(db, auth.perfil.bar_id, body.cost)
        if (!saved.ok) return res.status(400).json({ error: errText(saved.error, 'Cost save failed') })
      }
    } else if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const month = req.method === 'GET'
      ? req.query?.month
      : (bodyOf(req).month || bodyOf(req).rent?.month_key)
    const snap = await buildHqSnapshot(db, auth.perfil.bar_id, auth.perfil.nome, month)
    return res.status(200).json(snap)
  } catch (e) {
    return res.status(500).json({ error: errText(e, 'HQ sync failed') })
  }
}
