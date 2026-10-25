/** One month of the bar's costs next to what the till took in. */

import { commissionOf, tenderOf } from './barClose.js'
import { costCategoryOf, costEmoji } from './costCategories.js'

const round = v => Math.round(+v || 0)

function inMonth(row, monthKey) {
  // Fixed costs repeat every month; variable ones (and power) belong to the month they were saved for.
  if (row.kind === 'variavel' || row.kind === 'energia' || (row.kind === 'outro' && row.recorrente === false)) {
    return !row.month_key || row.month_key === monthKey
  }
  return true
}

/**
 * Lines sorted by amount, biggest first. JBM drinks, wages and rent are always listed (even at ¥0)
 * so the owner sees what is missing; everything else only when it costs something.
 */
export function buildCostOverview({ registry = [], hq = null, books = null, monthKey } = {}) {
  const b = books || hq?.books || {}
  const tickets = hq?.pos?.tickets || []
  const till = round(b.pos?.amount ?? hq?.pos?.till)
  const rows = (registry || []).filter(r => inMonth(r, monthKey))
  const lines = []
  const push = line => lines.push({ ...line, amount: round(line.amount) })

  push({ id: 'jbm', group: 'jbm', emoji: '🍾', labelKey: 'jbm', amount: b.jbm?.amount, always: true })
  push({ id: 'wages', group: 'wages', emoji: '👥', labelKey: 'wages', amount: b.staff?.amount ?? (hq?.payroll || []).reduce((a, r) => a + (+r.pay || 0), 0), hours: +hq?.hoursTotal || 0, always: true })

  const rentRows = rows.filter(r => r.kind === 'aluguel')
  const rentReg = rentRows.reduce((a, r) => a + round(r.amount), 0)
  push({ id: 'rent', group: 'rent', emoji: costEmoji('rent'), labelKey: 'rent', amount: rentReg || b.rent?.amount || hq?.rent?.amount, always: true })

  for (const r of rows) {
    if (!['energia', 'fixo', 'variavel', 'outro', 'contador', 'imposto'].includes(r.kind)) continue
    const amount = r.kind === 'imposto' ? round(r.amount) + Math.round(till * (+r.pct || 0) / 100) : round(r.amount)
    if (!amount) continue
    const category = costCategoryOf(r)
    const group = r.kind === 'energia' ? 'power'
      : r.kind === 'contador' ? 'accountant'
      : r.kind === 'imposto' ? 'tax'
      : (r.kind === 'variavel' || (r.kind === 'outro' && r.recorrente === false)) ? 'variable' : 'fixed'
    push({
      id: `reg-${r.id}`,
      group,
      emoji: r.kind === 'contador' ? '🧮' : r.kind === 'imposto' ? '🏛️' : costEmoji(category),
      name: r.nome || '',
      category,
      amount,
    })
  }

  const cardRate = Math.max(0, ...(registry || []).filter(r => r.kind === 'cartao').map(r => +r.pct || 0))
  const fee = Math.round(tenderOf(tickets).card * cardRate / 100)
  if (fee) push({ id: 'card', group: 'card', emoji: '💳', labelKey: 'cardFees', amount: fee, pct: cardRate })
  const commission = round(commissionOf(tickets))
  if (commission) push({ id: 'drinkBack', group: 'drinkBack', emoji: '🥂', labelKey: 'drinkBack', amount: commission })

  const shown = lines.filter(l => l.always || l.amount > 0).sort((x, y) => y.amount - x.amount)
  const costs = shown.reduce((a, l) => a + l.amount, 0)
  const max = Math.max(1, ...shown.map(l => l.amount))
  return {
    till,
    tickets: +hq?.pos?.salesCount || tickets.length,
    costs,
    result: till - costs,
    costShare: till > 0 ? Math.round(costs / till * 100) : null,
    lines: shown.map(l => ({ ...l, share: costs > 0 ? Math.round(l.amount / costs * 100) : 0, bar: Math.round(l.amount / max * 100) })),
    missingRent: !shown.find(l => l.id === 'rent')?.amount,
  }
}
