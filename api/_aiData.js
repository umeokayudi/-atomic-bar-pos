/**
 * Facts the AI may use, loaded with the caller's own Supabase session (RLS decides what they can read).
 * Each module returns small aggregates, the period and the source tables, never raw personal data.
 * A missing table is reported as a limitation instead of failing the answer.
 */

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST200'])

export const AI_MODULES = ['overview', 'sales', 'stock', 'supply', 'finance', 'team', 'crm', 'marketing', 'consulting', 'reports', 'floor']

/** Calendar day in Tokyo (the bars and the till use Tokyo dates in pos_vendas.data). */
function iso(d) {
  return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10)
}

function addDays(key, n) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

/** today / yesterday / this week (Mon→) / this month keys in Tokyo. */
export function dayKeys(now = new Date()) {
  const today = iso(now)
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
  return { today, yesterday: addDays(today, -1), weekStart: addDays(today, -dow), monthStart: `${today.slice(0, 7)}-01` }
}

/** Revenue and count per Tokyo day, newest first. */
function byDay(rows, dateKey = 'data') {
  const map = new Map()
  for (const r of rows) {
    const d = String(r[dateKey] || '').slice(0, 10)
    if (!d) continue
    const cur = map.get(d) || { date: d, revenue: 0, count: 0 }
    cur.revenue += +r.total || 0
    cur.count += 1
    map.set(d, cur)
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map(x => ({ ...x, revenue: Math.round(x.revenue) }))
}

function windowTotals(rows, k, dateKey = 'data') {
  const pick = test => {
    const list = rows.filter(r => test(String(r[dateKey] || '').slice(0, 10)))
    return { revenue: Math.round(list.reduce((a, r) => a + (+r.total || 0), 0)), count: list.length }
  }
  return {
    today: { date: k.today, ...pick(d => d === k.today) },
    yesterday: { date: k.yesterday, ...pick(d => d === k.yesterday) },
    thisWeek: { from: k.weekStart, ...pick(d => d >= k.weekStart && d <= k.today) },
    thisMonth: { from: k.monthStart, ...pick(d => d >= k.monthStart && d <= k.today) },
  }
}

export function periodBounds(days = 30, now = new Date()) {
  const n = Math.min(366, Math.max(1, Math.round(+days || 30)))
  const k = dayKeys(now)
  const to = k.today
  // Always cover the whole current month so "this month" can be answered whatever the chosen period.
  const from = [addDays(to, -(n - 1)), k.monthStart].sort()[0]
  const prevTo = addDays(addDays(to, -(n - 1)), -1)
  const prevFrom = addDays(prevTo, -(n - 1))
  return { days: n, from: addDays(to, -(n - 1)), to, prevFrom, prevTo, loadFrom: from, keys: k }
}

async function safe(query) {
  try {
    const { data, error } = await query
    if (error) return { rows: [], missing: MISSING.has(error.code), error: error.message }
    return { rows: data || [] }
  } catch (e) {
    return { rows: [], error: e.message }
  }
}

const sum = (rows, key) => rows.reduce((a, r) => a + (+r[key] || 0), 0)
const round = n => Math.round(n)

function topBy(rows, keyFn, valFn, n = 8) {
  const map = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!k) continue
    map.set(k, (map.get(k) || 0) + valFn(r))
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, value: round(v) }))
}

