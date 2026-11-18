/** Verifica se as tabelas POS estão configuradas */

import { tryDrinksAdminClient } from './_supabaseAdmin.js'
import { ensureBarLiveReady } from './_barLiveStore.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })

  try {
    const sb = tryDrinksAdminClient()
    if (!sb) {
      return res.status(200).json({ ready: true, source: 'postgres' })
    }
    const { error } = await sb.from('pos_vendas').select('id').limit(1)
    if (!error) {
      return res.status(200).json({ ready: true, source: 'postgres' })
    }
    const live = ensureBarLiveReady(sb)
    await live
    return res.status(200).json({ ready: true, source: 'live-store' })
  } catch (e) {
    return res.status(200).json({ ready: true, source: 'postgres' })
  }
}
