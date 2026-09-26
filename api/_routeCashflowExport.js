import { fixAtomicReceivables, revertAtomicPedidosToJune } from './_atomicJuneFix.js'
import { requireStaff, requireStaffOrTrustedOrigin } from './_requireStaff.js'
import { drinksAdminClient } from './_supabaseAdmin.js'
import { buildLiveSnapshot } from './_cashflowSnapshot.js'

const BUCKET = 'system-private'
const FILE = 'cashflow_snapshot.json'

const ALLOWED_ORIGINS = [
  'https://jbm-master.vercel.app',
  'https://bebidas-control.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

export default async function handler(req, res) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const sb = drinksAdminClient()

    if (req.query.revertPedidosJune === '1' || req.query.fixAtomicJune === '1') {
      const auth = await requireStaff(req, sb)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })
    } else {
      const auth = await requireStaffOrTrustedOrigin(req, sb)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })
    }

    if (req.query.revertPedidosJune === '1' && req.query.confirm === 'atomic-june-465000') {
      const revert = await revertAtomicPedidosToJune(sb)
      return res.status(200).json({ ok: true, revert })
    }

    if (req.query.fixAtomicJune === '1' && req.query.confirm === 'atomic-june-465000') {
      const fix = await fixAtomicReceivables(sb)
      const { data: faturas } = await sb.from('faturas').select('valor,total,pago,status').eq('bar_id', 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9').neq('status', 'pago')
      const aReceber = (faturas || []).reduce((a, f) => a + Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0)), 0)
      return res.status(200).json({ ok: true, fix, aReceber })
    }

    try {
      const { data } = await sb.storage.from(BUCKET).download(FILE)
      if (data) {
        const cached = JSON.parse(await data.text())
        const ageMs = Date.now() - new Date(cached.geradoEm).getTime()
        if (ageMs < 30 * 60 * 1000) {
          return res.status(200).json({ ...cached, cached: true, idadeMinutos: Math.round(ageMs / 60000) })
        }
      }
    } catch { /* compute live */ }

    const live = await buildLiveSnapshot(sb)
    return res.status(200).json({ ...live, cached: false })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
