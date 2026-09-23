/** Bar HQ snapshot. Reads JBM + POS live-store + clock + rent. Never writes vendas/pedidos/faturas. */

import { filterSupplierVendas } from './_supplierVenda.js'
import { filterJbmDrinksFaturas, faturaRemaining, faturaValor, faturaPago } from '../src/lib/barPortal.js'
import { payrollFromPunches } from '../src/lib/timeClock.js'
import { tokyoMonthKey, monthRange, recentMonthKeys } from '../src/lib/tokyo.js'
import { splitCostBooks, rentForMonth, lastKnownRent, splitOverhead } from '../src/lib/costBooks.js'
import { monthKeyOf, explainJbmGap, buildMonthSeries, invoiceOverlapsMonth, lowStockFromLedger } from '../src/lib/hqFilters.js'
import { coalesceStockMoves, deliveryNoteMoves, posPourMoves } from '../src/lib/barStock.js'
import {
  isMissingSchemaError,
  isMissingTableError,
  isMissingColumnError,
  columnFromPgError,
  runLiveOp,
  listStaffWithExtras,
  ensureBarLiveReady,
} from './_barLiveStore.js'

function source(ok, extra = {}) {
  return { ok: !!ok, at: new Date().toISOString(), ...extra }
}

async function pgOrLive(admin, table, filters, columns = '*') {
  const selectCols = columns
  let q = admin.from(table).select(selectCols)
  for (const f of filters || []) {
    if (f.op === 'eq') q = q.eq(f.k, f.v)
    else if (f.op === 'gte') q = q.gte(f.k, f.v)
    else if (f.op === 'lte') q = q.lte(f.k, f.v)
  }
  let pg = await q
  let cols = selectCols
  let guard = 0
  while (pg.error && isMissingColumnError(pg.error) && guard < 8) {
    const col = columnFromPgError(pg.error)
    if (!col || cols === '*') break
    cols = cols.split(',').map(s => s.trim()).filter(c => c && c !== col).join(',') || 'id'
    let retry = admin.from(table).select(cols)
    for (const f of filters || []) {
      if (f.op === 'eq') retry = retry.eq(f.k, f.v)
      else if (f.op === 'gte') retry = retry.gte(f.k, f.v)
      else if (f.op === 'lte') retry = retry.lte(f.k, f.v)
    }
    pg = await retry
    guard += 1
  }
  if (!pg.error) return { rows: pg.data || [], via: 'postgres', error: null }
  if (!isMissingTableError(pg.error) && !isMissingSchemaError(pg.error)) {
    return { rows: [], via: 'postgres', error: pg.error.message }
  }
  const live = await runLiveOp(admin, {
    table,
    mode: 'select',
    columns,
    filters,
  })
  if (live.error) return { rows: [], via: 'live-store', error: live.error.message }
  return { rows: live.data || [], via: 'live-store', error: null }
}

function monthBill(vendas, faturas, mes) {
  const supplier = filterSupplierVendas(vendas || [])
  const mesVendas = supplier.filter(v => String(v.data || '').startsWith(mes))
  const contaMes = mesVendas.reduce((a, v) => a + (+v.total || 0), 0)
  const drinksFaturas = filterJbmDrinksFaturas(faturas || [])
  const pending = drinksFaturas.filter(f => f.status !== 'pago')
  const overdue = pending.filter(f => {
    const venc = f.data_vencimento || f.periodo_fim
    return venc && new Date(venc) < new Date()
  })
  return {
    contaMes,
    deliveries: mesVendas.length,
    faturasPendentes: pending.length,
    faturasAtraso: overdue.length,
    totalPendente: pending.reduce((a, f) => a + faturaRemaining(f), 0),
    faturaPagaMes: drinksFaturas
      .filter(f => f.status === 'pago' && String(f.data_vencimento || f.periodo_fim || '').startsWith(mes))
      .reduce((a, f) => a + (faturaPago(f) || faturaValor(f)), 0),
    faturasResumo: drinksFaturas.slice(0, 6).map(f => ({
      status: f.status,
      total: faturaValor(f),
      pago: faturaPago(f),
      vencimento: f.data_vencimento || f.periodo_fim,
    })),
  }
}

