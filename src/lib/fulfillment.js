/** Drink-order fulfillment. Till, JBM invoice, wages and rent stay out. */

export const ORDER_STATUSES = [
  'draft', 'submitted', 'routing', 'supplier_pending', 'supplier_confirmed',
  'in_fulfillment', 'ready_for_delivery', 'in_transit', 'delivered',
  'partially_delivered', 'completed', 'cancelled', 'exception',
]

export const ASSIGNMENT_ACTIONS = [
  { id: 'accept', from: ['pending', 'issue'], event: 'accepted' },
  { id: 'reject', from: ['pending'], event: 'rejected' },
  { id: 'start_purchase', from: ['accepted'], event: 'purchasing' },
  { id: 'purchased', from: ['purchasing'], event: 'purchased' },
  { id: 'received', from: ['purchased'], event: 'received' },
  { id: 'preparing', from: ['received'], event: 'preparing' },
  { id: 'ready', from: ['preparing'], event: 'ready' },
  { id: 'in_transit', from: ['ready'], event: 'in_transit' },
  { id: 'partial', from: ['in_transit'], event: 'partial' },
  { id: 'delivered', from: ['in_transit', 'partial'], event: 'delivered' },
  { id: 'issue', from: ['pending', 'accepted', 'purchasing', 'purchased', 'received', 'preparing', 'ready', 'in_transit', 'partial'], event: 'issue' },
]

export const ISSUE_TYPES = [
  'out_of_stock', 'partial_availability', 'price_change', 'supplier_delay', 'transport_problem', 'other',
]

export const BAR_STEPS = [
  'submitted', 'routed', 'accepted', 'purchased', 'ready', 'in_transit', 'delivered', 'bar_confirmed',
]

export function nextAssignmentStatus(curr, action) {
  const row = ASSIGNMENT_ACTIONS.find(a => a.id === action)
  if (!row || !row.from.includes(curr)) {
    throw new Error(`invalid transition from ${curr} via ${action}`)
  }
  if (action === 'issue') return 'issue'
  if (action === 'accept') return 'accepted'
  if (action === 'reject') return 'rejected'
  if (action === 'start_purchase') return 'purchasing'
  if (action === 'purchased') return 'purchased'
  if (action === 'received') return 'received'
  if (action === 'preparing') return 'preparing'
  if (action === 'ready') return 'ready'
  if (action === 'in_transit') return 'in_transit'
  if (action === 'partial') return 'partial'
  if (action === 'delivered') return 'delivered'
  throw new Error(`invalid transition from ${curr} via ${action}`)
}

export function actionsFor(status) {
  return ASSIGNMENT_ACTIONS.filter(a => a.from.includes(status)).map(a => a.id)
}

export function stepState(events, step) {
  const types = new Set((events || []).map(e => e.event_type))
  if (step === 'routed' && (types.has('assigned') || types.has('routed'))) return 'done'
  if (step === 'bar_confirmed' && types.has('bar_confirmed')) return 'done'
  if (types.has(step)) return 'done'
  const order = BAR_STEPS
  const latest = order.reduce((acc, id) => (types.has(id) || (id === 'routed' && types.has('assigned')) ? id : acc), '')
  const latestAt = order.indexOf(latest)
  const at = order.indexOf(step)
  if (latestAt >= 0 && at === latestAt + 1) return 'now'
  return 'wait'
}

export function schemaMissing(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || error || '')
  return code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || /does not exist|schema cache|Could not find the function/i.test(msg)
}
