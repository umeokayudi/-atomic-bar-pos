/**
 * Facts the AI may use, loaded with the caller's own Supabase session (RLS decides what they can read).
 * Each module returns small aggregates, the period and the source tables, never raw personal data.
 * A missing table is reported as a limitation instead of failing the answer.
 */

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST200'])

export const AI_MODULES = ['overview', 'sales', 'stock', 'supply', 'finance', 'team', 'crm', 'marketing', 'consulting', 'reports', 'floor']

function iso(d) {
  return d.toISOString().slice(0, 10)
}

export function periodBounds(days = 30, now = new Date()) {
  const n = Math.min(366, Math.max(1, Math.round(+days || 30)))
  const to = new Date(now)
  const from = new Date(now.getTime() - (n - 1) * 86400000)
  const prevTo = new Date(from.getTime() - 86400000)
  const prevFrom = new Date(prevTo.getTime() - (n - 1) * 86400000)
  return { days: n, from: iso(from), to: iso(to), prevFrom: iso(prevFrom), prevTo: iso(prevTo) }
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
  const cur = await safe(barFilter(db.from('pos_vendas').select('id,total,data,criado_em,metodo_pagamento,bar_id').gte('data', p.from).lte('data', p.to).limit(5000)))
  if (cur.missing) return { limitation: 'Bar till sales table (pos_vendas) is not set up in this database yet.' }
  const prev = await safe(barFilter(db.from('pos_vendas').select('total').gte('data', p.prevFrom).lte('data', p.prevTo).limit(5000)))
  const items = await safe(barFilter(db.from('pos_vendas_itens').select('nome,qtd,preco_unitario,pos_vendas!inner(bar_id,data)'), 'pos_vendas.bar_id')
    .gte('pos_vendas.data', p.from).lte('pos_vendas.data', p.to).limit(8000))
  const byHour = new Array(24).fill(0)
  for (const r of cur.rows) {
    const h = new Date(new Date(r.criado_em).getTime() + 9 * 3600000).getUTCHours()
    byHour[h] += +r.total || 0
  }
  const revenue = sum(cur.rows, 'total')
  return {
    source: 'pos_vendas, pos_vendas_itens',
    revenue: round(revenue),
    sales: cur.rows.length,
    avgTicket: cur.rows.length ? round(revenue / cur.rows.length) : 0,
    previousRevenue: round(sum(prev.rows, 'total')),
    byMethod: topBy(cur.rows, r => r.metodo_pagamento || 'other', r => +r.total || 0),
    topProducts: topBy(items.rows, r => r.nome, r => (+r.qtd || 0) * (+r.preco_unitario || 0), 10),
    revenueByHourTokyo: byHour.map((v, h) => ({ h, v: round(v) })).filter(x => x.v > 0),
  }
}

/** JBM drinks supply sales to bars (vendas) and invoices. */
async function supplySales(db, barFilter, p) {
  const cur = await safe(barFilter(db.from('vendas').select('total,data,bar_id,bars(nome)').gte('data', p.from).lte('data', p.to).limit(5000)))
  const prev = await safe(barFilter(db.from('vendas').select('total').gte('data', p.prevFrom).lte('data', p.prevTo).limit(5000)))
  return {
    source: 'vendas (JBM drinks delivered to bars)',
    revenue: round(sum(cur.rows, 'total')),
    deliveries: cur.rows.length,
    previousRevenue: round(sum(prev.rows, 'total')),
    byBar: topBy(cur.rows, r => r.bars?.nome || r.bar_id, r => +r.total || 0),
  }
}

async function stock(db, barFilter) {
  const prods = await safe(db.from('produtos').select('id,nome,categoria,estoque_atual,estoque_minimo,ativo').eq('ativo', true).limit(600))
  const rules = await safe(barFilter(db.from('estoque_regras').select('produto_id,minimo,bar_id').limit(2000)))
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
  const orders = await safe(barFilter(db.from('pedidos').select('status,data_pedido,total_estimado,bar_id,bars(nome)').gte('data_pedido', p.from).limit(2000)))
  const purchases = await safe(db.from('compras').select('fornecedor,total_real,total_pago,status_pagamento,data').gte('data', p.from).lte('data', p.to).limit(2000))
  const prices = await safe(db.from('fornecedor_precos').select('preco,produtos(nome),fornecedores(nome)').limit(400))
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
    limitation: clock.missing ? 'Time clock table is not set up in this database: hours and attendance are not available.' : undefined,
  }
}

async function floor(db, barFilter) {
  const tabs = await safe(barFilter(db.from('pos_comandas').select('status,aberta_em,mesa_nome').in('status', ['open', 'awaiting_payment']).limit(500)))
  if (tabs.missing) return { limitation: 'Server tabs (pos_comandas) are not set up yet.' }
  return { source: 'pos_comandas', openTabs: tabs.rows.length, tables: tabs.rows.map(r => r.mesa_nome).filter(Boolean).slice(0, 30) }
}

async function growth(db, barFilter, p, kind) {
  const table = kind === 'marketing' ? 'marketing_campaigns' : kind === 'consulting' ? 'consulting_plans' : 'bar_guests'
  const res = await safe(barFilter(db.from(table).select('*').limit(200)))
  if (res.missing) return { limitation: `${table} is not set up in this database yet.` }
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
  const out = { period: { from: p.from, to: p.to, days: p.days, previous: { from: p.prevFrom, to: p.prevTo } }, scope: barId ? 'one bar' : 'all bars visible to this user', facts: {}, limitations: [] }
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
  return `ANALYSIS DATA (read with the user's own permissions; amounts in JPY; period ${pack.period.from} → ${pack.period.to}, previous ${pack.period.previous.from} → ${pack.period.previous.to}; scope: ${pack.scope}):
${JSON.stringify(pack.facts).slice(0, 12000)}
LIMITATIONS: ${pack.limitations.join(' | ') || 'none'}

ANSWER RULES:
- Use only these numbers. If something needed is not here, say it is not available. Never invent a value.
- State the period and the source tables you used.
- Label each point as Fact (from data), Estimate (your calculation; show the formula) or Recommendation.
- Say which factors drove a conclusion. Say when data is too thin to conclude.
- Never claim you did something unless it appears as a confirmed action.`
}