export async function buildHqSnapshot(admin, barId, barNome = '', monthKey) {
  await ensureBarLiveReady(admin)
  const mes = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : tokyoMonthKey()
  const range = monthRange(`${mes}-01`)
  const monthKeys = recentMonthKeys(6)

  const [vendasR, pedR, fatR, posR, clockR, rentR, staff, regrasR, movR, prodR, itemR, posItemR, priceR] = await Promise.all([
    admin.from('vendas').select('id,data,data_venda,total,obs,bar_id,cast_id,criado_em').eq('bar_id', barId).order('data', { ascending: false }).limit(400),
    admin.from('pedidos').select('id,status,total_estimado,criado_em,obs').eq('bar_id', barId).order('criado_em', { ascending: false }).limit(200),
    admin.from('faturas').select('*').eq('bar_id', barId).order('data_vencimento', { ascending: false }).limit(24),
    pgOrLive(admin, 'pos_vendas', [{ op: 'eq', k: 'bar_id', v: barId }], 'id,total,data,obs,criado_em,metodo_pagamento,drink_back_agent_id'),
    pgOrLive(admin, 'time_clock', [
      { op: 'eq', k: 'bar_id', v: barId },
      { op: 'gte', k: 'punched_at', v: range.from },
      { op: 'lte', k: 'punched_at', v: range.to },
    ]),
    pgOrLive(admin, 'bar_overhead', [{ op: 'eq', k: 'bar_id', v: barId }]),
    listStaffWithExtras(admin, barId).catch(() => []),
    admin.from('estoque_regras').select('produto_id,minimo').eq('bar_id', barId).limit(400),
    admin.from('estoque_movimentos').select('produto_id,tipo,qtd').eq('bar_id', barId).limit(4000),
    admin.from('produtos').select('id,nome').limit(400),
    admin.from('vendas_itens').select('produto_id,qtd,venda_id').limit(5000),
    pgOrLive(admin, 'pos_vendas_itens', [], 'produto_id,nome,qtd,pos_venda_id'),
    admin.from('bar_pricing').select('produto_id,drinks_por_garrafa').eq('bar_id', barId).limit(400),
  ])

  const jbmOk = !vendasR.error && !fatR.error
  const supplier = filterSupplierVendas(vendasR.data || [])
  const jbm = monthBill(vendasR.data || [], fatR.data || [], mes)
  const pedidos = pedR.data || []
  const pedMes = pedidos.filter(p => monthKeyOf(p.criado_em) === mes)
  const posRows = [...(posR.rows || [])].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
  const posMonthRows = posRows.filter(s => monthKeyOf(s.data) === mes)
  const posMonthTotal = posMonthRows.reduce((a, s) => a + (+s.total || 0), 0)

  const payroll = payrollFromPunches(clockR.rows || [], staff || [], range)
  const staffMonthPay = payroll.reduce((a, r) => a + (+r.pay || 0), 0)
  const hoursTotal = payroll.reduce((a, r) => a + (+r.hours || 0), 0)

  const rentAmount = rentForMonth(rentR.rows || [], mes)
  const rentRow = (rentR.rows || []).find(r => r.kind === 'rent' && r.month_key === mes) || null
  const rentPrev = lastKnownRent(rentR.rows || [], mes)
  const supplierIds = new Set(supplier.map(v => v.id))
  const noteItems = (!itemR?.error ? (itemR.data || []) : []).filter(it => supplierIds.has(it.venda_id))
  const notesWithItems = supplier.map(v => ({
    ...v,
    vendas_itens: noteItems.filter(it => it.venda_id === v.id),
  }))
  const pricing = {}
  for (const r of priceR?.error ? [] : (priceR.data || [])) {
    if (r?.produto_id) pricing[r.produto_id] = { drinks_por_garrafa: +r.drinks_por_garrafa || 0 }
  }
  const posIds = new Set(posRows.map(s => s.id))
  const posItems = (posItemR?.rows || []).filter(it => !it.pos_venda_id || posIds.has(it.pos_venda_id))
  const stockMoves = coalesceStockMoves(
    movR.error ? [] : (movR.data || []),
    deliveryNoteMoves(notesWithItems),
    posPourMoves(posItems, pricing),
  )
  const estoqueBaixo = !regrasR.error
    ? lowStockFromLedger({
      regras: regrasR.data || [],
      movimentos: stockMoves,
      produtos: prodR.error ? [] : (prodR.data || []),
    }).slice(0, 8)
    : []

  const books = splitCostBooks({
    posMonthTotal,
    jbmMonthBill: jbm.contaMes,
    staffMonthPay,
    rentMonth: rentAmount,
  })

  const months = buildMonthSeries({
    keys: monthKeys,
    vendas: supplier,
    posRows,
    pedidos,
    rentRows: rentR.rows || [],
  })
  const gap = explainJbmGap({
    noteCount: jbm.deliveries,
    noteAmount: jbm.contaMes,
    orderCount: pedMes.length,
    orderAmount: pedMes.reduce((a, p) => a + (+p.total_estimado || 0), 0),
    monthKey: mes,
  })

  const drinksFaturas = filterJbmDrinksFaturas(fatR.data || [])
  const invoicesThisPeriod = drinksFaturas.filter(f => invoiceOverlapsMonth(f, mes))

  const mapPedido = p => ({
    id: p.id,
    status: p.status,
    total: p.total_estimado ?? p.total,
    criado: p.criado_em?.slice(0, 10),
    obs: String(p.obs || '').slice(0, 80),
  })
  const mapNote = v => ({
    id: v.id,
    data: v.data || v.data_venda,
    total: +v.total || 0,
    obs: String(v.obs || '').slice(0, 80),
  })

  const sources = {
    jbm: source(jbmOk, {
      via: 'postgres',
      vendas: supplier.length,
      vendasMes: jbm.deliveries,
      pedidos: pedR.error ? 0 : pedidos.length,
      pedidosMes: pedMes.length,
      faturas: drinksFaturas.length,
      error: [vendasR.error?.message, pedR.error?.message, fatR.error?.message].filter(Boolean).join(' | ') || null,
    }),
    pos: source(!posR.error, {
      via: posR.via,
      sales: posMonthRows.length,
      error: posR.error,
    }),
    clock: source(!clockR.error, {
      via: clockR.via,
      punches: (clockR.rows || []).length,
      error: clockR.error,
    }),
    rent: source(!rentR.error, {
      via: rentR.via,
      error: rentR.error,
    }),
    inventory: source(!regrasR.error && !movR.error, {
      via: 'postgres',
      regras: regrasR.error ? 0 : (regrasR.data || []).length,
      movimentos: movR.error ? 0 : (movR.data || []).length,
      low: estoqueBaixo.length,
      error: [regrasR.error?.message, movR.error?.message].filter(Boolean).join(' | ') || null,
    }),
  }

  const syncedAt = new Date().toISOString()
  try {
    await persistHqMeta(admin, barId, { last_sync: syncedAt, sources })
  } catch {
    // Snapshot still returns even if meta write is blocked.
  }

  return {
    bar: { id: barId, nome: barNome },
    mes,
    syncedAt,
    mixed: false,
    sources,
    books,
    payroll: payroll.map(r => ({
      staff_id: r.staff_id,
      nome: r.nome,
      cargo: r.cargo,
      salario_hora: r.salario_hora,
      hours: r.hours,
      lateHours: r.lateHours || 0,
      pay: r.pay,
      open: r.open,
    })),
    hoursTotal: Math.round(hoursTotal * 100) / 100,
    months,
    rent: {
      amount: rentAmount,
      note: rentRow?.note || '',
      month_key: mes,
      id: rentRow?.id || null,
      last: rentPrev && rentPrev.month_key !== mes
        ? { month_key: rentPrev.month_key, amount: Math.round(+rentPrev.amount || 0), note: rentPrev.note || '' }
        : null,
    },
    overhead: splitOverhead(rentR.rows || [], mes),
    pos: {
      salesCount: posMonthRows.length,
      till: books.pos.amount,
      tickets: posMonthRows.map(s => ({
        id: s.id,
        data: s.data,
        criado_em: s.criado_em || null,
        total: +s.total || 0,
        obs: String(s.obs || '').slice(0, 80),
        metodo_pagamento: s.metodo_pagamento || null,
        drink_back_agent_id: s.drink_back_agent_id || null,
      })),
    },
    jbm: {
      comprasMes: jbm.contaMes,
      entregasMes: jbm.deliveries,
      faturasPendentes: jbm.faturasPendentes,
      faturasAtraso: jbm.faturasAtraso,
      totalPendente: jbm.totalPendente,
      faturaPagaMes: jbm.faturaPagaMes,
      faturasResumo: drinksFaturas.slice(0, 8).map(f => ({
        status: f.status,
        total: faturaValor(f),
        pago: faturaPago(f),
        remain: faturaRemaining(f),
        vencimento: f.data_vencimento || f.periodo_fim,
        periodo: `${f.periodo_inicio || ''}..${f.periodo_fim || ''}`,
        obs: String(f.obs || f.notas || '').slice(0, 80),
        inMonth: invoiceOverlapsMonth(f, mes),
      })),
      invoicesThisPeriod: invoicesThisPeriod.length,
      pedidosRecentes: pedMes.slice(0, 8).map(mapPedido),
      pedidosMes: pedMes.length,
      pedidosMesTotal: pedMes.reduce((a, p) => a + (+p.total_estimado || 0), 0),
      notesMes: supplier.filter(v => monthKeyOf(v.data || v.data_venda) === mes).slice(0, 12).map(mapNote),
      gap,
      estoqueBaixo,
    },
  }
}

