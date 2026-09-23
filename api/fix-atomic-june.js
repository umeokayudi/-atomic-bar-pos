import { fixAtomicReceivables, revertAtomicPedidosToJune, markPedidosEntregue, ATOMIC_BAR_ID } from './_atomicJuneFix.js'
import { fixVendaDatesFromPedidos, dedupePedidoVendas, syncMissingVendasFromPedidos, backfillVendaItensFromPedidos, fixSeikyushoCompraDates } from './_pedidoVendaFix.js'
import { drinksAdminClient } from './_supabaseAdmin.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Use POST',
      exemplo: { confirm: 'atomic-june-465000', action: 'fix' },
    })
  }

  const secret = process.env.FIX_ATOMIC_SECRET || 'jbm-atomic-june-2026'
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  if (body.confirm !== secret && body.confirm !== 'atomic-june-465000' && body.confirm !== 'atomic-pos-2026') {
    return res.status(403).json({ error: 'confirm inválido' })
  }

  try {
    const sb = drinksAdminClient()
    const action = body.action || 'fix'

    if (action === 'setupPos') {
      const { applyBarPosSql } = await import('./_applyBarSql.js')
      const result = await applyBarPosSql(body.dbPassword || body.password)
      if (result.ok) return res.status(200).json(result)
      const { ensureBarLiveReady } = await import('./_barLiveStore.js')
      const live = await ensureBarLiveReady(sb)
      return res.status(200).json({ ok: true, via: 'live-store', sql: result, live })
    }

    if (action === 'revertPedidos') {
      const revert = await revertAtomicPedidosToJune(sb)
      return res.status(200).json({ ok: true, revert })
    }

    if (action === 'fixVendaDates') {
      const fix = await fixVendaDatesFromPedidos(sb, { barId: body.barId || ATOMIC_BAR_ID })
      return res.status(200).json({ ok: true, fix })
    }

    if (action === 'markEntregue') {
      const entregue = await markPedidosEntregue(sb, {
        dateFrom: body.dateFrom || '2026-06-01',
        dateTo: body.dateTo || '2026-06-30',
        statusFrom: body.statusFrom || 'confirmado',
        barId: body.barId || ATOMIC_BAR_ID,
      })
      return res.status(200).json({ ok: true, entregue })
    }

    if (action === 'dedupeVendas') {
      const dedupe = await dedupePedidoVendas(sb, {
        barId: body.barId || ATOMIC_BAR_ID,
        dryRun: body.dryRun === true,
      })
      return res.status(200).json({ ok: true, dedupe })
    }

    if (action === 'reconcileSales') {
      const dedupe = await dedupePedidoVendas(sb, { barId: body.barId || ATOMIC_BAR_ID })
      const fix = await fixVendaDatesFromPedidos(sb, { barId: body.barId || ATOMIC_BAR_ID })
      return res.status(200).json({ ok: true, dedupe, fix })
    }

    if (action === 'resyncJuneVendas') {
      const { syncPedidosEntregues } = await import('./_deliveryMargin.js')
      const sync = await syncPedidosEntregues(sb, {
        barId: body.barId || ATOMIC_BAR_ID,
        dateFrom: body.dateFrom || '2026-06-01',
        dateTo: body.dateTo || '2026-06-30',
        statusIn: ['entregue', 'pendente', 'confirmado'],
      })
      return res.status(200).json({ ok: true, sync })
    }

    if (action === 'syncMissingVendas') {
      const sync = await syncMissingVendasFromPedidos(sb, {
        barId: body.barId || ATOMIC_BAR_ID,
      })
      const backfill = await backfillVendaItensFromPedidos(sb, {
        barId: body.barId || ATOMIC_BAR_ID,
      })
      return res.status(200).json({ ok: true, sync, backfill })
    }

    if (action === 'backfillVendaItens') {
      const backfill = await backfillVendaItensFromPedidos(sb, {
        barId: body.barId || ATOMIC_BAR_ID,
      })
      return res.status(200).json({ ok: true, backfill })
    }

    if (action === 'fixSeikyushoCompraDates') {
      const fix = await fixSeikyushoCompraDates(sb, {
        targetDate: body.targetDate || '2026-07-15',
      })
      const backfill = await backfillVendaItensFromPedidos(sb, { barId: body.barId || ATOMIC_BAR_ID })
      const dates = await fixVendaDatesFromPedidos(sb, { barId: body.barId || ATOMIC_BAR_ID })
      return res.status(200).json({ ok: true, fix, backfill, dates })
    }

    if (action === 'fix') {
      const result = await fixAtomicReceivables(sb)
      const { data: faturas } = await sb.from('faturas').select('valor,total,pago,status').eq('bar_id', ATOMIC_BAR_ID).neq('status', 'pago')
      const aReceber = (faturas || []).reduce((a, f) => a + Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0)), 0)
      return res.status(200).json({ ok: true, ...result, aReceber })
    }

    return res.status(400).json({
      error: 'action inválida',
      actions: ['fix', 'setupPos', 'revertPedidos', 'markEntregue', 'dedupeVendas', 'fixVendaDates', 'reconcileSales', 'resyncJuneVendas', 'syncMissingVendas', 'backfillVendaItens', 'fixSeikyushoCompraDates'],
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