/** Bar POS sales (pos_vendas) for the period and the previous one. */
async function posSales(db, barFilter, p) {
  const [all, prev, items] = await Promise.all([
    safe(barFilter(db.from('pos_vendas').select('id,total,data,criado_em,metodo_pagamento,bar_id').gte('data', p.loadFrom).lte('data', p.to).limit(8000))),
    safe(barFilter(db.from('pos_vendas').select('total').gte('data', p.prevFrom).lte('data', p.prevTo).limit(5000))),
    safe(barFilter(db.from('pos_vendas_itens').select('nome,qtd,preco_unitario,pos_vendas!inner(bar_id,data)'), 'pos_vendas.bar_id')
      .gte('pos_vendas.data', p.from).lte('pos_vendas.data', p.to).limit(8000)),
  ])
  if (all.missing) return { limitation: 'Bar till sales are not available yet.' }
  const cur = { rows: all.rows.filter(r => r.data >= p.from) }
  const itemValue = r => (+r.qtd || 0) * (+r.preco_unitario || 0)
  const todayItems = items.rows.filter(r => r.pos_vendas?.data === p.keys.today)
  const byHour = new Array(24).fill(0)
  for (const r of cur.rows) {
    const h = new Date(new Date(r.criado_em).getTime() + 9 * 3600000).getUTCHours()
    byHour[h] += +r.total || 0
  }
  const revenue = sum(cur.rows, 'total')
  return {
    source: 'bar till sales',
    ...windowTotals(all.rows, p.keys),
    topProductsToday: topBy(todayItems, r => r.nome, itemValue, 8),
    byDay: byDay(cur.rows).slice(0, 62),
    revenue: round(revenue),
    sales: cur.rows.length,
    avgTicket: cur.rows.length ? round(revenue / cur.rows.length) : 0,
    previousRevenue: round(sum(prev.rows, 'total')),
    byMethod: topBy(cur.rows, r => r.metodo_pagamento || 'other', r => +r.total || 0),
    topProducts: topBy(items.rows, r => r.nome, itemValue, 10),
    revenueByHourTokyo: byHour.map((v, h) => ({ h, v: round(v) })).filter(x => x.v > 0),
  }
}

/** JBM drinks supply sales to bars (vendas) and invoices. */
async function supplySales(db, barFilter, p) {
  const [all, prev] = await Promise.all([
    safe(barFilter(db.from('vendas').select('total,data,bar_id,bars(nome)').gte('data', p.loadFrom).lte('data', p.to).limit(5000))),
    safe(barFilter(db.from('vendas').select('total').gte('data', p.prevFrom).lte('data', p.prevTo).limit(5000))),
  ])
  const cur = { rows: all.rows.filter(r => r.data >= p.from) }
  return {
    source: 'JBM drinks delivered to bars',
    ...windowTotals(all.rows, p.keys),
    byDay: byDay(cur.rows).slice(0, 62),
    revenue: round(sum(cur.rows, 'total')),
    deliveries: cur.rows.length,
    previousRevenue: round(sum(prev.rows, 'total')),
    byBar: topBy(cur.rows, r => r.bars?.nome || r.bar_id, r => +r.total || 0),
  }
}

async function stock(db, barFilter) {
  const [prods, rules] = await Promise.all([
    safe(db.from('produtos').select('id,nome,categoria,estoque_atual,estoque_minimo,ativo').eq('ativo', true).limit(600)),
    safe(barFilter(db.from('estoque_regras').select('produto_id,minimo,bar_id').limit(2000))),
  ])
  const low = prods.rows
    .filter(r => r.estoque_minimo != null && r.estoque_atual != null && +r.estoque_atual <= +r.estoque_minimo)
    .slice(0, 20)
    .map(r => ({ name: r.nome, onHand: +r.estoque_atual, min: +r.estoque_minimo }))
  return {
    source: 'produtos (estoque_atual/estoque_minimo), estoque_regras',
    activeProducts: prods.rows.length,
    barRules: rules.rows.length,
    belowMinimum: low,
    note: 'Bar-level on-hand comes from estoque_movimentos and is not summed here to keep the answer fast.',
  }
}

