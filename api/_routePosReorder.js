/** Webhook de reposição automática quando estoque POS atinge mínimo */

import { requireBarAccount, requireStaff } from './_requireStaff.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })

  const barAuth = await requireBarAccount(req)
  if (barAuth.error) {
    const staffAuth = await requireStaff(req)
    if (staffAuth.error) return res.status(barAuth.status || 401).json({ error: barAuth.error })
  }

  const webhookUrl = process.env.POS_REORDER_WEBHOOK_URL || process.env.MAKE_WEBHOOK_URL
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})

  if (!body.bar_id || !Array.isArray(body.items) || !body.items.length) {
    return res.status(400).json({ error: 'bar_id and items are required' })
  }

  if (barAuth && !barAuth.error && barAuth.perfil?.bar_id && barAuth.perfil.bar_id !== body.bar_id) {
    return res.status(403).json({ error: 'bar_id does not match this account' })
  }

  const payload = {
    event: 'pos_reorder_alert',
    timestamp: new Date().toISOString(),
    bar_id: body.bar_id,
    bar_nome: body.bar_nome || '',
    pedido_id: body.pedido_id || null,
    items: body.items,
  }

  if (!webhookUrl) {
    return res.status(200).json({ ok: true, webhook: 'skipped', reason: 'POS_REORDER_WEBHOOK_URL not configured', payload })
  }

  try {
    const whRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await whRes.text().catch(() => '')
    return res.status(200).json({ ok: true, webhook: 'sent', status: whRes.status, response: text.slice(0, 500) })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