async function persistHqMeta(admin, barId, patch) {
  const row = {
    id: barId,
    bar_id: barId,
    last_sync: patch.last_sync,
    sources: patch.sources,
    atualizado_em: new Date().toISOString(),
  }
  const pg = await admin.from('bar_hq_meta').upsert(row).eq('id', barId)
  if (!pg.error) return { via: 'postgres' }
  if (!isMissingSchemaError(pg.error)) return { via: 'postgres', error: pg.error.message }
  const existing = await runLiveOp(admin, {
    table: 'bar_hq_meta',
    mode: 'select',
    columns: '*',
    filters: [{ op: 'eq', k: 'bar_id', v: barId }],
    wantSingle: 'maybe',
  })
  await runLiveOp(admin, {
    table: 'bar_hq_meta',
    mode: existing.data ? 'update' : 'insert',
    filters: [{ op: 'eq', k: 'bar_id', v: barId }],
    insertRows: [row],
    updatePatch: row,
    wantSingle: true,
  })
  return { via: 'live-store' }
}

export async function saveHqRent(admin, barId, { amount, note, month_key } = {}) {
  await ensureBarLiveReady(admin)
  const mes = month_key || tokyoMonthKey()
  const loaded = await pgOrLive(admin, 'bar_overhead', [
    { op: 'eq', k: 'bar_id', v: barId },
    { op: 'eq', k: 'kind', v: 'rent' },
    { op: 'eq', k: 'month_key', v: mes },
  ])
  const prev = (loaded.rows || [])[0]
  const row = {
    id: prev?.id,
    bar_id: barId,
    kind: 'rent',
    month_key: mes,
    amount: Math.round(+amount || 0),
    note: String(note || prev?.note || ''),
  }
  const pg = prev
    ? await admin.from('bar_overhead').update({ amount: row.amount, note: row.note }).eq('id', prev.id)
    : await admin.from('bar_overhead').insert(row)
  if (!pg.error) return { ok: true, via: 'postgres', row }
  if (!isMissingSchemaError(pg.error)) return { ok: false, error: pg.error.message }
  await runLiveOp(admin, {
    table: 'bar_overhead',
    mode: prev ? 'update' : 'insert',
    filters: prev ? [{ op: 'eq', k: 'id', v: prev.id }] : [],
    insertRows: [row],
    updatePatch: { amount: row.amount, note: row.note },
    wantSingle: true,
  })
  return { ok: true, via: 'live-store', row }
}