async function supply(db, barFilter, p) {
  const [orders, purchases, prices] = await Promise.all([
    safe(barFilter(db.from('pedidos').select('status,data_pedido,total_estimado,bar_id,bars(nome)').gte('data_pedido', p.from).limit(2000))),
    safe(db.from('compras').select('fornecedor,total_real,total_pago,status_pagamento,data').gte('data', p.from).lte('data', p.to).limit(2000)),
    safe(db.from('fornecedor_precos').select('preco,produtos(nome),fornecedores(nome)').limit(400)),
  ])
  const byProduct = new Map()
  for (const r of prices.rows) {
    const name = r.produtos?.nome
    if (!name) continue
    const list = byProduct.get(name) || []
    list.push({ supplier: r.fornecedores?.nome, price: +r.preco })
    byProduct.set(name, list)
  }
  const spreads = [...byProduct.entries()]
    .filter(([, l]) => l.length > 1)
    .map(([name, l]) => {
      const s = [...l].sort((a, b) => a.price - b.price)
      return { product: name, cheapest: s[0], dearest: s[s.length - 1], gap: round(s[s.length - 1].price - s[0].price) }
    })
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 10)
  return {
    source: 'pedidos, compras, fornecedor_precos',
    ordersByStatus: topBy(orders.rows, r => r.status, () => 1),
    purchasesTotal: round(sum(purchases.rows, 'total_real')),
    purchasesUnpaid: round(purchases.rows.filter(r => r.status_pagamento !== 'pago').reduce((a, r) => a + (+r.total_real || 0) - (+r.total_pago || 0), 0)),
    bySupplier: topBy(purchases.rows, r => r.fornecedor, r => +r.total_real || 0),
    priceSpreads: spreads,
  }
}

async function finance(db, barFilter, p) {
  const inv = await safe(barFilter(db.from('faturas').select('total,valor,pago,status,data_vencimento,vencimento,bar_id,bars(nome)').limit(2000)))
  const today = iso(new Date())
  const open = inv.rows.filter(r => !['pago', 'paga', 'paid'].includes(r.status))
  const due = r => r.vencimento || r.data_vencimento
  const owed = r => Math.max(0, (+r.total || +r.valor || 0) - (+r.pago || 0))
  const cash = await safe(db.from('caixa_movimentos').select('tipo,valor,data').gte('data', p.from).lte('data', p.to).limit(5000))
  const inflow = cash.rows.filter(r => /entrada|in|receita/i.test(r.tipo || '')).reduce((a, r) => a + (+r.valor || 0), 0)
  const outflow = cash.rows.filter(r => !/entrada|in|receita/i.test(r.tipo || '')).reduce((a, r) => a + (+r.valor || 0), 0)
  const purchases = await safe(db.from('compras').select('total_real,total_pago,status_pagamento,data_pagamento').gte('data', p.from).lte('data', p.to).limit(2000))
  return {
    source: 'faturas (receivable), compras (payable), caixa_movimentos',
    receivableOpen: round(open.reduce((a, r) => a + owed(r), 0)),
    receivableOverdue: round(open.filter(r => due(r) && due(r) < today).reduce((a, r) => a + owed(r), 0)),
    overdueByBar: topBy(open.filter(r => due(r) && due(r) < today), r => r.bars?.nome || r.bar_id, owed),
    payableOpen: round(purchases.rows.filter(r => r.status_pagamento !== 'pago').reduce((a, r) => a + (+r.total_real || 0) - (+r.total_pago || 0), 0)),
    cashIn: round(inflow),
    cashOut: round(outflow),
    cashMovements: cash.rows.length,
  }
}

async function team(db, barFilter) {
  const people = await safe(barFilter(db.from('perfis').select('role,bar_id').limit(2000)))
  const clock = await safe(barFilter(db.from('time_clock').select('id,bar_id').limit(1)))
  return {
    source: 'perfis' + (clock.missing ? '' : ', time_clock'),
    accountsByRole: topBy(people.rows, r => r.role, () => 1),
    limitation: clock.missing ? 'Hours and attendance are not available yet.' : undefined,
  }
}

async function floor(db, barFilter) {
  const tabs = await safe(barFilter(db.from('pos_comandas').select('status,aberta_em,mesa_nome').in('status', ['open', 'awaiting_payment']).limit(500)))
  if (tabs.missing) return { limitation: 'Open tabs are not available yet.' }
  return { source: 'pos_comandas', openTabs: tabs.rows.length, tables: tabs.rows.map(r => r.mesa_nome).filter(Boolean).slice(0, 30) }
}

async function growth(db, barFilter, p, kind) {
  const table = kind === 'marketing' ? 'marketing_campaigns' : kind === 'consulting' ? 'consulting_plans' : 'bar_guests'
  const res = await safe(barFilter(db.from(table).select('*').limit(200)))
  if (res.missing) return { limitation: `${kind === 'marketing' ? 'Campaigns' : kind === 'consulting' ? 'Consulting plans' : 'Guest list'} not available yet.` }
  return { source: table, rows: res.rows.length, sample: res.rows.slice(0, 15).map(r => ({ nome: r.nome || r.titulo, status: r.status })) }
}

