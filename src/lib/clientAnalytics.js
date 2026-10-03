import { filterSupplierVendas } from '../components/utils'
import { filterJbmDrinksFaturas, faturaPago, faturaValor, faturaVencimento } from './barPortal'
import { sumJbmNet } from './saleBooks.js'

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

/** Confirmed till price from bar_pricing only. A missing price stays unavailable. */
export function projectItemRevenue(item, pricingMap) {
  const qtd = +item.qtd || 0
  const captured = +item.preco_unitario
  const jbmTotal = captured > 0 && qtd > 0 ? captured * qtd : null
  const unavailable = {
    jbmTotal,
    posTotal: null,
    margin: null,
    marginPct: null,
    source: 'unavailable',
    sourceLabel: 'price unavailable',
    drinks: 0,
    preco_drink: null,
    drinks_por_garrafa: null,
    confirmed: false,
  }
  if (!qtd) return unavailable

  const pr = pricingMap[item.produto_id]
  if (pr?.preco_drink > 0 && pr?.drinks_por_garrafa > 0) {
    const drinks = qtd * pr.drinks_por_garrafa
    const posTotal = drinks * pr.preco_drink
    const margin = jbmTotal == null ? null : posTotal - jbmTotal
    return {
      jbmTotal,
      posTotal,
      margin,
      marginPct: margin != null && posTotal > 0 ? Math.round(margin / posTotal * 100) : null,
      source: 'pos',
      sourceLabel: 'POS price on file',
      drinks,
      preco_drink: pr.preco_drink,
      drinks_por_garrafa: pr.drinks_por_garrafa,
      confirmed: true,
    }
  }
  return unavailable
}

export function analyzePurchases(itens, pricingMap, { monthKey, cutoffStr } = {}) {
  const filtered = (itens || []).filter(it => {
    if (!it.vendas) return false
    if (monthKey && !it.vendas.data?.startsWith(monthKey)) return false
    if (cutoffStr && it.vendas.data < cutoffStr) return false
    return true
  })

  const byProduct = {}
  let jbmKnown = 0
  let jbmMissing = false
  let posKnown = 0
  let posMissing = filtered.length === 0
  let posSourced = 0

  for (const it of filtered) {
    const r = projectItemRevenue(it, pricingMap)
    if (r.jbmTotal == null) jbmMissing = true
    else jbmKnown += r.jbmTotal
    if (r.confirmed && r.posTotal != null) {
      posKnown += r.posTotal
      if (r.jbmTotal != null) posSourced += r.jbmTotal
    } else {
      posMissing = true
    }

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
        jbmMissing: false,
        posMissing: false,
        source: r.source,
      }
    }
    const p = byProduct[nome]
    p.qtd += +it.qtd || 0
    if (r.jbmTotal == null) p.jbmMissing = true
    else p.jbmTotal += r.jbmTotal
    if (!r.confirmed || r.posTotal == null) p.posMissing = true
    else p.posTotal += r.posTotal
    if (r.margin == null) p.posMissing = true
    else p.margin += r.margin
    if (r.source !== 'pos') p.source = 'unavailable'
  }

  const products = Object.values(byProduct)
    .map(p => {
      const jbmTotal = p.jbmMissing ? null : p.jbmTotal
      const posTotal = p.posMissing ? null : p.posTotal
      const margin = jbmTotal == null || posTotal == null ? null : posTotal - jbmTotal
      return {
        ...p,
        jbmTotal,
        posTotal,
        margin,
        marginPct: margin != null && posTotal > 0 ? Math.round(margin / posTotal * 100) : null,
        roiPct: margin != null && jbmTotal > 0 ? Math.round(margin / jbmTotal * 100) : null,
        jbmPerUnit: jbmTotal != null && p.qtd > 0 ? Math.round(jbmTotal / p.qtd) : null,
        posPerUnit: posTotal != null && p.qtd > 0 ? Math.round(posTotal / p.qtd) : null,
      }
    })
    .sort((a, b) => (b.jbmTotal || 0) - (a.jbmTotal || 0))

  const jbmTotal = jbmMissing ? null : jbmKnown
  const posTotal = posMissing ? null : posKnown
  const margin = jbmTotal == null || posTotal == null ? null : posTotal - jbmTotal
  return {
    jbmTotal,
    posTotal,
    margin,
    marginPct: margin != null && posTotal > 0 ? Math.round((posTotal - jbmTotal) / posTotal * 100) : null,
    roiPct: margin != null && jbmTotal > 0 ? Math.round((posTotal - jbmTotal) / jbmTotal * 100) : null,
    posCoveragePct: jbmKnown > 0 ? Math.round(posSourced / jbmKnown * 100) : 0,
    estimatedSharePct: 0,
    priceState: posTotal == null ? 'unavailable' : 'confirmed',
    products,
    itemCount: filtered.length,
  }
}

export function monthlyAccountSummary(vendas, faturas, monthKey) {
  const supplier = filterSupplierVendas(vendas || [])
  const mesVendas = supplier.filter(v => v.data?.startsWith(monthKey))
  const contaMes = sumJbmNet(mesVendas)

  const prev = new Date(monthKey + '-01')
  prev.setMonth(prev.getMonth() - 1)
  const prevKey = prev.toISOString().slice(0, 7)
  const contaPrev = sumJbmNet(supplier.filter(v => v.data?.startsWith(prevKey)))

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
    values.push(sumJbmNet(supplier.filter(v => v.data?.startsWith(mk))))
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
      byCat[cat] = { categoria: cat, qtd: 0, jbmTotal: 0, posTotal: 0, margin: 0, jbmMissing: false, posMissing: false, skuCount: 0, _names: new Set() }
    }
    const r = projectItemRevenue(it, pricingMap)
    const c = byCat[cat]
    c.qtd += +it.qtd || 0
    if (r.jbmTotal == null) c.jbmMissing = true
    else c.jbmTotal += r.jbmTotal
    if (!r.confirmed || r.posTotal == null) c.posMissing = true
    else c.posTotal += r.posTotal
    if (r.margin == null) c.posMissing = true
    else c.margin += r.margin
    c._names.add(it.produtos?.nome)
  }

  const rows = Object.values(byCat)
    .map(c => {
      const jbmTotal = c.jbmMissing ? null : c.jbmTotal
      const posTotal = c.posMissing ? null : c.posTotal
      const margin = jbmTotal == null || posTotal == null ? null : posTotal - jbmTotal
      return {
        categoria: c.categoria,
        qtd: c.qtd,
        jbmTotal,
        posTotal,
        margin,
        skuCount: c._names.size,
        marginPct: margin != null && posTotal > 0 ? Math.round(margin / posTotal * 100) : null,
        roiPct: margin != null && jbmTotal > 0 ? Math.round(margin / jbmTotal * 100) : null,
      }
    })
    .sort((a, b) => (b.jbmTotal || 0) - (a.jbmTotal || 0))

  const totalJbm = rows.reduce((a, r) => a + (r.jbmTotal || 0), 0)
  return rows.map(r => ({
    ...r,
    sharePct: r.jbmTotal != null && totalJbm > 0 ? Math.round(r.jbmTotal / totalJbm * 100) : 0,
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
    values.push(sumJbmNet(supplier.filter(v => v.data >= startStr && v.data <= endStr)))
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
  if (prev == null || curr == null) return null
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
