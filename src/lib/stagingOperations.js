/** Staging command contract. The browser role, bar, and total are ignored. No database client is opened. */

import { RUNTIME } from './supabaseTarget.js'
import { commit } from './operationalTransactions.js'

export const STAGING_COMMANDS = [
  'pos-sale',
  'cash-payment',
  'cash-movement',
  'cash-close',
  'clock',
  'purchase-request',
  'supplier-status',
  'stock-receipt',
  'discount',
]

function denied(status, code, error) {
  return { status, body: { ok: false, code, error, executed: false } }
}

export function acceptStagingCommand(body = {}, ctx = {}, store) {
  if (ctx.runtime?.runtime !== RUNTIME.STAGING) {
    return denied(503, 'MODE', 'This command is refused outside isolated staging. The local demo was not changed.')
  }
  if (!store) return denied(503, 'STAGING_NOT_CONNECTED', 'No staging writer is connected.')
  if (ctx.originTrusted || ctx.service) return denied(403, 'UNAUTHORIZED', 'Origin trust and service tokens cannot authorize a financial command.')
  const role = ctx.perfil?.role
  const actorBarId = ctx.perfil?.bar_id
  if (!role || !ctx.user?.id) return denied(401, 'UNAUTHORIZED', 'A signed-in profile is required.')
  if (!STAGING_COMMANDS.includes(body.type)) return denied(400, 'UNKNOWN', 'The command is not part of the staging contract.')
  if (body.role && body.role !== role) return denied(403, 'UNAUTHORIZED', 'The browser role does not match the server profile.')

  const command = {
    type: body.type,
    role,
    actorId: ctx.user.id,
    actorBarId,
    barId: role === 'admin' && body.barId ? body.barId : actorBarId,
    idempotencyKey: body.idempotencyKey,
    lines: body.lines,
    method: body.method,
    saleId: body.saleId,
    direction: body.direction,
    amount: body.amount,
    counted: body.counted,
    tipo: body.tipo,
    orderId: body.orderId,
    status: body.status,
    rate: body.rate,
  }
  const result = commit(store, command)
  return { status: result.ok ? 200 : 409, body: result }
}