/**
 * @param db Supabase client bound to the user's JWT
 * @param opts { module, days, barId (null = all bars the user can read), scope }
 */
export async function loadAnalysisPack(db, { module = 'overview', days = 30, barId = null } = {}) {
  const p = periodBounds(days)
  const barFilter = (q, col = 'bar_id') => (barId ? q.eq(col, barId) : q)
  const want = new Set(module === 'overview' || module === 'reports' || module === 'consulting'
    ? ['sales', 'supplySales', 'finance', 'stock', 'supply', 'floor']
    : module === 'sales' ? ['sales', 'supplySales', 'floor']
      : module === 'stock' ? ['stock', 'supply', 'sales']
        : module === 'supply' ? ['supply', 'stock', 'supplySales']
          : module === 'finance' ? ['finance', 'sales', 'supplySales']
            : module === 'team' ? ['team', 'sales']
              : module === 'floor' ? ['floor', 'sales']
                : ['sales', 'finance'])
  const out = { period: { from: p.from, to: p.to, days: p.days, today: p.keys.today, previous: { from: p.prevFrom, to: p.prevTo } }, scope: barId ? 'one bar' : 'all bars visible to this user', facts: {}, limitations: [] }
  const jobs = []
  if (want.has('sales')) jobs.push(['barTillSales', posSales(db, barFilter, p)])
  if (want.has('supplySales')) jobs.push(['jbmSupplySales', supplySales(db, barFilter, p)])
  if (want.has('stock')) jobs.push(['stock', stock(db, barFilter)])
  if (want.has('supply')) jobs.push(['purchasing', supply(db, barFilter, p)])
  if (want.has('finance')) jobs.push(['finance', finance(db, barFilter, p)])
  if (want.has('team')) jobs.push(['team', team(db, barFilter)])
  if (want.has('floor')) jobs.push(['floor', floor(db, barFilter)])
  if (['crm', 'marketing', 'consulting'].includes(module)) jobs.push([module, growth(db, barFilter, p, module)])
  const settled = await Promise.all(jobs.map(([, j]) => j))
  jobs.forEach(([name], i) => {
    const val = settled[i]
    if (val?.limitation) out.limitations.push(val.limitation)
    out.facts[name] = val
  })
  return out
}

export function analysisPrompt(pack) {
  return `ANALYSIS DATA (read with the user's own permissions; amounts in JPY; today is ${pack.period.today} in Tokyo; main period ${pack.period.from} → ${pack.period.to}, previous ${pack.period.previous.from} → ${pack.period.previous.to}; scope: ${pack.scope}):
${JSON.stringify(pack.facts).slice(0, 16000)}
NOT AVAILABLE: ${pack.limitations.join(' | ') || 'nothing'}

HOW TO READ IT:
- barTillSales = what the bar sold at the till. today / yesterday / thisWeek / thisMonth are ready totals; byDay has every day (newest first); topProductsToday is today's best sellers.
- jbmSupplySales = drinks JBM delivered to bars (not the bar's own sales).
- A day with no entry in byDay had no sales (¥0).

ANSWER RULES:
- Answer the question in the first sentence with the number (e.g. "Hoje o bar vendeu ¥12.300 em 5 vendas."). Then at most 2-3 short lines of useful context (e.g. compare with yesterday). No long reports unless asked.
- "Hoje/today/今日" = today's totals above; "ontem" = yesterday; "esta semana" = thisWeek; "este mês" = thisMonth; a specific date = that day in byDay. If today has no sales, say clearly that nothing was sold today (¥0) so far.
- Only use these numbers; never invent a value. If something truly is not in the data, say so in one short sentence and give the closest number you have.
- Plain language for a bar owner: never mention table or column names, JSON keys, "fonte", "source", "Fato", "Fact", "Estimate" or similar labels.
- Write amounts as ¥12.300 (pt) / ¥12,300 (en, ja).
- Never claim you did something unless it appears as a confirmed action.`
}
