import assert from 'node:assert/strict'
import { analysisPrompt, dayKeys, loadAnalysisPack, periodBounds } from '../api/_aiData.js'

// 2026-10-25 00:30 in Tokyo is still 2026-10-24 in UTC: "today" must be the Tokyo day.
const late = new Date('2026-10-24T15:30:00Z')
assert.equal(dayKeys(late).today, '2026-10-25')
assert.equal(dayKeys(late).yesterday, '2026-10-24')
assert.equal(dayKeys(late).weekStart, '2026-10-19') // Monday
assert.equal(dayKeys(late).monthStart, '2026-10-01')

const p7 = periodBounds(7, late)
assert.equal(p7.to, '2026-10-25')
assert.equal(p7.from, '2026-10-19')
assert.equal(p7.prevTo, '2026-10-18')
assert.equal(p7.prevFrom, '2026-10-12')
assert.equal(p7.loadFrom, '2026-10-01') // whole month is loaded for "this month"

/** Tiny stand-in for the Supabase query builder: filters on gte/lte/eq over a column. */
function fakeDb(tables) {
  return {
    from(name) {
      let rows = [...(tables[name] || [])]
      const get = (r, col) => col.split('.').reduce((o, k) => o?.[k], r)
      const q = {
        select: () => q,
        gte: (c, v) => { rows = rows.filter(r => get(r, c) >= v); return q },
        lte: (c, v) => { rows = rows.filter(r => get(r, c) <= v); return q },
        eq: (c, v) => { rows = rows.filter(r => get(r, c) === v); return q },
        in: (c, v) => { rows = rows.filter(r => v.includes(get(r, c))); return q },
        limit: () => q,
        then: (res, rej) => (name in tables ? Promise.resolve({ data: rows, error: null }) : Promise.resolve({ data: null, error: { code: '42P01', message: 'missing' } })).then(res, rej),
      }
      return q
    },
  }
}

const today = dayKeys().today
const yesterday = dayKeys().yesterday
const BAR = '11111111-1111-4111-8111-111111111111'
const db = fakeDb({
  pos_vendas: [
    { id: 1, total: 5000, data: today, criado_em: new Date().toISOString(), metodo_pagamento: 'cash', bar_id: BAR },
    { id: 2, total: 7300, data: today, criado_em: new Date().toISOString(), metodo_pagamento: 'card', bar_id: BAR },
    { id: 3, total: 9000, data: yesterday, criado_em: new Date().toISOString(), metodo_pagamento: 'card', bar_id: BAR },
  ],
  pos_vendas_itens: [
    { nome: 'Jameson', qtd: 2, preco_unitario: 1500, pos_vendas: { bar_id: BAR, data: today } },
    { nome: 'Highball', qtd: 1, preco_unitario: 900, pos_vendas: { bar_id: BAR, data: yesterday } },
  ],
  vendas: [],
  faturas: [],
  caixa_movimentos: [],
  compras: [],
})

const pack = await loadAnalysisPack(db, { module: 'crm', days: 30, barId: BAR })
const s = pack.facts.barTillSales
assert.deepEqual(s.today, { date: today, revenue: 12300, count: 2 })
assert.deepEqual(s.yesterday, { date: yesterday, revenue: 9000, count: 1 })
assert.equal(s.byDay[0].date, today)
assert.equal(s.topProductsToday[0].name, 'Jameson')
assert.equal(pack.period.today, today)
// bar_guests is missing: reported in plain words, no table names.
assert.ok(pack.limitations.some(l => /Guest list/.test(l)))
assert.ok(!pack.limitations.join(' ').includes('bar_guests'))

const prompt = analysisPrompt(pack)
assert.match(prompt, /first sentence/)
assert.match(prompt, /never mention table or column names/)
assert.doesNotMatch(prompt, /Label each point as Fact/)

console.log('aiData tests passed')