export async function saveBarCost(admin, barId, body = {}) {
  await ensureBarLiveReady(admin)
  if (body.action === 'delete') {
    if (!body.id) return { ok: false, error: 'id required' }
    const pg = await admin.from('bar_overhead').delete().eq('id', body.id).eq('bar_id', barId)
    if (pg.error) {
      if (!isMissingSchemaError(pg.error)) return { ok: false, error: pg.error.message }
      await runLiveOp(admin, {
        table: 'bar_overhead',
        mode: 'delete',
        filters: [{ op: 'eq', k: 'id', v: body.id }, { op: 'eq', k: 'bar_id', v: barId }],
      })
    }
    return { ok: true }
  }
  const kind = body.kind === 'variavel' ? 'variavel' : 'fixo'
  const note = String(body.name || body.note || '').trim()
  const amount = Math.round(+body.amount || 0)
  if (!note) return { ok: false, error: 'name required' }
  if (amount < 0) return { ok: false, error: 'amount required' }
  const row = {
    bar_id: barId,
    kind,
    month_key: kind === 'variavel' ? (body.month_key || tokyoMonthKey()) : 'fixo',
    amount,
    note,
  }
  const pg = await admin.from('bar_overhead').insert(row).select('*').single()
  if (!pg.error) return { ok: true, via: 'postgres', row: pg.data }
  if (!isMissingSchemaError(pg.error)) return { ok: false, error: pg.error.message }
  const live = await runLiveOp(admin, {
    table: 'bar_overhead',
    mode: 'insert',
    insertRows: [row],
    wantSingle: true,
  })
  if (live.error) return { ok: false, error: live.error.message || 'Cost save failed' }
  return { ok: true, via: 'live-store', row: live.data }
}
