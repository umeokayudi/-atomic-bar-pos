import { requireStaff } from '../_requireStaff.js'
import { drinksAdminClient } from '../_supabaseAdmin.js'
import holdingModules from '../_routeHoldingModules.js'
import holdingAudit from '../_routeHoldingAudit.js'
import cashflowExport from '../_routeCashflowExport.js'

const BUCKET = 'system-private'
const FILE = 'jbm_holding.json'

const DEFAULT_HOLDING = {
  nome: 'JBM Holding',
  custoOportunidadeBasePct: 28,
  capitalDisponivel: 0,
  regraCapital: '',
  negocios: [],
}

function routeFn(req) {
  const parts = req.query?.fn
  if (Array.isArray(parts) && parts.length) return parts.join('/')
  if (typeof parts === 'string' && parts) return parts
  const q = req.query?.route
  if (q) return String(q)
  return 'holding'
}

export default async function handler(req, res) {
  const fn = routeFn(req)
  if (fn === 'holding-modules') return holdingModules(req, res)
  if (fn === 'holding-audit') return holdingAudit(req, res)
  if (fn === 'cashflow-export') return cashflowExport(req, res)

  try {
    const sb = drinksAdminClient()
    const auth = await requireStaff(req, sb)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })

    if (req.method === 'GET') {
      const { data, error } = await sb.storage.from(BUCKET).download(FILE)
      if (error || !data) {
        return res.status(200).json({ profile: DEFAULT_HOLDING })
      }
      const text = await data.text()
      return res.status(200).json({ profile: JSON.parse(text) })
    }

    if (req.method === 'POST') {
      const profile = req.body?.profile
      if (!profile?.nome) {
        return res.status(400).json({ error: 'Invalid profile' })
      }
      const { data: buckets } = await sb.storage.listBuckets()
      if (!buckets?.some(b => b.name === BUCKET)) {
        await sb.storage.createBucket(BUCKET, { public: false })
      }
      const { error } = await sb.storage.from(BUCKET).upload(FILE, JSON.stringify(profile), {
        upsert: true,
        contentType: 'application/json',
      })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
