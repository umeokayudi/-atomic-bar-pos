import { filterSupplierVendas } from '../components/utils'
import { filterJbmDrinksFaturas, faturaPago, faturaValor, faturaVencimento } from './barPortal'

export function buildPricingMap(barPricing = []) {
  const map = {}
  for (const row of barPricing) {
    map[row.produto_id] = {
      drinks_por_garrafa: +row.drinks_por_garrafa || 0,
      preco_drink: +row.preco_drink || 0,
    }
  }
  return map
}

/** POS projection — uses bar_pricing (POS drink prices). Fallback estimate when missing. */
export function projectItemRevenue(item, pricingMap) {
  const qtd = +item.qtd || 0
  const jbmUnit = +item.preco_unitario || +item.produtos?.preco_venda || 0
  const jbmTotal = jbmUnit * qtd
  if (!qtd) return { jbmTotal, posTotal: 0, margin: 0, source: 'none', drinks: 0 }

  const pr = pricingMap[item.produto_id]
  if (pr?.preco_drink > 0 && pr?.drinks_por_garrafa > 0) {
    const drinks = qtd * pr.drinks_por_garrafa
    const posTotal = drinks * pr.preco_drink
    return {
      jbmTotal,
      posTotal,
      margin: posTotal - jbmTotal,
      marginPct: posTotal > 0 ? Math.round((posTotal - jbmTotal) / posTotal * 100) : 0,
      source: 'pos',
      sourceLabel: 'preço POS cadastrado',
      drinks,
      preco_drink: pr.preco_drink,
      drinks_por_garrafa: pr.drinks_por_garrafa,
    }
  }

  const bottlePos = Math.round(jbmUnit * 2.8)
  const posTotal = bottlePos * qtd
  return {
    jbmTotal,
    posTotal,
    margin: posTotal - jbmTotal,
    marginPct: posTotal > 0 ? Math.round((posTotal - jbmTotal) / posTotal * 100) : 0,
    source: 'estimate',
    sourceLabel: 'estimativa (sem preço POS)',
    drinks: qtd,
    preco_drink: bottlePos,
    drinks_por_garrafa: 1,
  }
}

export function analyzePurchases(itens, pricingMap, { monthKey, cutoffStr } = {}) {
  const filtered = (itens || []).filter(it => {
    if (!it.vendas) return false
    if (monthKey && !it.vendas.data?.startsWith(monthKey)) return false
    if (cutoffStr && it.vendas.data < cutoffStr) return false
    return true
  })

  const byProduct = {}
  let jbmTotal = 0
  let posTotal = 0
  let posSourced = 0
  let estimated = 0

  for (const it of filtered) {
    const r = projectItemRevenue(it, pricingMap)
    jbmTotal += r.jbmTotal
    posTotal += r.posTotal
    if (r.source === 'pos') posSourced += r.jbmTotal
    if (r.source === 'estimate') estimated += r.jbmTotal

    const nome = it.produtos?.nome || '?'
    if (!byProduct[nome]) {
      byProduct[nome] = {
        nome,
        produto_id: it.produto_id,
        categoria: it.produtos?.categoria || 'Outros',
        qtd: 0,
        jbmTotal: 0,
        posTotal: 0,
        margin: 0,
        source: r.source,
      }
    }
    const p = byProduct[nome]
    p.qtd += +it.qtd || 0
    p.jbmTotal += r.jbmTotal
    p.posTotal += r.posTotal
    p.margin += r.margin
    if (r.source === 'estimate') p.source = 'estimate'
  }

  const products = Object.values(byProduct)
    .map(p => ({
      ...p,
      marginPct: p.posTotal > 0 ? Math.round(p.margin / p.posTotal * 100) : 0,
      roiPct: p.jbmTotal > 0 ? Math.round(p.margin / p.jbmTotal * 100) : 0,
      jbmPerUnit: p.qtd > 0 ? Math.round(p.jbmTotal / p.qtd) : 0,
      posPerUnit: p.qtd > 0 ? Math.round(p.posTotal / p.qtd) : 0,
    }))
    .sort((a, b) => b.margin - a.margin)

  return {
    jbmTotal,
    posTotal,
    margin: posTotal - jbmTotal,
    marginPct: posTotal > 0 ? Math.round((posTotal - jbmTotal) / posTotal * 100) : 0,
    roiPct: jbmTotal > 0 ? Math.round((posTotal - jbmTotal) / jbmTotal * 100) : 0,
    posCoveragePct: jbmTotal > 0 ? Math.round(posSourced / jbmTotal * 100) : 0,
    estimatedSharePct: jbmTotal > 0 ? Math.round(estimated / jbmTotal * 100) : 0,
    products,
    itemCount: filtered.length,
  }
}

