import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, Spinner, Empty, filterSupplierVendas } from './utils'
import {
  analyzePurchases,
  buildPricingMap,
  categoryAnalysis,
  downloadCsv,
  findMissingPricing,
  getAvailableMonths,
  monthlyProjectionSeries,
  monthOverMonthDelta,
  simulatePurchase,
  weeklySpendSeries,
} from '../lib/clientAnalytics'
import { useI18n } from '../lib/i18n'

const CAT_COLORS = ['#001028', '#2563eb', '#c19c56', '#1a6b4a', '#8b5cf6', '#dc2626', '#0891b2', '#ea580c']

function DualBarChart({ labels, seriesA, seriesB, names, selectedIndex, onSelect, height = 120 }) {
  const max = Math.max(...seriesA, ...seriesB, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, paddingTop: 8 }}>
      {labels.map((label, i) => {
        const aPct = Math.max(seriesA[i] / max * 100, seriesA[i] > 0 ? 3 : 0)
        const bPct = Math.max(seriesB[i] / max * 100, seriesB[i] > 0 ? 3 : 0)
        const active = selectedIndex === i
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect?.(i)}
            title={`${names[0]}: ${fmtYen(seriesA[i])}\n${names[1]}: ${fmtYen(seriesB[i])}`}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              opacity: selectedIndex === null || active ? 1 : 0.45,
            }}
          >
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', width: '100%', height: height - 28 }}>
              <div style={{
                flex: 1, height: `${aPct}%`, minHeight: seriesA[i] > 0 ? 4 : 0,
                background: active ? 'var(--navy)' : '#94a3b8',
                borderRadius: '4px 4px 0 0', transition: 'height 0.25s',
              }} />
              <div style={{
                flex: 1, height: `${bPct}%`, minHeight: seriesB[i] > 0 ? 4 : 0,
                background: active ? 'var(--green)' : '#86efac',
                borderRadius: '4px 4px 0 0', transition: 'height 0.25s',
              }} />
            </div>
            <div style={{ fontSize: 10, fontWeight: active ? 700 : 400, color: active ? 'var(--navy)' : 'var(--text3)' }}>
              {label}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function Tooltip({ children, text }) {
  const [show, setShow] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && text && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 6, padding: '8px 10px', background: 'var(--navy)', color: 'white',
          fontSize: 11, borderRadius: 8, whiteSpace: 'pre-line', zIndex: 20, minWidth: 140,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)', pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

