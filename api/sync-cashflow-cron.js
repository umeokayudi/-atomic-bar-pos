/**
 * Cron: sync cashflow bebidas-control → jbm-master Supabase.
 * Protected by CRON_SECRET or Vercel cron header.
 */
import { createClient } from '@supabase/supabase-js'
import { drinksAdminClient } from './_supabaseAdmin.js'
import { buildLiveSnapshot } from './_cashflowSnapshot.js'

const HOLDING_URL = process.env.HOLDING_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const BUCKET = 'system-private'
const FILE = 'cashflow_snapshot.json'
const KEY_FILE = 'holding_service_role_key.txt'

async function resolveHoldingKey() {
  if (process.env.HOLDING_SERVICE_ROLE_KEY) return process.env.HOLDING_SERVICE_ROLE_KEY
  try {
    const sb = drinksAdminClient()
    const { data } = await sb.storage.from(BUCKET).download(KEY_FILE)
    if (data) return (await data.text()).trim()
  } catch { /* */ }
  return null
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.authorization || ''
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
  if (secret && auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!secret && !isVercelCron && process.env.VERCEL === '1') {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const holdingKey = await resolveHoldingKey()
    if (!holdingKey) {
      return res.status(500).json({ error: 'HOLDING_SERVICE_ROLE_KEY missing — run scripts/set-holding-sync-secret.mjs' })
    }

    const sb = drinksAdminClient()
    const snapshot = {
      ...(await buildLiveSnapshot(sb)),
      fonte: 'bebidas-control-cron',
      destino: 'jbm-master',
      geradoEm: new Date().toISOString(),
    }

    const holdingSb = createClient(HOLDING_URL, holdingKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: buckets } = await holdingSb.storage.listBuckets()
    if (!buckets?.some(b => b.name === BUCKET)) {
      await holdingSb.storage.createBucket(BUCKET, { public: false })
    }

    const { error } = await holdingSb.storage.from(BUCKET).upload(FILE, JSON.stringify(snapshot, null, 2), {
      upsert: true,
      contentType: 'application/json',
    })
    if (error) throw error

    return res.status(200).json({
      ok: true,
      geradoEm: snapshot.geradoEm,
      financeiro: snapshot.financeiro,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