export function monthlyAccountSummary(vendas, faturas, monthKey) {
  const supplier = filterSupplierVendas(vendas || [])
  const mesVendas = supplier.filter(v => v.data?.startsWith(monthKey))
  const contaMes = mesVendas.reduce((a, v) => a + (+v.total || 0), 0)

  const prev = new Date(monthKey + '-01')
  prev.setMonth(prev.getMonth() - 1)
  const prevKey = prev.toISOString().slice(0, 7)
  const contaPrev = supplier
    .filter(v => v.data?.startsWith(prevKey))
    .reduce((a, v) => a + (+v.total || 0), 0)

  const growth = contaPrev > 0 ? Math.round((contaMes - contaPrev) / contaPrev * 100) : null

  const barFaturas = filterJbmDrinksFaturas(faturas).filter(f =>
    f.data_emissao?.startsWith(monthKey) ||
    faturaVencimento(f)?.startsWith(monthKey) ||
    (f.periodo_inicio?.startsWith(monthKey) || f.periodo_fim?.startsWith(monthKey))
  )

  const faturaPendente = barFaturas
    .filter(f => f.status !== 'pago')
    .reduce((a, f) => a + Math.max(0, faturaValor(f) - faturaPago(f)), 0)

  const faturaPaga = barFaturas
    .filter(f => f.status === 'pago')
    .reduce((a, f) => a + (faturaPago(f) || faturaValor(f)), 0)

  return {
    contaMes,
    contaPrev,
    growth,
    deliveries: mesVendas.length,
    faturaPendente,
    faturaPaga,
    faturasCount: barFaturas.length,
  }
}

export function monthlySpendSeries(vendas, months = 6) {
  const supplier = filterSupplierVendas(vendas || [])
  const labels = []
  const values = []
  const keys = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const mk = d.toISOString().slice(0, 7)
    keys.push(mk)
    labels.push(mk.slice(5))
    values.push(supplier.filter(v => v.data?.startsWith(mk)).reduce((a, v) => a + (+v.total || 0), 0))
  }
  return { labels, values, keys }
}

export function getAvailableMonths(vendas) {
  const set = new Set()
  for (const v of filterSupplierVendas(vendas || [])) {
    if (v.data?.length >= 7) set.add(v.data.slice(0, 7))
  }
  return [...set].sort().reverse()
}

/** JBM spend + POS projection per calendar month (for interactive charts). */
export function monthlyProjectionSeries(vendas, itens, pricingMap, months = 12) {
  const labels = []
  const keys = []
  const jbm = []
  const pos = []
  const margin = []
  const deliveries = []
  const roi = []

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const mk = d.toISOString().slice(0, 7)
    keys.push(mk)
    labels.push(mk.slice(2).replace('-', '/'))
    const account = monthlyAccountSummary(vendas, [], mk)
    const proj = analyzePurchases(itens, pricingMap, { monthKey: mk })
    jbm.push(account.contaMes)
    pos.push(proj.posTotal)
    margin.push(proj.margin)
    deliveries.push(account.deliveries)
    roi.push(proj.roiPct)
  }

  return { labels, keys, jbm, pos, margin, deliveries, roi }
}

