import { createClient } from '@supabase/supabase-js'
import { fixAtomicReceivables, revertAtomicPedidosToJune } from './_atomicJuneFix.js'
import { isSupplierVenda } from './_supplierVenda.js'
import { requireStaff, requireStaffOrTrustedOrigin } from './_requireStaff.js'
import { drinksAdminClient } from './_supabaseAdmin.js'

const BUCKET = 'system-private'
const HOLDING_FILE = 'jbm_holding.json'
const HOLDING_KEY_FILE = 'holding_service_role_key.txt'
const CASHFLOW_FILE = 'cashflow_snapshot.json'
const HOLDING_URL = process.env.HOLDING_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'

async function resolveHoldingKey(sb) {
  if (process.env.HOLDING_SERVICE_ROLE_KEY) return process.env.HOLDING_SERVICE_ROLE_KEY
  try {
    const { data } = await sb.storage.from(BUCKET).download(HOLDING_KEY_FILE)
    if (data) return (await data.text()).trim()
  } catch { /* */ }
  return null
}

async function pushToJbmMaster(sb, payload) {
  const holdingKey = await resolveHoldingKey(sb)
  if (!holdingKey) return { pushed: false, reason: 'holding key not registered' }

  const holdingSb = createClient(HOLDING_URL, holdingKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: buckets } = await holdingSb.storage.listBuckets()
  if (!buckets?.some(b => b.name === BUCKET)) {
    await holdingSb.storage.createBucket(BUCKET, { public: false })
  }
  const snapshot = {
    ...payload,
    geradoEm: new Date().toISOString(),
    fonte: 'bebidas-control-holding-audit',
    destino: 'jbm-master',
  }
  const { error } = await holdingSb.storage.from(BUCKET).upload(CASHFLOW_FILE, JSON.stringify(snapshot, null, 2), {
    upsert: true,
    contentType: 'application/json',
  })
  if (error) throw error
  return { pushed: true, financeiro: snapshot.financeiro }
}

