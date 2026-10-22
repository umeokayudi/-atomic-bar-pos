/**
 * Voiding a till sale. A void never edits or deletes the sale: it adds a mirror row with negative money
 * (same night, payment, staff and agent lines), so every report that sums pos_vendas.total drops the sale,
 * and the original row stays as the record. Only the owner or a manager may void (screen and database).
 */
import { saleCardFee } from './nightClose.js'

export const VOID_TAG = 'Void of'
const VOIDED_RE = /^Voided:/im

export function isVoidRow(sale) {
  return Math.round(+sale?.total || 0) < 0 || new RegExp(`^${VOID_TAG}\\b`, 'im').test(String(sale?.obs || ''))
}

export function isVoided(sale) {
  return VOIDED_RE.test(String(sale?.obs || ''))
}

export function canVoid(sale) {
  return !!sale?.id && Math.round(+sale.total || 0) > 0 && !isVoided(sale) && !isVoidRow(sale)
}

/** Obs of the original minus its card-fee line (the fee comes back through card_fee on the void row). */
function carriedObs(obs) {
  return String(obs || '').split('\n').filter(line => !/^CardFee:/i.test(line.trim())).join('\n').trim()
}

/**
 * @returns {{ voidRow: object, originalPatch: object }}
 */
export function buildVoid(sale, { reason, byName, byId, now = new Date() }) {
  const why = String(reason || '').trim()
  if (!why) throw new Error('reason required')
  if (!canVoid(sale)) throw new Error('sale cannot be voided')
  const neg = v => (v == null || v === '' ? v : -Math.round(+v || 0))
  const fee = saleCardFee(sale)
  const head = `${VOID_TAG} ${sale.id}: ${why} (${byName || 'manager'})`
  const voidRow = {
    bar_id: sale.bar_id,
    data: sale.data,
    subtotal: neg(sale.subtotal ?? sale.total),
    desconto_total: neg(sale.desconto_total ?? 0),
    total: neg(sale.total),
    metodo_pagamento: sale.metodo_pagamento,
    tipo: sale.tipo || null,
    drink_back_agent_id: sale.drink_back_agent_id || null,
    space_id: sale.space_id || null,
    guest_id: sale.guest_id || null,
    comissao_valor: neg(sale.comissao_valor ?? 0),
    card_fee: fee > 0 ? fee : 0,
    obs: [head, carriedObs(sale.obs)].filter(Boolean).join('\n'),
    idempotency_key: `void:${sale.id}`,
    criado_por: byId || null,
    criado_em: now.toISOString(),
  }
  const originalPatch = {
    obs: [String(sale.obs || '').trim(), `Voided: ${now.toISOString()} · ${why} (${byName || 'manager'})`].filter(Boolean).join('\n'),
  }
  return { voidRow, originalPatch }
}
