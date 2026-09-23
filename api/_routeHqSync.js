/** GET/POST /api/bar/hq-sync — gerente HQ. Read-only on JBM ledgers. */

import { drinksAdminClient } from './_supabaseAdmin.js'
import { handleCorsPreflight, setCorsHeaders } from './_cors.js'
import { requireBarAccount } from './_requireStaff.js'
import { buildHqSnapshot, saveHqRent } from './_hqSnapshot.js'

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res, 'GET, POST, OPTIONS')

  let admin
  try { admin = drinksAdminClient() } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  const auth = await requireBarAccount(req, admin, { roles: ['cliente', 'gerente'] })
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  try {
    if (req.method === 'POST') {
      const body = bodyOf(req)
      if (body.rent && (body.rent.amount != null || body.rent.note != null)) {
        const saved = await saveHqRent(admin, auth.perfil.bar_id, body.rent)
        if (!saved.ok) return res.status(400).json({ error: saved.error || 'Rent save failed' })
      }
    } else if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const month = req.method === 'GET'
      ? req.query?.month
      : (bodyOf(req).month || bodyOf(req).rent?.month_key)
    const snap = await buildHqSnapshot(admin, auth.perfil.bar_id, auth.perfil.nome, month)
    return res.status(200).json(snap)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