export function categoryAnalysis(itens, pricingMap, { monthKey, cutoffStr } = {}) {
  const filtered = (itens || []).filter(it => {
    if (!it.vendas) return false
    if (monthKey && !it.vendas.data?.startsWith(monthKey)) return false
    if (cutoffStr && it.vendas.data < cutoffStr) return false
    return true
  })

  const byCat = {}
  for (const it of filtered) {
    const cat = it.produtos?.categoria || 'Outros'
    if (!byCat[cat]) {
      byCat[cat] = { categoria: cat, qtd: 0, jbmTotal: 0, posTotal: 0, margin: 0, skuCount: 0, _names: new Set() }
    }
    const r = projectItemRevenue(it, pricingMap)
    const c = byCat[cat]
    c.qtd += +it.qtd || 0
    c.jbmTotal += r.jbmTotal
    c.posTotal += r.posTotal
    c.margin += r.margin
    c._names.add(it.produtos?.nome)
  }

  const rows = Object.values(byCat)
    .map(c => ({
      categoria: c.categoria,
      qtd: c.qtd,
      jbmTotal: c.jbmTotal,
      posTotal: c.posTotal,
      margin: c.margin,
      skuCount: c._names.size,
      marginPct: c.posTotal > 0 ? Math.round(c.margin / c.posTotal * 100) : 0,
      roiPct: c.jbmTotal > 0 ? Math.round(c.margin / c.jbmTotal * 100) : 0,
    }))
    .sort((a, b) => b.jbmTotal - a.jbmTotal)

  const totalJbm = rows.reduce((a, r) => a + r.jbmTotal, 0)
  return rows.map(r => ({
    ...r,
    sharePct: totalJbm > 0 ? Math.round(r.jbmTotal / totalJbm * 100) : 0,
  }))
}

export function weeklySpendSeries(vendas, weeks = 8) {
  const supplier = filterSupplierVendas(vendas || [])
  const labels = []
  const values = []
  const keys = []

  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date()
    end.setDate(end.getDate() - i * 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    const startStr = start.toISOString().slice(0, 10)
    const endStr = end.toISOString().slice(0, 10)
    keys.push(`${startStr}_${endStr}`)
    labels.push(`${start.getDate()}/${start.getMonth() + 1}`)
    values.push(
      supplier
        .filter(v => v.data >= startStr && v.data <= endStr)
        .reduce((a, v) => a + (+v.total || 0), 0)
    )
  }

  return { labels, values, keys }
}

export function findMissingPricing(itens, pricingMap) {
  const seen = new Map()
  for (const it of itens || []) {
    if (!it.produto_id || pricingMap[it.produto_id]?.preco_drink > 0) continue
    const nome = it.produtos?.nome || '?'
    if (!seen.has(it.produto_id)) {
      seen.set(it.produto_id, { produto_id: it.produto_id, nome, categoria: it.produtos?.categoria, qtd: 0, jbmTotal: 0 })
    }
    const row = seen.get(it.produto_id)
    row.qtd += +it.qtd || 0
    row.jbmTotal += (+it.preco_unitario || 0) * (+it.qtd || 0)
  }
  return [...seen.values()].sort((a, b) => b.jbmTotal - a.jbmTotal)
}

export function simulatePurchase(pricingMap, { produto_id, preco_unitario, qtd = 1, produtos }) {
  return projectItemRevenue(
    { produto_id, qtd, preco_unitario, produtos },
    pricingMap
  )
}

export function monthOverMonthDelta(series, index) {
  if (index <= 0) return null
  const prev = series[index - 1]
  const curr = series[index]
  if (prev <= 0) return curr > 0 ? 100 : null
  return Math.round((curr - prev) / prev * 100)
}

export function downloadCsv(filename, columns, rows) {
  const escape = v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map(c => escape(c.label)).join(',')
  const body = rows.map(r => columns.map(c => escape(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
