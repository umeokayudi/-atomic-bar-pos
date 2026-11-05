import assert from 'node:assert/strict'
import { ryoshushoPeriodSplit } from '../src/lib/reportPeriod.js'
import { billChecks } from '../src/lib/billMatch.js'
import { notasWithAdjustment } from '../src/lib/money.js'
import { displayName, isArchivedOrTest } from '../src/lib/catalog.js'
import { payDateOff } from '../src/lib/costOverview.js'
import { barMonth } from '../src/lib/barFinanceHq.js'

// D7: a receipt for the last day of the month (30 Jun → 30 Jun) counts in June, not ¥0.
const ry = { total: 300000, periodo_inicio: '2026-06-30', periodo_fim: '2026-06-30', data_emissao: '2026-09-29' }
assert.equal(ryoshushoPeriodSplit(ry, '2026-06').share, 300000)
assert.equal(ryoshushoPeriodSplit({ ...ry, periodo_inicio: '2026-06-01' }, '2026-06').share, 300000)
assert.equal(ryoshushoPeriodSplit(ry, '2026-07').share, 0)

// June: deliveries ¥2,565,926 vs invoice ¥465,000. Without a recorded adjustment it is a mismatch, never "paid".
const notes = [{ data: '2026-06-15', total: 2565926 }]
const jun = { id: 'jun', total: 465000, pago: 300000, status: 'parcial', periodo_inicio: '2026-06-01', periodo_fim: '2026-06-30' }
const plain = billChecks({ notes, invoices: [jun] }).rows[0]
assert.equal(plain.status, 'off')
assert.equal(plain.delta, -2100926)
// With the adjustment saved on the invoice (amount + reason) the gap is explained, with its reason.
const adj = { ...jun, notas: notasWithAdjustment(null, { ajuste: -2100926, motivo: 'Paid before the system' }) }
const explained = billChecks({ notes, invoices: [adj] }).rows[0]
assert.equal(explained.status, 'adjusted')
assert.equal(explained.motivo, 'Paid before the system')
// A different adjustment does not hide the gap.
const wrong = { ...jun, notas: notasWithAdjustment(null, { ajuste: -100, motivo: 'x' }) }
assert.equal(billChecks({ notes, invoices: [wrong] }).rows[0].status, 'off')

// D14: names shown in analyses.
assert.equal(displayName('Orange Juice (dup)'), 'Orange Juice')
assert.equal(displayName('Cramberry Juice'), 'Cranberry Juice')
assert.equal(displayName('Jasmin Tea LM'), 'Jasmine Tea LM')
assert.equal(displayName('Malibu '), 'Malibu')
assert.equal(isArchivedOrTest({ nome: 'TESTE-MUSE', ativo: true }), true)

// D10: payment date a year off the cost month.
assert.ok(payDateOff({ data_pagamento: '2025-11-28', month_key: '2026-10' }) > 300)
assert.equal(payDateOff({ data_pagamento: '2026-11-05', month_key: '2026-10' }), 0)
assert.equal(payDateOff({ data_pagamento: '', month_key: '2026-10' }), 0)

// D9: each month counts only its own till sales.
const t = [
  { id: 'a', total: 6600, data: '2026-09-22', criado_em: '2026-09-22T08:44:03Z', obs: 'Night: 2026-09-22' },
  { id: 'b', total: 157000, data: '2026-10-24', criado_em: '2026-10-24T09:00:00Z', obs: 'Night: 2026-10-24' },
]
const pack = { hq: { mes: '2026-11', pos: { history: t, tickets: [] }, prev: { mes: '2026-10', pos: { tickets: [t[1]] } }, months: [] }, registry: [] }
assert.equal(barMonth(pack, '2026-08', '2026-11-05').money.sales, 0)
assert.equal(barMonth(pack, '2026-09', '2026-11-05').money.sales, 6600)
assert.equal(barMonth(pack, '2026-10', '2026-11-05').money.sales, 157000)

console.log('fixes1105 ok')
