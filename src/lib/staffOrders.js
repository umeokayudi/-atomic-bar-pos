/**
 * Orders from the owner/manager to staff, shown to staff as alerts.
 * Stored in `staff_orders` (sql/staff_orders.sql). Until that table exists, orders go to the existing
 * `notificacoes` table (tipo 'ordem'), so they still reach the person through the bell and the alert bar.
 */

export const PRIORITIES = ['normal', 'urgent']
export const NOTIF_TYPE = 'ordem'
const PRIORITY_TAG = '[!] '

export function isMissingTable(error) {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message || ''))
}

/** Orders a staff member still has to act on: urgent first, then the oldest. */
export function openForStaff(orders = []) {
  const rank = o => (o.prioridade === 'urgent' ? 0 : 1)
  return (orders || [])
    .filter(o => o.status === 'sent' || o.status === 'seen')
    .sort((a, b) => rank(a) - rank(b) || String(a.criado_em).localeCompare(String(b.criado_em)))
}

/** Counts for the manager's board. Overdue = not done and past its due time. */
export function orderStats(orders = [], now = Date.now()) {
  const out = { sent: 0, seen: 0, done: 0, overdue: 0, open: 0 }
  for (const o of orders || []) {
    if (o.status === 'cancelled') continue
    if (out[o.status] != null) out[o.status] += 1
    if (o.status !== 'done') {
      out.open += 1
      if (o.due_at && Date.parse(o.due_at) < now) out.overdue += 1
    }
  }
  return out
}

/** A notification row that stands in for an order while staff_orders is not installed. */
export function orderToNotification({ to, mensagem, prioridade = 'normal', fromNome = '', dueLabel = '' }) {
  const head = `${prioridade === 'urgent' ? PRIORITY_TAG : ''}${fromNome || ''}`.trim()
  return {
    user_id: to.id,
    tipo: NOTIF_TYPE,
    titulo: head || 'Order',
    mensagem: dueLabel ? `${mensagem} (${dueLabel})` : mensagem,
    lida: false,
  }
}

/** The other way round: show a fallback notification as an order in the staff alert bar. */
export function notificationToOrder(n) {
  const urgent = String(n.titulo || '').startsWith(PRIORITY_TAG)
  return {
    id: `n:${n.id}`,
    notifId: n.id,
    staff_id: n.user_id,
    from_nome: urgent ? String(n.titulo).slice(PRIORITY_TAG.length) : n.titulo,
    mensagem: n.mensagem,
    prioridade: urgent ? 'urgent' : 'normal',
    status: n.lida ? 'done' : 'sent',
    criado_em: n.criado_em || n.created_at,
  }
}

export async function ordersInstalled(sb, barId) {
  const { error } = await sb.from('staff_orders').select('id').eq('bar_id', barId).limit(1)
  if (!error) return true
  if (isMissingTable(error)) return false
  throw error
}

export async function listBarOrders(sb, barId, { limit = 100 } = {}) {
  const { data, error } = await sb.from('staff_orders').select('*').eq('bar_id', barId).order('criado_em', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

/** Open orders for the signed-in staff member, from staff_orders or, when it is missing, from the bell. */
export async function listMyOrders(sb, userId) {
  const r = await sb.from('staff_orders').select('*').eq('staff_id', userId).in('status', ['sent', 'seen']).order('criado_em').limit(30)
  if (!r.error) return { mode: 'orders', orders: openForStaff(r.data || []) }
  if (!isMissingTable(r.error)) throw r.error
  const n = await sb.from('notificacoes').select('*').eq('user_id', userId).eq('tipo', NOTIF_TYPE).eq('lida', false).order('criado_em').limit(30)
  if (n.error) throw n.error
  return { mode: 'notifications', orders: openForStaff((n.data || []).map(notificationToOrder)) }
}

export async function sendOrders(sb, { barId, installed, to = [], mensagem, prioridade = 'normal', dueAt = null, fromId = null, fromNome = '', dueLabel = '' }) {
  const text = String(mensagem || '').trim().slice(0, 500)
  if (!text || !to.length) return { sent: 0 }
  if (installed) {
    const rows = to.map(p => ({
      bar_id: barId, staff_id: p.id, staff_nome: p.nome || null, from_id: fromId, from_nome: fromNome || null,
      mensagem: text, prioridade, due_at: dueAt || null,
    }))
    const { error } = await sb.from('staff_orders').insert(rows)
    if (error) throw error
    return { sent: rows.length, mode: 'orders' }
  }
  const rows = to.map(p => orderToNotification({ to: p, mensagem: text, prioridade, fromNome, dueLabel }))
  const { error } = await sb.from('notificacoes').insert(rows)
  if (error) throw error
  return { sent: rows.length, mode: 'notifications' }
}

/** Staff: mark an order as seen or done. Fallback notifications only know read/unread, so both close it. */
export async function setOrderStatus(sb, order, status) {
  if (order.notifId) {
    const { error } = await sb.from('notificacoes').update({ lida: true }).eq('id', order.notifId)
    if (error) throw error
    return
  }
  const patch = { status }
  if (status === 'seen') patch.seen_at = new Date().toISOString()
  if (status === 'done') patch.done_at = new Date().toISOString()
  const { error } = await sb.from('staff_orders').update(patch).eq('id', order.id)
  if (error) throw error
}

export async function cancelOrder(sb, id) {
  const { error } = await sb.from('staff_orders').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw error
}