export default function ClientAnalyticsTab({ bar, onTab }) {
  const { t } = useI18n()
  const [vendas, setVendas] = useState([])
  const [itens, setItens] = useState([])
  const [barPricing, setBarPricing] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7))
  const [chartMonthIndex, setChartMonthIndex] = useState(null)
  const [catFilter, setCatFilter] = useState('')
  const [sortBy, setSortBy] = useState('margin')
  const [expandedProduct, setExpandedProduct] = useState(null)
  const [simProductId, setSimProductId] = useState('')
  const [simQty, setSimQty] = useState(6)

  useEffect(() => { load() }, [bar])

  async function load() {
    setLoading(true)
    const [vR, iR, bpR] = await Promise.all([
      supabase.from('vendas').select('*').eq('bar_id', bar.id).order('data', { ascending: true }),
      supabase.from('vendas_itens').select('*, produtos(nome,categoria,preco_venda,volume_ml), vendas(data,bar_id,obs)').eq('vendas.bar_id', bar.id),
      supabase.from('bar_pricing').select('produto_id,drinks_por_garrafa,preco_drink').eq('bar_id', bar.id),
    ])
    const v = filterSupplierVendas(vR.data || [])
    setVendas(v)
    setItens((iR.data || []).filter(i => i.vendas && filterSupplierVendas([i.vendas]).length))
    setBarPricing(bpR.data || [])
    const months = getAvailableMonths(v)
    if (months.length && !months.includes(selectedMonth)) setSelectedMonth(months[0])
    setLoading(false)
  }

  const pricingMap = useMemo(() => buildPricingMap(barPricing), [barPricing])
  const availableMonths = useMemo(() => getAvailableMonths(vendas), [vendas])
  const monthSeries = useMemo(() => monthlyProjectionSeries(vendas, itens, pricingMap, 12), [vendas, itens, pricingMap])
  const weekSeries = useMemo(() => weeklySpendSeries(vendas, 8), [vendas])

  const activeMonthKey = chartMonthIndex !== null
    ? monthSeries.keys[chartMonthIndex]
    : selectedMonth

  const monthStats = useMemo(
    () => analyzePurchases(itens, pricingMap, { monthKey: activeMonthKey }),
    [itens, pricingMap, activeMonthKey]
  )
  const categories = useMemo(
    () => categoryAnalysis(itens, pricingMap, { monthKey: activeMonthKey }),
    [itens, pricingMap, activeMonthKey]
  )
  const missingPricing = useMemo(() => findMissingPricing(itens, pricingMap), [itens, pricingMap])

  const products = useMemo(() => {
    let list = monthStats.products
    if (catFilter) list = list.filter(p => p.categoria === catFilter)
    const sorters = {
      margin: (a, b) => b.margin - a.margin,
      roi: (a, b) => b.roiPct - a.roiPct,
      jbm: (a, b) => b.jbmTotal - a.jbmTotal,
      qtd: (a, b) => b.qtd - a.qtd,
    }
    return [...list].sort(sorters[sortBy] || sorters.margin)
  }, [monthStats.products, catFilter, sortBy])

  const simCatalog = useMemo(() => {
    const map = new Map()
    for (const it of itens) {
      if (!it.produto_id) continue
      map.set(it.produto_id, {
        produto_id: it.produto_id,
        nome: it.produtos?.nome || '?',
        preco_unitario: +it.preco_unitario || +it.produtos?.preco_venda || 0,
        categoria: it.produtos?.categoria,
        produtos: it.produtos,
      })
    }
    return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome))
  }, [itens])

  const simItem = simCatalog.find(p => p.produto_id === simProductId) || simCatalog[0]
  const simResult = simItem
    ? simulatePurchase(pricingMap, { ...simItem, qtd: simQty })
    : null

  useEffect(() => {
    if (simCatalog.length && !simProductId) setSimProductId(simCatalog[0].produto_id)
  }, [simCatalog, simProductId])

  const chartIdx = chartMonthIndex ?? monthSeries.keys.indexOf(selectedMonth)
  const jbmMom = chartIdx >= 0 ? monthOverMonthDelta(monthSeries.jbm, chartIdx) : null
  const posMom = chartIdx >= 0 ? monthOverMonthDelta(monthSeries.pos, chartIdx) : null

  function exportProducts() {
    downloadCsv(
      `analytics-${bar.nome}-${activeMonthKey}.csv`,
      [
        { label: t('portal.analytics.csvProduct'), get: r => r.nome },
        { label: t('portal.analytics.csvCategory'), get: r => r.categoria },
        { label: t('portal.analytics.csvQty'), get: r => r.qtd },
        { label: t('portal.analytics.csvJbmCost'), get: r => r.jbmTotal },
        { label: t('portal.analytics.csvPosProj'), get: r => r.posTotal },
        { label: t('portal.analytics.csvMargin'), get: r => r.margin },
        { label: t('portal.analytics.csvMarginPct'), get: r => r.marginPct },
        { label: t('portal.analytics.csvRoi'), get: r => r.roiPct },
        { label: t('portal.analytics.csvSource'), get: r => r.source },
      ],
      products
    )
  }

  if (loading) return <Spinner text={t('portal.analytics.loading')} />

  const maxWeek = Math.max(...weekSeries.values, 1)

  return (
    <div className="fade-in" style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>Analytics</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
            {t('portal.analytics.subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={activeMonthKey}
            onChange={e => { setSelectedMonth(e.target.value); setChartMonthIndex(null) }}
            style={{ fontSize: 13, padding: '8px 12px', borderRadius: 10 }}
          >
            {availableMonths.length === 0 && <option value={selectedMonth}>{selectedMonth}</option>}
            {availableMonths.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
            {monthSeries.keys.filter(k => !availableMonths.includes(k)).slice(-3).map(m => (
              <option key={m} value={m}>{m} {t('portal.analytics.noPurchases')}</option>
            ))}
          </select>
          <button type="button" onClick={exportProducts} style={{
            padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)',
            background: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            {t('portal.analytics.exportCsv')}
          </button>
          <button type="button" onClick={() => onTab?.('pos')} style={{
            padding: '8px 14px', borderRadius: 10, border: 'none',
            background: 'var(--navy)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            {t('portal.analytics.posPrices')}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          {
            label: t('portal.analytics.jbmAccount'),
            value: fmtYen(monthStats.jbmTotal),
            sub: jbmMom !== null
              ? t('portal.analytics.vsPrevMonth', { dir: jbmMom >= 0 ? '↑' : '↓', pct: Math.abs(jbmMom) })
              : t('portal.analytics.itemsCount', { count: monthStats.itemCount }),
            color: 'var(--navy)',
          },
          {
            label: t('portal.analytics.posRevenue'),
            value: fmtYen(monthStats.posTotal),
            sub: posMom !== null
              ? t('portal.analytics.vsPrevMonth', { dir: posMom >= 0 ? '↑' : '↓', pct: Math.abs(posMom) })
              : t('portal.analytics.realPricesPct', { pct: monthStats.posCoveragePct }),
            color: 'var(--blue)',
          },
          {
            label: t('portal.analytics.projectedProfit'),
            value: fmtYen(monthStats.margin),
            sub: t('portal.analytics.marginPct', { pct: monthStats.marginPct }),
            color: 'var(--green)',
          },
          {
            label: 'ROI',
            value: `${monthStats.roiPct}%`,
            sub: monthStats.estimatedSharePct > 0
              ? t('portal.home.estimated', { pct: monthStats.estimatedSharePct })
              : t('portal.analytics.onJbmCost'),
            color: 'var(--gold)',
          },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, fontWeight: 600 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Interactive dual chart */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t('portal.analytics.monthlyCompare')}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
              {t('portal.analytics.chartLegend', { month: activeMonthKey })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--navy)', borderRadius: 2, marginRight: 4 }} />JBM</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--green)', borderRadius: 2, marginRight: 4 }} />POS</span>
          </div>
        </div>
        <DualBarChart
          labels={monthSeries.labels}
          seriesA={monthSeries.jbm}
          seriesB={monthSeries.pos}
          names={['JBM', 'POS']}
          selectedIndex={chartMonthIndex ?? (monthSeries.keys.indexOf(selectedMonth) >= 0 ? monthSeries.keys.indexOf(selectedMonth) : null)}
          onSelect={i => {
            setChartMonthIndex(i)
            setSelectedMonth(monthSeries.keys[i])
            setCatFilter('')
          }}
        />
      </div>

      {/* Categories + weekly */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('portal.analytics.roiByCategory')}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 16 }}>{t('portal.analytics.clickToFilter', { month: activeMonthKey })}</div>
          {categories.length === 0 ? (
            <Empty text={t('portal.analytics.noDataThisMonth')} icon="📊" />
          ) : categories.map((c, i) => (
            <button
              key={c.categoria}
              type="button"
              onClick={() => setCatFilter(catFilter === c.categoria ? '' : c.categoria)}
              style={{
                width: '100%', textAlign: 'left', marginBottom: 12, padding: '10px 12px',
                borderRadius: 10, cursor: 'pointer',
                border: catFilter === c.categoria ? '2px solid var(--navy)' : '1px solid var(--border)',
                background: catFilter === c.categoria ? '#EAF0FA' : 'white',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                <span style={{ fontWeight: 700 }}>{c.categoria}</span>
                <span>{t('portal.analytics.shareOfSpend', { pct: c.sharePct })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
                <span>{fmtYen(c.jbmTotal)} → {fmtYen(c.posTotal)}</span>
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>ROI {c.roiPct}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${c.sharePct}%`, background: CAT_COLORS[i % CAT_COLORS.length], borderRadius: 3 }} />
              </div>
            </button>
          ))}
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('portal.analytics.weeklySpend')}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 16 }}>{t('portal.analytics.last8Weeks')}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100 }}>
            {weekSeries.values.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ fontSize: 9, color: 'var(--text2)' }}>{v > 0 ? (v >= 10000 ? `${Math.round(v / 1000)}k` : fmtYen(v)) : ''}</div>
                <div style={{
                  width: '100%', height: `${Math.max(v / maxWeek * 100, v > 0 ? 4 : 0)}%`,
                  minHeight: v > 0 ? 4 : 0, background: i === weekSeries.values.length - 1 ? 'var(--gold)' : 'var(--border)',
                  borderRadius: '4px 4px 0 0',
                }} />
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>{weekSeries.labels[i]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Simulator */}
      <div style={{
        background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
        border: '1px solid #fcd34d', borderRadius: 16, padding: '20px 24px', marginBottom: 16,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('portal.analytics.purchaseSimulator')}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 16 }}>
          {t('portal.analytics.simulatorSub')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)' }}>{t('portal.analytics.product')}</label>
            <select value={simItem?.produto_id || ''} onChange={e => setSimProductId(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
              {simCatalog.map(p => (
                <option key={p.produto_id} value={p.produto_id}>{p.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)' }}>{t('portal.analytics.quantity', { qty: simQty })}</label>
            <input type="range" min={1} max={48} value={simQty} onChange={e => setSimQty(+e.target.value)} style={{ width: '100%', marginTop: 8 }} />
          </div>
          {simResult && (
            <div style={{ background: 'white', borderRadius: 12, padding: '12px 14px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('portal.analytics.projection')}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--green)' }}>{fmtYen(simResult.posTotal)}</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                {t('portal.analytics.costProfitRoi', {
                  cost: fmtYen(simResult.jbmTotal),
                  profit: fmtYen(simResult.margin),
                  roi: simResult.jbmTotal > 0 ? Math.round(simResult.margin / simResult.jbmTotal * 100) : 0,
                })}
                {simResult.source === 'estimate' ? ' · ~' : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Missing pricing alert */}
      {missingPricing.length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 14, padding: '14px 16px', marginBottom: 16, fontSize: 12 }}>
          <strong>{t('portal.analytics.missingPricing', {
            count: missingPricing.length,
            amount: fmtYen(missingPricing.reduce((a, p) => a + p.jbmTotal, 0)),
          })}</strong>
          <button type="button" onClick={() => onTab?.('pos')} style={{ marginLeft: 8, border: 'none', background: 'transparent', color: 'var(--navy)', fontWeight: 700, cursor: 'pointer' }}>
            {t('portal.analytics.registerPrices')}
          </button>
        </div>
      )}

      {/* Product table with drill-down */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t('portal.analytics.drillDown')}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)' }}>
              {catFilter ? t('portal.analytics.categoryFilter', { cat: catFilter }) : ''}{t('portal.analytics.productsCount', { count: products.length })}
            </div>
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ fontSize: 12 }}>
            <option value="margin">{t('portal.analytics.sortMargin')}</option>
            <option value="roi">{t('portal.analytics.sortRoi')}</option>
            <option value="jbm">{t('portal.analytics.sortJbm')}</option>
            <option value="qtd">{t('portal.analytics.sortQty')}</option>
          </select>
        </div>
        {products.length === 0 ? (
          <Empty text={t('portal.analytics.noProductsFilter')} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  {[t('portal.home.tableProduct'), t('portal.analytics.tableCat'), t('portal.home.tableQty'), 'JBM', t('portal.analytics.tablePosProj'), t('portal.analytics.csvMargin'), 'ROI', ''].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <Fragment key={p.nome}>
                    <tr
                      onClick={() => setExpandedProduct(expandedProduct === p.nome ? null : p.nome)}
                      style={{
                        borderBottom: '1px solid var(--border)', cursor: 'pointer',
                        background: expandedProduct === p.nome ? 'rgba(193,156,86,0.06)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '10px', fontWeight: 600 }}>
                        {p.source === 'estimate' ? '~ ' : ''}{p.nome}
                      </td>
                      <td style={{ padding: '10px', fontSize: 11, color: 'var(--text2)' }}>{p.categoria}</td>
                      <td style={{ padding: '10px' }}>{p.qtd}</td>
                      <td style={{ padding: '10px', color: 'var(--red)' }}>{fmtYen(p.jbmTotal)}</td>
                      <td style={{ padding: '10px' }}>{fmtYen(p.posTotal)}</td>
                      <td style={{ padding: '10px', color: 'var(--green)', fontWeight: 700 }}>{fmtYen(p.margin)}</td>
                      <td style={{ padding: '10px' }}>
                        <Tooltip text={t('portal.analytics.marginTooltip', {
                          pct: p.marginPct,
                          qty: p.qtd,
                          unit: fmtYen(p.posPerUnit),
                        })}>
                          <span style={{
                            padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                            background: p.roiPct > 150 ? '#f0fdf4' : '#fffbeb',
                            color: p.roiPct > 150 ? 'var(--green)' : 'var(--amber)',
                          }}>
                            {p.roiPct}%
                          </span>
                        </Tooltip>
                      </td>
                      <td style={{ padding: '10px', fontSize: 11, color: 'var(--text3)' }}>{expandedProduct === p.nome ? '▲' : '▼'}</td>
                    </tr>
                    {expandedProduct === p.nome && (
                      <tr key={`${p.nome}-detail`}>
                        <td colSpan={8} style={{ padding: '12px 16px 16px', background: 'var(--bg3)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, fontSize: 12 }}>
                            <div><div style={{ color: 'var(--text2)', fontSize: 10 }}>{t('portal.analytics.costPerUnitJbm')}</div><strong>{fmtYen(p.jbmPerUnit)}</strong></div>
                            <div><div style={{ color: 'var(--text2)', fontSize: 10 }}>{t('portal.analytics.projPerUnitPos')}</div><strong>{fmtYen(p.posPerUnit)}</strong></div>
                            <div><div style={{ color: 'var(--text2)', fontSize: 10 }}>{t('portal.analytics.marginPctLabel')}</div><strong>{p.marginPct}%</strong></div>
                            <div>
                              <div style={{ color: 'var(--text2)', fontSize: 10 }}>{t('portal.analytics.simulate6Units')}</div>
                              <strong>{fmtYen(simulatePurchase(pricingMap, { produto_id: p.produto_id, preco_unitario: p.jbmPerUnit, qtd: 6, produtos: { preco_venda: p.jbmPerUnit } }).margin)}</strong> {t('portal.analytics.profit')}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