const ATOMIC_BAR_ID = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'
const LM_FORN_ID = '499916d4-75c8-4fa9-b5da-05407739f8c3'
const FELICITY_FORN_ID = '75aae5fb-9058-4be0-a7b9-2af098def50a'

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const sb = drinksAdminClient()
      const auth = await requireStaff(req, sb)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })

      const holdingKey = req.body?.holdingKey?.trim()
      if (!holdingKey) return res.status(400).json({ error: 'holdingKey required' })

      const holdingSb = createClient(HOLDING_URL, holdingKey, { auth: { autoRefreshToken: false, persistSession: false } })
      const { data: buckets } = await holdingSb.storage.listBuckets()
      if (!buckets?.some(b => b.name === BUCKET)) {
        await holdingSb.storage.createBucket(BUCKET, { public: false })
      }
      const ping = JSON.stringify({ ok: true, at: new Date().toISOString() })
      const { error: pingErr } = await holdingSb.storage.from(BUCKET).upload('sync_ping.json', ping, { upsert: true, contentType: 'application/json' })
      if (pingErr) return res.status(400).json({ error: 'Chave inválida: ' + pingErr.message })

      const { data: dbuckets } = await sb.storage.listBuckets()
      if (!dbuckets?.some(b => b.name === BUCKET)) {
        await sb.storage.createBucket(BUCKET, { public: false })
      }
      const { error } = await sb.storage.from(BUCKET).upload(HOLDING_KEY_FILE, holdingKey, { upsert: true, contentType: 'text/plain' })
      if (error) throw error

      return res.status(200).json({ ok: true, message: 'Chave registrada. Use GET ?pushHolding=1 para sincronizar.' })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

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
      const debt = Number(req.query.debt || 465000)
      const fix = await fixAtomicReceivables(sb)
      const { data: faturas } = await sb.from('faturas').select('valor,total,pago,status').eq('bar_id', ATOMIC_BAR_ID).neq('status', 'pago')
      const aReceber = (faturas || []).reduce((a, f) => a + Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0)), 0)
      return res.status(200).json({ ok: true, fix, aReceber })
    }

    let holding = { nome: 'JBM Holding', negocios: [] }
    try {
      const { data } = await sb.storage.from(BUCKET).download(HOLDING_FILE)
      if (data) holding = JSON.parse(await data.text())
    } catch { /* default */ }

    const [bars, produtos, vendas, comprasRecent, comprasAll, faturas, pedidos, fornecedores, perfis, barPricing, fpLm, fpFel] = await Promise.all([
      sb.from('bars').select('id,nome'),
      sb.from('produtos').select('id', { count: 'exact' }).eq('ativo', true),
      sb.from('vendas').select('total,obs,cast_id,data,bar_id').order('data', { ascending: false }).limit(100),
      sb.from('compras').select('total_real,total_pago,status_pagamento,data,fornecedor,pagamento').order('data', { ascending: false }).limit(50),
      sb.from('compras').select('total_real,total_pago,status_pagamento,data'),
      sb.from('faturas').select('valor,total,pago,status,data_vencimento,bar_id'),
      sb.from('pedidos').select('status,total_estimado').limit(30),
      sb.from('fornecedores').select('nome,pagamento,pontos_pct'),
      sb.from('perfis').select('role'),
      sb.from('bar_pricing').select('bar_id', { count: 'exact', head: true }),
      sb.from('fornecedor_precos').select('id', { count: 'exact', head: true }).eq('fornecedor_id', LM_FORN_ID),
      sb.from('fornecedor_precos').select('id', { count: 'exact', head: true }).eq('fornecedor_id', FELICITY_FORN_ID),
    ])

    const vendasSupplier = (vendas.data || []).filter(isSupplierVenda)
    const comprasData = comprasAll.data || []
    const mes = new Date().toISOString().slice(0, 7)
    const receitaMes = vendasSupplier.filter(v => v.data?.startsWith(mes)).reduce((a, v) => a + (+v.total || 0), 0)
    const custoMes = comprasData.filter(c => c.data?.startsWith(mes)).reduce((a, c) => a + (+c.total_real || +c.total_pago || 0), 0)

    const faturasData = faturas.data || []
    const paidIn = faturasData.filter(f => f.status === 'pago').reduce((a, f) => a + (+f.valor || +f.total || 0), 0)
    const paidOut = comprasData.filter(c => c.status_pagamento === 'pago' || !c.status_pagamento).reduce((a, c) => a + (+c.total_real || +c.total_pago || 0), 0)
    const aReceber = faturasData.filter(f => f.status !== 'pago').reduce((a, f) => a + Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0)), 0)
    const atomicAReceber = faturasData
      .filter(f => f.bar_id === ATOMIC_BAR_ID && f.status !== 'pago')
      .reduce((a, f) => a + Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0)), 0)
    const supplierPrices = {
      liquorMountain: fpLm.count || 0,
      felicity: fpFel.count || 0,
    }

    const today = new Date().toISOString().slice(0, 10)
    const faturasVencidas = faturasData.filter(f => f.status !== 'pago' && f.data_vencimento < today).length

    const checks = [
      { ok: (bars.data || []).length > 0, label: 'Bars', detail: String((bars.data || []).length) },
      { ok: (produtos.data || []).length > 0, label: 'Produtos', detail: String(produtos.data?.length ?? 0) },
      { ok: (vendas.data || []).filter(v => !isSupplierVenda(v)).length === 0, label: 'POS separado', detail: 'OK' },
      { ok: faturasData.length > 0, label: 'Faturas', detail: String(faturasData.length) },
      { ok: (barPricing.count || 0) >= 10, label: 'Preços POS', detail: String(barPricing.count || 0) },
      { ok: paidIn + aReceber >= paidOut, label: 'Caixa', detail: `¥${paidIn - paidOut} (projetado ¥${paidIn + aReceber - paidOut})` },
    ]

    const payload = {
      geradoEm: new Date().toISOString(),
      holding,
      financeiro: { receitaMes, custoMes, caixaLiquido: paidIn - paidOut, aReceber, atomicAReceber, faturasVencidas },
      supplierPrices,
      operacao: {
        entregas: vendasSupplier.length,
        pedidosAtivos: (pedidos.data || []).filter(p => p.status === 'pendente' || p.status === 'confirmado').length,
        fornecedores: (fornecedores.data || []).length,
      },
      checks,
      checksOk: checks.filter(c => c.ok).length,
      checksTotal: checks.length,
      geminiReady: true,
    }

    if (req.query.pushHolding === '1' || req.query.sync === '1') {
      const push = await pushToJbmMaster(sb, payload)
      return res.status(200).json({ ...payload, jbmMaster: push })
    }

    return res.status(200).json(payload)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
