import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { callGeminiChat, imageDataUrlToParts, parseJsonFromAI } from '../lib/ai'
import { LogoSidebar } from './Logo'
import { MobileTopBar, ShellOverlay, WorkspaceChrome, useMobileMenuLock } from './MobileShell'
import { fmtYen, fmtDate, Spinner, Empty, SectionTitle, isSupplierProduct, filterSupplierVendas } from './utils'
import {
  filterJbmDrinksFaturas,
  faturaValor,
  faturaPago,
  faturaVencimento,
  faturaEmissao,
  faturaRemaining,
  faturaPeriodoFim,
  arAging,
} from '../lib/barPortal'
import {
  analyzePurchases,
  buildPricingMap,
  monthlyAccountSummary,
  monthlySpendSeries,
  projectItemRevenue,
} from '../lib/clientAnalytics'
import ClientAnalyticsTab from './ClientAnalyticsTab'
import PortalRecibosTab from './PortalRecibosTab'
import PortalClienteAI from './PortalClienteAI'
import BarDesk from './BarDesk'
import AtomicPosPanel from './AtomicPos'
import TimeClockPanel from './TimeClock'
import BarTeamTab from './BarTeamTab'
import BarHouseTab from './BarHouse'
import BarGoalsTab from './BarGoals'
import BarEventsTab from './BarEvents'
import BarFinance from './BarFinance'
import BarGuestsTab from './BarGuestsTab'
import BarSpacesTab from './BarSpacesTab'
import { fetchAllStockMovements } from '../lib/posSupply'
import { coalesceStockMoves, decorateStockList, deliveryNoteMoves, posPourMoves, stockFlow, stockGlance } from '../lib/barStock'
import { groupedNavForRole, primaryDockForRole, defaultBarTab, posAccessForRole, canManageBarTeam, isGerente, costAccessForRole, canPlaceDrinkOrders } from '../lib/access'
import { isTillKiosk, isClockKiosk, loginDoorFromHash, setDoorHash, doorAllowsRole } from '../lib/barDoors'
import UiPrefsPanel from './UiPrefsPanel'
import { useI18n } from '../lib/i18n'
import { tokyoMonthKey } from '../lib/tokyo'
import { birthdayThisMonth, decorateSpaces } from '../lib/barCrm'
import BarCostsTab, { CostBooksHero, loadCostBooks, BarCommandActions } from './BarCostsTab'
import BarOpsGlance from './BarOpsGlance'
import { buildBarOpsGlance } from '../lib/barOpsGlance'
import { fetchHqSnapshot } from '../lib/hqSnapshot'
import { booksAreSeparate } from '../lib/costBooks'
import { asReactText } from '../lib/errText'
import { NotificationBell, useBarOverdueAlerts } from './Notifications'
import BarOrdersTab from './BarOrdersTab'
import {
  buildPaymentRyoshushoHtml,
  buildRyoshushoNumero,
  printRyoshushoHtml,
  savePaymentRyoshusho,
} from '../lib/ryoshushoPrint'

// ── HOME ──────────────────────────────────────────────────────────────────────
function EasyMoneyCard({ kicker, value, hint, tone = 'navy', children }) {
  const tones = {
    navy: { bg: 'linear-gradient(135deg, var(--navy) 0%, #002855 100%)', color: 'white', hint: 'rgba(255,255,255,0.75)' },
    light: { bg: 'var(--bg2)', color: 'var(--navy)', hint: 'var(--text2)', border: '1px solid var(--border)' },
    green: { bg: 'var(--bg2)', color: 'var(--green)', hint: 'var(--text2)', border: '1px solid rgba(52,199,89,0.25)' },
  }
  const s = tones[tone] || tones.navy
  return (
    <div className="easy-dash-card" style={{
      background: s.bg, color: s.color, border: s.border || 'none',
      borderRadius: 20, padding: '22px 24px',
    }}>
      <div className="easy-dash-kicker">{kicker}</div>
      <div className="easy-dash-value">{asReactText(value)}</div>
      {hint && <div className="easy-dash-hint" style={{ color: s.hint }}>{asReactText(hint)}</div>}
      {children}
    </div>
  )
}

function HomeTab({ bar, onTab }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const access = costAccessForRole(perfil?.role)
  const [vendas,      setVendas]      = useState([])
  const [pedidos,     setPedidos]     = useState([])
  const [itens,       setItens]       = useState([])
  const [barPricing,  setBarPricing]  = useState([])
  const [faturas,     setFaturas]     = useState([])
  const [posMonthTotal, setPosMonthTotal] = useState(null)
  const [posTickets,  setPosTickets]  = useState([])
  const [costBooks,   setCostBooks]   = useState(null)
  const [hq,          setHq]          = useState(null)
  const [floorGlance, setFloorGlance] = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [periodo,     setPeriodo]     = useState('30')
  const [chartMonth,  setChartMonth]   = useState(null)
  const [showMore,    setShowMore]    = useState(false)

  useEffect(() => { load() }, [bar])

  async function load() {
    const since = (() => {
      const [y, mo] = tokyoMonthKey().split('-').map(Number)
      const d = new Date(y, mo - 1 - 8, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    })()

    const fastP = Promise.all([
      supabase.from('vendas').select('id,bar_id,data,total,obs').eq('bar_id', bar.id).gte('data', since).order('data', { ascending: false }).limit(400),
      supabase.from('pedidos').select('id,status,total_estimado,criado_em').eq('bar_id', bar.id).order('criado_em', { ascending: false }).limit(80),
      supabase.from('faturas').select('*').eq('bar_id', bar.id).order('data_vencimento', { ascending: false }).limit(36),
      supabase.from('pos_vendas').select('total,data,criado_em').eq('bar_id', bar.id).gte('data', since),
      supabase.from('bar_pricing').select('produto_id,drinks_por_garrafa,preco_drink').eq('bar_id', bar.id),
    ])
    const hqP = fetchHqSnapshot().catch(() => null)
    const itensP = supabase
      .from('vendas_itens')
      .select('qtd,preco_unitario,produtos(nome,categoria,preco_venda,volume_ml), vendas(data,bar_id,obs)')
      .eq('vendas.bar_id', bar.id)
      .gte('vendas.data', since)
      .limit(600)
    const floorP = Promise.all([
      supabase.from('bar_spaces').select('id,ativo,ordem,tipo,zona').eq('bar_id', bar.id).eq('ativo', true),
      supabase.from('bar_visits').select('id,space_id,status,guest_id').eq('bar_id', bar.id).in('status', ['seated', 'reserved']),
      supabase.from('bar_guests').select('id,nome,aniversario,ativo').eq('bar_id', bar.id).eq('ativo', true),
    ]).catch(() => null)

    const [vR, pR, fR, posR, bpR] = await fastP
    setVendas(filterSupplierVendas(vR.data || []))
    setPedidos(pR.data || [])
    setFaturas(filterJbmDrinksFaturas(fR.data || []))
    setBarPricing(bpR.data || [])
    const mesKey = tokyoMonthKey()
    if (!posR.error && (posR.data || []).length) {
      const posSales = posR.data || []
      setPosTickets(posSales)
      setPosMonthTotal(posSales.filter(s => (s.data || '').startsWith(mesKey)).reduce((a, s) => a + (+s.total || 0), 0))
    }
    setLoading(false)

    const snap = await hqP
    if (snap) {
      setHq(snap)
      setCostBooks(booksAreSeparate(snap.books) ? snap.books : null)
      if (snap?.pos) {
        setPosTickets(snap.pos.tickets || [])
        setPosMonthTotal(snap.pos.till != null ? snap.pos.till : null)
      }
    } else {
      setHq(null)
      try {
        const books = await loadCostBooks(bar.id)
        setCostBooks(booksAreSeparate(books) ? books : null)
      } catch {
        setCostBooks(null)
      }
    }

    const iR = await itensP
    setItens((iR.data || []).filter(i => i.vendas && filterSupplierVendas([i.vendas]).length))

    try {
      const floorRes = await floorP
      if (!floorRes) {
        setFloorGlance(null)
      } else {
        const [spR, viR, guR] = floorRes
        if (!spR.error) {
          const floor = decorateSpaces(spR.data || [], viR.data || [])
          setFloorGlance({
            seated: floor.filter(s => s.occupied).length,
            reserved: floor.filter(s => s.reserved).length,
            free: floor.filter(s => !s.occupied && !s.reserved).length,
            birthdays: birthdayThisMonth(guR.data || []).length,
          })
        } else {
          setFloorGlance(null)
        }
      }
    } catch {
      setFloorGlance(null)
    }
  }

  const pricingMap = buildPricingMap(barPricing)
  const mes = tokyoMonthKey()
  const account = monthlyAccountSummary(vendas, faturas, mes)
  const monthProjection = analyzePurchases(itens, pricingMap, { monthKey: mes })

  const days = +periodo
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0,10)
  const periodProjection = analyzePurchases(
    itens.filter(it => it.vendas?.data >= cutoffStr),
    pricingMap
  )

  const vendasPeriod = vendas.filter(v => v.data >= cutoffStr)
  const totalPeriod  = vendasPeriod.reduce((a,v) => a+(+v.total||0), 0)
  const avgOrder     = vendasPeriod.length > 0 ? Math.round(totalPeriod / vendasPeriod.length) : 0

  const prev = new Date(cutoff); prev.setDate(prev.getDate() - days)
  const prevStr = prev.toISOString().slice(0,10)
  const vendasPrev = vendas.filter(v => v.data >= prevStr && v.data < cutoffStr)
  const totalPrev  = vendasPrev.reduce((a,v) => a+(+v.total||0), 0)
  const growth     = totalPrev > 0 ? Math.round((totalPeriod-totalPrev)/totalPrev*100) : null

  const { labels: monthLabels, values: monthlyData, keys: monthKeys } = monthlySpendSeries(vendas, 6)
  const chartMonthKey = chartMonth !== null ? monthKeys[chartMonth] : mes
  const chartMonthStats = analyzePurchases(itens, pricingMap, { monthKey: chartMonthKey })

  // Top products by revenue
  const prodMap = {}
  const prodVol = {}
  itens.filter(it => it.vendas?.data >= cutoffStr).forEach(it => {
    const nome = it.produtos?.nome || '?'
    const val  = (it.preco_unitario||0) * it.qtd
    prodMap[nome] = (prodMap[nome]||0) + val
    prodVol[nome] = (prodVol[nome]||0) + it.qtd
  })
  const topRevenue = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,5)
  const topVolume  = Object.entries(prodVol).sort((a,b)=>b[1]-a[1]).slice(0,5)

  // Top by projected margin (bar POS prices via bar_pricing)
  const topMargin = periodProjection.products.slice(0, 6)

  const ativos  = pedidos.filter(p=>p.status==='pendente'||p.status==='confirmado')

  const maxMonth = Math.max(...monthlyData, 1)

  if (loading) return <Spinner text={t('portal.home.loading')} />

  const deliveriesLabel = account.deliveries === 1
    ? t('portal.home.deliveriesThisMonth', { count: account.deliveries })
    : t('portal.home.deliveriesThisMonthPlural', { count: account.deliveries })

  const growthSub = growth !== null
    ? (growth >= 0 ? t('portal.home.growthUp', { pct: growth }) : t('portal.home.growthDown', { pct: growth }))
    : null

  const tableHeaders = [
    t('portal.home.tableProduct'),
    t('portal.home.tableQty'),
    t('portal.home.tableJbmCost'),
    t('portal.home.tablePosPerUnit'),
    t('portal.home.tableTotalMargin'),
    t('portal.home.tableMarginPct'),
    '',
  ]

  const attentionItems = []
  if (account.faturaPendente > 0) {
    attentionItems.push({ tab: 'faturas', text: t('portal.home.pendingInvoice', { amount: fmtYen(account.faturaPendente) }) })
  }
  if (ativos.length > 0) {
    attentionItems.push({ tab: 'pedidos', text: `${t('portal.home.activeOrders')}: ${ativos.length}` })
  }
  if (floorGlance?.birthdays > 0) {
    attentionItems.push({ tab: 'clientes', text: t('portal.home.birthdaysMonth', { count: floorGlance.birthdays }) })
  }

  return (
    <div className="fade-in portal-page easy-dash hq-dash">
      <div className="hq-top">
        <div>
          <div className="hq-title">{bar.nome}</div>
          <div className="hq-sub">{t('portal.home.atAGlance')}</div>
        </div>
      </div>

      <section className="home-band">
        <div className="hq-actions-label">{t('portal.home.doTonight')}</div>
        <BarCommandActions onTab={onTab} ids={['pos', 'pedidos', 'espacos', 'clientes', 'ponto', 'custos']} />
      </section>

      <BarDesk
        bar={bar}
        hq={hq}
        tickets={posTickets}
        invoices={faturas}
        openOrders={ativos.length}
        floor={floorGlance}
        onTab={onTab}
      />

      <section className="home-band">
      <BarOpsGlance
        glance={buildBarOpsGlance({
          hq,
          floor: floorGlance,
          openOrders: ativos.length,
          posTickets,
          posMonthFallback: posMonthTotal,
          account,
          invoices: faturas,
        })}
        onTab={onTab}
      />
      </section>

      <section className="home-band home-band-books">
          {costBooks ? (
            <CostBooksHero books={costBooks} access={access} onSelect={() => onTab('custos')} />
          ) : (
            <div className="portal-grid-hero easy-dash-story" style={{ display:'grid', gridTemplateColumns:'1.1fr 1fr 1fr', gap:14, marginBottom:16 }}>
        <EasyMoneyCard
          kicker={t('portal.home.payJbm')}
          value={fmtYen(account.contaMes)}
          hint={t('portal.home.payJbmHint')}
          tone="navy"
        >
          <div style={{ fontSize:12, opacity:0.8, marginTop:10 }}>
            {deliveriesLabel}
            {account.growth !== null && (
              <span style={{ marginLeft:8, color: account.growth >= 0 ? '#6ee7b7' : '#fca5a5', fontWeight:700 }}>
                {t('portal.home.vsPrevMonth', { dir: account.growth >= 0 ? '↑' : '↓', pct: Math.abs(account.growth) })}
              </span>
            )}
          </div>
        </EasyMoneyCard>

        <EasyMoneyCard
          kicker={t('portal.home.barSold')}
          value={fmtYen(posMonthTotal != null ? posMonthTotal : monthProjection.posTotal)}
          hint={posMonthTotal != null ? t('portal.home.barSoldHint') : t('portal.home.sellAtBarPrice', { pct: monthProjection.posCoveragePct })}
          tone="light"
        >
          {monthProjection.estimatedSharePct > 0 && posMonthTotal == null && (
            <div style={{ marginTop:12, fontSize:11, color:'var(--amber)', fontWeight:600 }}>
              {t('portal.home.estimated', { pct: monthProjection.estimatedSharePct })}
            </div>
          )}
        </EasyMoneyCard>

        <EasyMoneyCard
          kicker={t('portal.home.youKeep')}
          value={fmtYen(monthProjection.margin)}
          hint={t('portal.home.youKeepHint')}
          tone="green"
        >
          <div style={{ fontSize:12, color:'var(--text2)', marginTop:8 }}>
            {t('portal.home.marginOnPos', { pct: monthProjection.marginPct })}
          </div>
          <div style={{ marginTop:12, height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
            <div style={{ height:'100%', width:Math.min(monthProjection.marginPct,100)+'%', background:'var(--green)', borderRadius:3 }}/>
          </div>
        </EasyMoneyCard>
      </div>
      )}

      {attentionItems.length > 0 ? (
        <div className="easy-dash-alert">
          <div style={{ fontSize:11, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:8 }}>{t('portal.home.needsAttention')}</div>
          {attentionItems.map(item => (
            <button key={item.tab} type="button" onClick={() => onTab(item.tab)} className="easy-dash-alert-item">
              {item.text}
            </button>
          ))}
        </div>
      ) : (
        <div className="easy-dash-ok">{t('portal.home.allClear')}</div>
      )}
      </section>

      <button type="button" className="easy-dash-more" onClick={() => setShowMore(v => !v)}>
        {showMore ? t('portal.home.hideDetails') : t('portal.home.showDetails')}
      </button>

      {showMore && (
        <div className="easy-dash-details">
      <div className="hq-filters">
        <div className="hq-filter-group">
          <span className="hq-filter-label">{t('portal.home.filterWindow')}</span>
          {[['7', '7d'], ['30', '30d'], ['90', '90d'], ['365', '1y']].map(([v, l]) => (
            <button key={v} type="button" className={`hq-chip${periodo === v ? ' is-on' : ''}`} onClick={() => setPeriodo(v)}>{l}</button>
          ))}
        </div>
        <div className="hq-panel-hint" style={{ margin: 0 }}>{t('portal.home.windowHint')}</div>
      </div>

      {/* Spend chart — clickable */}
      <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:16, padding:'20px 24px', marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700 }}>{t('portal.home.monthlySpend')}</div>
            <div style={{ fontSize:11, color:'var(--text2)', marginTop:4 }}>{t('portal.home.clickMonth', { month: chartMonthKey })}</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <div style={{ fontSize:13, fontWeight:800, color:'var(--navy)' }}>{fmtYen(chartMonthStats.jbmTotal)}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'flex-end', gap:8, height:100 }}>
          {monthlyData.map((v,i) => {
            const pct = Math.max(v/maxMonth*100, v>0?4:0)
            const isSelected = chartMonth === i || (chartMonth === null && i === 5)
            return (
              <button key={i} type="button" onClick={()=>setChartMonth(i)} style={{
                flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                background:'transparent', border:'none', cursor:'pointer', padding:0,
                opacity: chartMonth === null || chartMonth === i ? 1 : 0.5,
              }}>
                <div style={{ fontSize:10, color:'var(--text2)', fontWeight:600 }}>
                  {v>0 ? (v>=10000 ? Math.round(v/1000)+'k' : fmtYen(v)) : ''}
                </div>
                <div style={{
                  width:'100%', height:pct+'%', minHeight:v>0?4:0,
                  background:isSelected?'var(--navy)':'var(--border)',
                  borderRadius:'6px 6px 0 0', transition:'height 0.3s, background 0.2s',
                  position:'relative'
                }}>
                  {isSelected && v>0 && <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg,rgba(255,255,255,0.15) 0%,transparent 100%)', borderRadius:'6px 6px 0 0' }}/>}
                </div>
                <div style={{ fontSize:10, color:isSelected?'var(--navy)':'var(--text3)', fontWeight:isSelected?700:400 }}>{monthLabels[i]}</div>
              </button>
            )
          })}
        </div>
        {chartMonthStats.jbmTotal > 0 && (
          <div style={{ marginTop:16, padding:'12px 14px', background:'var(--bg3)', borderRadius:12, display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, fontSize:12 }}>
            <div><span style={{ color:'var(--text2)', fontSize:10, display:'block' }}>{t('portal.home.posProjection')}</span><strong style={{ color:'var(--navy)' }}>{fmtYen(chartMonthStats.posTotal)}</strong></div>
            <div><span style={{ color:'var(--text2)', fontSize:10, display:'block' }}>{t('portal.home.projProfit')}</span><strong style={{ color:'var(--green)' }}>{fmtYen(chartMonthStats.margin)}</strong></div>
            <div><span style={{ color:'var(--text2)', fontSize:10, display:'block' }}>ROI</span><strong>{chartMonthStats.roiPct}%</strong></div>
          </div>
        )}
      </div>

      {/* Top products */}
      <div className="portal-grid-2" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
        {/* By revenue */}
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:16, padding:'20px 24px' }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>{t('portal.home.topByCost')}</div>
          <div style={{ fontSize:11, color:'var(--text2)', marginBottom:16 }}>{t('portal.home.whatYouSpent', { days: periodo })}</div>
          {topRevenue.length === 0
            ? <Empty text={t('common.noData')} icon="📊" />
            : topRevenue.map(([nome,val], i) => {
              const pct = val/topRevenue[0][1]*100
              return (
                <div key={nome} style={{ marginBottom:12 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                    <span style={{ fontWeight:i===0?700:500, color:i===0?'var(--navy)':'var(--text)' }}>
                      {i===0?'🥇':i===1?'🥈':i===2?'🥉':'  '} {nome}
                    </span>
                    <span style={{ fontWeight:600 }}>{fmtYen(val)}</span>
                  </div>
                  <div style={{ height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:pct+'%', background:'var(--navy)', borderRadius:2 }}/>
                  </div>
                </div>
              )
            })
          }
        </div>

        {/* By volume */}
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:16, padding:'20px 24px' }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>{t('portal.home.topByVolume')}</div>
          <div style={{ fontSize:11, color:'var(--text2)', marginBottom:16 }}>{t('portal.home.lastDays', { days: periodo })}</div>
          {topVolume.length === 0
            ? <Empty text={t('common.noData')} icon="📊" />
            : topVolume.map(([nome,vol], i) => {
              const pct = vol/topVolume[0][1]*100
              return (
                <div key={nome} style={{ marginBottom:12 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                    <span style={{ fontWeight:i===0?700:500, color:i===0?'var(--navy)':'var(--text)' }}>
                      {i===0?'🥇':i===1?'🥈':i===2?'🥉':'  '} {nome}
                    </span>
                    <span style={{ fontWeight:600, color:'var(--text2)' }}>{vol} {t('portal.home.units')}</span>
                  </div>
                  <div style={{ height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:pct+'%', background:'var(--gold)', borderRadius:2 }}/>
                  </div>
                </div>
              )
            })
          }
        </div>
      </div>

      {/* Top margin — projected from POS pricing */}
      {topMargin.length > 0 && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:16, padding:'20px 24px', marginBottom:16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>{t('portal.home.topMarginTitle')}</div>
              <div style={{ fontSize:11, color:'var(--text2)' }}>{t('portal.home.topMarginSub', { days: periodo })}</div>
            </div>
            <button onClick={()=>onTab('precos')} style={{ fontSize:11, padding:'6px 12px', borderRadius:8, border:'1px solid var(--border)', background:'white', cursor:'pointer', fontWeight:600 }}>
              {t('portal.home.editPrices')}
            </button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10 }}>
            {topMargin.map((p,i) => (
              <div key={p.nome} style={{
                background:i===0?'linear-gradient(135deg,var(--navy),#2563eb)':'var(--bg3)',
                borderRadius:12, padding:'14px',
                border:i===0?'none':'1px solid var(--border)'
              }}>
                <div style={{ fontSize:11, marginBottom:4 }}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':'  '}</div>
                <div style={{ fontSize:11, fontWeight:600, color:i===0?'white':'var(--text)', marginBottom:6, lineHeight:1.3, minHeight:28 }}>
                  {p.nome.length > 22 ? p.nome.slice(0,20)+'…' : p.nome}
                </div>
                <div style={{ fontSize:17, fontWeight:800, color:i===0?'#34c759':'var(--green)' }}>{fmtYen(p.margin)}</div>
                <div style={{ fontSize:10, color:i===0?'rgba(255,255,255,0.6)':'var(--text2)', marginTop:4 }}>
                  {p.marginPct}% · ROI {p.roiPct}{p.source === 'estimate' ? ' · ~' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drink Economics — POS prices from bar_pricing */}
      {(() => {
        const byName = {}
        itens.filter(it => it.vendas?.data >= cutoffStr).forEach(it => {
          const nome = it.produtos?.nome || '?'
          if (!byName[nome]) byName[nome] = { nome, qtd: 0, jbmTotal: 0, posTotal: 0, margin: 0, source: 'pos' }
          const r = projectItemRevenue(it, pricingMap)
          byName[nome].qtd += +it.qtd || 0
          byName[nome].jbmTotal += r.jbmTotal
          byName[nome].posTotal += r.posTotal
          byName[nome].margin += r.margin
          if (r.source === 'estimate') byName[nome].source = 'estimate'
        })
        const rows = Object.values(byName)
          .map(p => ({
            ...p,
            marginPct: p.posTotal > 0 ? Math.round(p.margin / p.posTotal * 100) : 0,
            costPerUnit: p.qtd > 0 ? Math.round(p.jbmTotal / p.qtd) : 0,
            posPerUnit: p.qtd > 0 ? Math.round(p.posTotal / p.qtd) : 0,
          }))
          .filter(p => p.posTotal > 0)
          .sort((a, b) => b.margin - a.margin)
          .slice(0, 12)

        if (rows.length === 0) return null
        return (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:16, padding:'20px 24px', marginBottom:16 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>{t('portal.home.detailTitle')}</div>
            <div style={{ fontSize:11, color:'var(--text2)', marginBottom:16 }}>
              {t('portal.home.detailSub', { days: periodo })}
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ borderBottom:'2px solid var(--border)' }}>
                    {tableHeaders.map(h => (
                      <th key={h || 'empty'} style={{ padding:'8px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r,i) => (
                    <tr key={r.nome} style={{ borderBottom:'1px solid var(--border)', background:i===0?'rgba(193,156,86,0.04)':'transparent' }}>
                      <td style={{ padding:'10px', fontWeight:i===0?700:500 }}>{r.source==='estimate'?'~ ':''}{r.nome}</td>
                      <td style={{ padding:'10px', textAlign:'right' }}>{r.qtd}</td>
                      <td style={{ padding:'10px', textAlign:'right', color:'var(--red)' }}>{fmtYen(r.jbmTotal)}</td>
                      <td style={{ padding:'10px', textAlign:'right' }}>{fmtYen(r.posPerUnit)}</td>
                      <td style={{ padding:'10px', textAlign:'right', fontWeight:700, color:'var(--green)' }}>{fmtYen(r.margin)}</td>
                      <td style={{ padding:'10px', textAlign:'right' }}>
                        <span style={{
                          padding:'3px 8px', borderRadius:20, fontSize:11, fontWeight:700,
                          background: r.marginPct>60?'#f0fdf4':r.marginPct>40?'#fffbeb':'#fef2f2',
                          color: r.marginPct>60?'var(--green)':r.marginPct>40?'var(--amber)':'var(--red)'
                        }}>{r.marginPct}%</span>
                      </td>
                      <td style={{ padding:'10px', textAlign:'right', fontSize:11, color:'var(--navy)', fontWeight:700 }}>{fmtYen(r.posTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* Quick actions + recent */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:12 }}>
        <div style={{ background:'var(--navy)', borderRadius:16, padding:'20px 24px', display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'white', marginBottom:4 }}>{t('portal.home.quickActions')}</div>
          {[
            { label:t('portal.home.openPos'), icon:'🧾', tab:'pos' },
            { label:t('portal.home.openGuests'), icon:'🥂', tab:'clientes' },
            { label:t('portal.home.openFloor'), icon:'🪑', tab:'espacos' },
            { label:t('portal.home.newOrder'), icon:'🛒', tab:'pedidos' },
            { label:t('portal.home.viewDeliveries'), icon:'📦', tab:'entregas' },
            { label:t('portal.home.viewInventory'), icon:'📊', tab:'estoque' },
          ].map(a => (
            <button key={a.tab} onClick={()=>onTab(a.tab)} style={{
              background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.15)',
              borderRadius:10, padding:'10px 14px', color:'white', fontSize:13,
              fontWeight:600, cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:8
            }}><span>{a.icon}</span>{a.label}</button>
          ))}
        </div>

        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:16, padding:'20px 24px' }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:14 }}>{t('portal.home.recentDeliveries')}</div>
          {vendas.length === 0
            ? <Empty text={t('portal.home.noDeliveriesYet')} />
            : vendas.slice(-8).reverse().map(v => (
              <div key={v.id} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                <span style={{ color:'var(--text2)' }}>{fmtDate(v.data)}</span>
                <span style={{ fontWeight:600 }}>{fmtYen(v.total)}</span>
              </div>
            ))
          }
        </div>
      </div>

          <div className="portal-grid-4" style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
            {[
              { label:t('portal.home.totalSpend'), value:fmtYen(totalPeriod), sub: growthSub, subColor:growth>=0?'var(--green)':'var(--red)', color:'var(--navy)' },
              { label:t('common.deliveries'), value:vendasPeriod.length, sub:t('portal.home.inDays', { days: periodo }), color:'var(--blue)' },
              { label:t('portal.home.avgPerDelivery'), value:fmtYen(avgOrder), sub:t('portal.home.perDelivery'), color:'var(--green)' },
              { label:t('portal.home.activeOrders'), value:ativos.length, sub:ativos.length>0?ativos.map(p=>t(`orderStatus.${p.status}`)).join(', '):t('portal.home.allOk'), color:ativos.length>0?'var(--gold)':'var(--green)' },
            ].map(k => (
              <div key={k.label} style={{
                background:'var(--bg2)', border:'1px solid var(--border)',
                borderRadius:16, padding:'16px 18px'
              }}>
                <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8, fontWeight:600 }}>{k.label}</div>
                <div style={{ fontSize:22, fontWeight:800, color:k.color, lineHeight:1 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize:11, color:k.subColor||'var(--text2)', marginTop:6, fontWeight:k.subColor?600:400 }}>{k.sub}</div>}
              </div>
            ))}
          </div>
          <ClientAnalyticsTab bar={bar} onTab={onTab} />
        </div>
      )}
    </div>
  )
}


// ── DELIVERIES ────────────────────────────────────────────────────────────────
function DeliveriesTab({ bar }) {
  const [vendas,    setVendas]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [filterMes, setFilterMes] = useState('')

  useEffect(() => { load() }, [bar])

  async function load() {
    const { data } = await supabase.from('vendas').select('*, vendas_itens(*, produtos(*))').eq('bar_id', bar.id).order('data', { ascending:false })
    setVendas(filterSupplierVendas(data || []))
    setLoading(false)
  }

  const meses = [...new Set(vendas.map(v => v.data?.slice(0,7)).filter(Boolean))].sort().reverse()

  const filtered = vendas.filter(v => {
    if (filterMes && !v.data?.startsWith(filterMes)) return false
    if (dateFrom && v.data < dateFrom) return false
    if (dateTo && v.data > dateTo) return false
    if (search) {
      const s = search.toLowerCase()
      const hasItem = (v.vendas_itens||[]).some(it => it.produtos?.nome?.toLowerCase().includes(s))
      if (!hasItem && !v.data?.includes(s)) return false
    }
    return true
  })

  const total = filtered.reduce((a,v) => a+(+v.total||0), 0)

  if (loading) return <Spinner text="Loading..." />

  return (
    <div className="fade-in">
      <SectionTitle>Delivery history</SectionTitle>

      {/* Filters */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
        <div style={{ position:'relative' }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:14 }}>🔍</span>
          <input type="text" placeholder="Search product..." value={search}
            onChange={e=>setSearch(e.target.value)}
            style={{ paddingLeft:36, width:'100%', borderRadius:10, padding:'9px 12px 9px 36px', fontSize:13 }}
          />
        </div>
        <div>
          <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setFilterMes('')}}
            style={{ width:'100%', borderRadius:10, padding:'9px 12px', fontSize:13 }}
            placeholder="From"
          />
        </div>
        <div>
          <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setFilterMes('')}}
            style={{ width:'100%', borderRadius:10, padding:'9px 12px', fontSize:13 }}
            placeholder="To"
          />
        </div>
      </div>

      {/* Month pills */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:16 }}>
        <button onClick={()=>{setFilterMes('');setDateFrom('');setDateTo('')}} style={{
          padding:'5px 14px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer',
          background:!filterMes&&!dateFrom?'var(--navy)':'var(--bg3)',
          color:!filterMes&&!dateFrom?'white':'var(--text2)', border:'none'
        }}>All</button>
        {meses.map(m => (
          <button key={m} onClick={()=>{setFilterMes(m);setDateFrom('');setDateTo('')}} style={{
            padding:'5px 14px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer',
            background:filterMes===m?'var(--navy)':'var(--bg3)',
            color:filterMes===m?'white':'var(--text2)', border:'none'
          }}>{m}</button>
        ))}
      </div>

      {/* Total */}
      {filtered.length > 0 && (
        <div style={{ marginBottom:14, padding:'12px 16px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:12, fontSize:13, display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'var(--text2)' }}>{filtered.length} deliveries</span>
          <strong>Total: {fmtYen(total)}</strong>
        </div>
      )}

      {filtered.length === 0
        ? <Empty text="No deliveries found" />
        : filtered.map(v => (
          <div key={v.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'16px', marginBottom:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ fontWeight:700, fontSize:14 }}>{fmtDate(v.data)}</span>
              <span style={{ fontWeight:800, color:'var(--navy)', fontSize:15 }}>{fmtYen(v.total)}</span>
            </div>
            {(v.vendas_itens||[]).map(it => (
              <div key={it.id} style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text2)', marginBottom:4 }}>
                <span>{it.produtos?.nome} × {it.qtd}</span>
                <span>{fmtYen((it.preco_unitario||0)*it.qtd)}</span>
              </div>
            ))}
          </div>
        ))
      }
    </div>
  )
}


// ── INVENTORY ────────────────────────────────────────────────────────────────
function InventoryTab({ bar, onOrder }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [produtos,   setProdutos]   = useState([])
  const [movimentos, setMovimentos] = useState([])
  const [regras,     setRegras]     = useState({}) // prodId -> minimo
  const [notes,      setNotes]      = useState([])
  const [pours,      setPours]      = useState([])
  const [pricing,    setPricing]    = useState({})
  const [showUnknown, setShowUnknown] = useState(false)
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState(null) // prodId for modal
  const [modalQty,   setModalQty]   = useState(1)
  const [saving,     setSaving]     = useState(false)
  const [editMin,    setEditMin]     = useState(null)
  const [editMinVal, setEditMinVal]  = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [bar])

  async function load() {
    setLoading(true)
    try {
      const [movimentos, pR, rR, vR, pourR, priceR] = await Promise.all([
        fetchAllStockMovements(supabase, bar.id, '*').catch(() => []),
        supabase.from('produtos_public').select('*').eq('ativo', true).order('categoria').order('nome'),
        supabase.from('estoque_regras').select('*').eq('bar_id', bar.id),
        supabase.from('vendas').select('*, vendas_itens(*, produtos(id,nome))').eq('bar_id', bar.id).order('data', { ascending: false }),
        supabase.from('pos_vendas_itens').select('produto_id,nome,qtd,pos_venda_id'),
        supabase.from('bar_pricing').select('produto_id,drinks_por_garrafa').eq('bar_id', bar.id),
      ])
      setProdutos((pR.data || []).filter(isSupplierProduct))
      setMovimentos(movimentos || [])
      setNotes(filterSupplierVendas(vR.data || []))
      setPours(pourR?.data || [])
      const pMap = {}
      ;(priceR.data || []).forEach(r => { pMap[r.produto_id] = { drinks_por_garrafa: +r.drinks_por_garrafa || 0 } })
      setPricing(pMap)
      const rMap = {}
      ;(rR.data || []).forEach(r => { rMap[r.produto_id] = r.minimo })
      setRegras(rMap)
    } finally {
      setLoading(false)
    }
  }

  async function saveMinimo(prodId, val) {
    const minimo = +val || 0
    await supabase.from('estoque_regras').upsert(
      { bar_id: bar.id, produto_id: prodId, minimo },
      { onConflict: 'bar_id,produto_id' }
    )
    setRegras(prev => ({...prev, [prodId]: minimo}))
    setEditMin(null)
  }

  async function doMove(prodId, tipo) {
    if (!modalQty || modalQty <= 0) return
    setSaving(true)
    await supabase.from('estoque_movimentos').insert({
      produto_id: prodId, bar_id: bar.id, tipo,
      qtd: modalQty, criado_por: user.id,
      obs: tipo === 'entrada' ? 'Stock added' : 'Used'
    })
    setSaving(false)
    setSelected(null)
    setModalQty(1)
    load()
  }

  const moves = coalesceStockMoves(movimentos, deliveryNoteMoves(notes), posPourMoves(pours, pricing))
  const list = decorateStockList(produtos, moves, regras)
  const flow = stockFlow(moves)
  const unknownCount = list.filter(p => p.unknown).length

  const searched = search ? list.filter(p => p.nome.toLowerCase().includes(search.toLowerCase()) || p.categoria.toLowerCase().includes(search.toLowerCase())) : list
  const filtered = showUnknown ? searched : searched.filter(p => p.hasCount)

  const glance = stockGlance(filtered)
  const critical = filtered.filter(p => p.crit)
  const low      = filtered.filter(p => p.low)
  const selectedProd = list.find(p => p.id === selected)

  if (loading) return <Spinner text={t('portal.inventory.loading')} />

      {/* Search bar - added after loading check in render */}

  return (
    <div className="fade-in" style={{ maxWidth:800 }}>

      {/* Alert banners */}
      {critical.length > 0 && (
        <div style={{
          background:'linear-gradient(135deg,#ff3b30 0%,#c0392b 100%)',
          borderRadius:20, padding:'20px 24px', marginBottom:12,
          display:'flex', justifyContent:'space-between', alignItems:'center',
          boxShadow:'0 8px 32px rgba(255,59,48,0.3)'
        }}>
          <div>
            <div style={{ fontSize:17, fontWeight:700, color:'white', marginBottom:6 }}>
              🚨 {t('portal.inventory.outOfStock', { count: critical.length })}
            </div>
            <div style={{ fontSize:13, color:'rgba(255,255,255,0.85)', lineHeight:1.5 }}>
              {critical.map(p => p.nome).join('  ·  ')}
            </div>
          </div>
          <button onClick={onOrder} style={{
            background:'white', color:'#ff3b30', border:'none',
            borderRadius:14, padding:'12px 22px', fontWeight:700,
            fontSize:13, cursor:'pointer', flexShrink:0, marginLeft:16,
            boxShadow:'0 2px 8px rgba(0,0,0,0.1)'
          }}>{t('portal.inventory.orderNow')}</button>
        </div>
      )}

      {low.length > 0 && (
        <div style={{
          background:'linear-gradient(135deg,#ff9500 0%,#e67e22 100%)',
          borderRadius:20, padding:'20px 24px', marginBottom:12,
          display:'flex', justifyContent:'space-between', alignItems:'center',
          boxShadow:'0 8px 32px rgba(255,149,0,0.25)'
        }}>
          <div>
            <div style={{ fontSize:17, fontWeight:700, color:'white', marginBottom:6 }}>
              ⚠️ {t('portal.inventory.runningLow', { count: low.length })}
            </div>
            <div style={{ fontSize:13, color:'rgba(255,255,255,0.85)', lineHeight:1.5 }}>
              {low.map(p => t('portal.inventory.leftMin', { name: p.nome, stock: p.stock, min: p.minimo })).join('  ·  ')}
            </div>
          </div>
          <button onClick={onOrder} style={{
            background:'white', color:'#ff9500', border:'none',
            borderRadius:14, padding:'12px 22px', fontWeight:700,
            fontSize:13, cursor:'pointer', flexShrink:0, marginLeft:16,
            boxShadow:'0 2px 8px rgba(0,0,0,0.1)'
          }}>{t('portal.inventory.orderNow')}</button>
        </div>
      )}

      {/* Search */}
      <div style={{ position:'relative', marginBottom:16 }}>
        <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', fontSize:16, color:'var(--text3)' }}>🔍</span>
        <input
          type="text" placeholder={t('portal.inventory.search')}
          value={search} onChange={e=>setSearch(e.target.value)}
          style={{ width:'100%', padding:'11px 14px 11px 40px', borderRadius:12, fontSize:14 }}
        />
        {search && (
          <button onClick={()=>setSearch('')} style={{
            position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
            background:'none', border:'none', fontSize:16, cursor:'pointer', color:'var(--text3)'
          }}>✕</button>
        )}
      </div>
      {/* Summary */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, margin:'20px 0' }}>
        {[
          { label:t('portal.inventory.totalProducts'), value:glance.total, icon:'📦', color:'var(--navy)' },
          { label:t('portal.inventory.needAttention'), value:glance.needAttention, icon:critical.length>0?'🚨':'⚠️', color:critical.length>0?'#ff3b30':low.length>0?'#ff9500':'var(--green)' },
          { label:t('portal.inventory.wellStocked'), value:glance.wellStocked, icon:'✅', color:'#34c759' },
        ].map(s => (
          <div key={s.label} style={{
            background:'var(--bg2)', border:'1px solid var(--border)',
            borderRadius:16, padding:'16px', textAlign:'center'
          }}>
            <div style={{ fontSize:22, marginBottom:6 }}>{s.icon}</div>
            <div style={{ fontSize:26, fontWeight:800, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:11, color:'var(--text2)', marginTop:3, textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div className="stock-from-hint">{t('portal.inventory.fromDeliveries')}</div>
      <div className="stock-from-hint">{t('portal.inventory.flowHint', { in: flow.delivered, out: flow.poured })}</div>
      {unknownCount > 0 && (
        <div className="stock-from-hint">
          {t('portal.inventory.unknownCount', { count: unknownCount })}
          <button type="button" className="stock-catalog-toggle" onClick={() => setShowUnknown(v => !v)}>
            {showUnknown
              ? t('portal.inventory.hideCatalog')
              : t('portal.inventory.showCatalog', { count: unknownCount })}
          </button>
        </div>
      )}

      {/* Product list */}
      {[...new Set(filtered.map(p=>p.categoria))].map(cat => (
        <div key={cat} style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10, paddingLeft:4 }}>{cat}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {filtered.filter(p=>p.categoria===cat).map(p => {
              const isCrit = p.crit
              const isLow  = p.low
              const dotColor = isCrit ? '#ff3b30' : isLow ? '#ff9500' : p.good ? '#34c759' : '#c5c5c7'
              const pct = p.hasCount && p.minimo > 0 ? Math.min(p.stock / p.minimo * 100, 100) : null
              return (
                <div key={p.id} style={{
                  background:'var(--bg2)',
                  border: isCrit?'1px solid rgba(255,59,48,0.25)':isLow?'1px solid rgba(255,149,0,0.25)':'1px solid var(--border)',
                  borderRadius:14, padding:'14px 16px',
                  display:'flex', alignItems:'center', gap:14,
                  transition:'all 0.15s'
                }}>
                  {/* Status indicator */}
                  <div style={{
                    width:8, height:8, borderRadius:'50%', flexShrink:0,
                    background:dotColor,
                    boxShadow: isCrit?'0 0 10px rgba(255,59,48,0.7)':isLow?'0 0 8px rgba(255,149,0,0.5)':'none'
                  }}/>

                  {/* Name + progress */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:600, marginBottom: pct!==null?6:0 }}>{p.nome}</div>
                    {pct !== null && (
                      <div style={{ height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden', maxWidth:160 }}>
                        <div style={{ height:'100%', width:pct+'%', background:dotColor, borderRadius:2, transition:'width 0.4s' }}/>
                      </div>
                    )}
                  </div>

                  {/* Stock */}
                  <div style={{ textAlign:'center', minWidth:44 }}>
                    <div style={{ fontSize:22, fontWeight:800, color:dotColor, lineHeight:1 }}>{p.hasCount ? p.stock : '—'}</div>
                    <div style={{ fontSize:9, color:'var(--text2)', textTransform:'uppercase', marginTop:2 }}>{p.hasCount ? t('portal.inventory.stock') : t('portal.inventory.noCount')}</div>
                  </div>

                  {/* Min rule */}
                  <div style={{ textAlign:'center', minWidth:44 }}>
                    {editMin===p.id ? (
                      <input type="number" min="0" defaultValue={p.minimo}
                        style={{ width:48, padding:'4px', fontSize:13, textAlign:'center', borderRadius:8 }}
                        autoFocus
                        onBlur={e=>saveMinimo(p.id,e.target.value)}
                        onKeyDown={e=>e.key==='Enter'&&saveMinimo(p.id,e.target.value)}
                      />
                    ) : (
                      <div onClick={()=>setEditMin(p.id)} style={{ cursor:'pointer' }} title="Set minimum stock rule">
                        <div style={{ fontSize:16, fontWeight:700, color:p.minimo>0?'var(--navy)':'var(--text3)' }}>
                          {p.minimo>0?p.minimo:'—'}
                        </div>
                        <div style={{ fontSize:9, color:'var(--text2)', textTransform:'uppercase', marginTop:2 }}>{t('portal.inventory.minimum')}</div>
                      </div>
                    )}
                  </div>

                  {/* Update button */}
                  <button onClick={()=>{setSelected(p.id);setModalQty(1)}} style={{
                    background:'var(--navy)', color:'white', border:'none',
                    borderRadius:10, padding:'8px 16px', fontSize:12,
                    fontWeight:600, cursor:'pointer', flexShrink:0,
                    transition:'opacity 0.15s'
                  }}>{t('portal.inventory.update')}</button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Update modal */}
      {selected && selectedProd && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
          zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20
        }}>
          <div style={{
            background:'var(--bg2)', borderRadius:24, padding:'32px',
            width:'100%', maxWidth:360, boxShadow:'0 24px 60px rgba(0,0,0,0.3)'
          }}>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:4 }}>{selectedProd.nome}</div>
            <div style={{ fontSize:13, color:'var(--text2)', marginBottom:24 }}>
              {t('portal.inventory.currentStock')}: <strong style={{ color:'var(--navy)' }}>{selectedProd.stock}</strong>
              {selectedProd.minimo>0 && <span> · {t('portal.inventory.minLabel')}: <strong>{selectedProd.minimo}</strong></span>}
            </div>

            <label style={{ fontSize:11, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:8 }}>{t('portal.inventory.quantity')}</label>
            <input type="number" min="0.5" step="0.5" value={modalQty}
              onChange={e=>setModalQty(+e.target.value)}
              style={{ width:'100%', padding:'14px', fontSize:20, textAlign:'center', borderRadius:12, fontWeight:700, marginBottom:20 }}
              autoFocus
            />

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              <button onClick={()=>doMove(selected,'entrada')} disabled={saving} style={{
                padding:'14px', borderRadius:14, border:'none',
                background:'linear-gradient(135deg,#34c759,#30b350)',
                color:'white', fontSize:14, fontWeight:700, cursor:'pointer',
                boxShadow:'0 4px 12px rgba(52,199,89,0.3)'
              }}>
                {saving?'..':t('portal.inventory.addStock')}
              </button>
              <button onClick={()=>doMove(selected,'saida')} disabled={saving} style={{
                padding:'14px', borderRadius:14, border:'none',
                background:'linear-gradient(135deg,#ff9500,#e67e22)',
                color:'white', fontSize:14, fontWeight:700, cursor:'pointer',
                boxShadow:'0 4px 12px rgba(255,149,0,0.3)'
              }}>
                {saving?'..':t('portal.inventory.used')}
              </button>
            </div>

            <button onClick={()=>{setSelected(null);setModalQty(1)}} style={{
              width:'100%', padding:'12px', borderRadius:14, border:'1px solid var(--border)',
              background:'transparent', fontSize:13, cursor:'pointer', color:'var(--text2)'
            }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}



// ── PRICING ───────────────────────────────────────────────────────────────────
function PricingTab({ bar }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [produtos,  setProdutos]  = useState([])
  const [pricing,   setPricing]   = useState({}) // prodId -> {drinks_por_garrafa, preco_drink}
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(null)
  const [selected,  setSelected]  = useState(null)
  const [form,      setForm]      = useState({ drinks: '', preco: '' })
  const [search,    setSearch]    = useState('')

  useEffect(() => { load() }, [bar])

  async function load() {
    const [pR, prR] = await Promise.all([
      supabase.from('produtos_public').select('*').eq('ativo', true).order('categoria').order('nome'),
      supabase.from('bar_pricing').select('*').eq('bar_id', bar.id),
    ])
    setProdutos((pR.data || []).filter(isSupplierProduct))
    const pMap = {}
    ;(prR.data || []).forEach(p => { pMap[p.produto_id] = p })
    setPricing(pMap)
    setLoading(false)
  }

  async function savePricing(prodId) {
    const drinks = parseFloat(form.drinks)
    const preco  = parseFloat(form.preco)
    if (!drinks || !preco) return
    setSaving(prodId)
    await supabase.from('bar_pricing').upsert(
      { bar_id: bar.id, produto_id: prodId, drinks_por_garrafa: drinks, preco_drink: preco },
      { onConflict: 'bar_id,produto_id' }
    )
    setSaving(null)
    setSelected(null)
    setForm({ drinks: '', preco: '' })
    load()
  }

  const list = produtos.map(p => {
    const pr = pricing[p.id]
    const drinks = pr?.drinks_por_garrafa || 0
    const preco  = pr?.preco_drink || 0
    const custo_drink = drinks > 0 ? Math.round(p.preco_venda / drinks) : 0
    const margem = preco > 0 && custo_drink > 0 ? Math.round((preco - custo_drink) / preco * 100) : null
    const revenue_garrafa = drinks > 0 ? drinks * preco : 0
    const roi = p.preco_venda > 0 && revenue_garrafa > 0 ? Math.round((revenue_garrafa - p.preco_venda) / p.preco_venda * 100) : null
    return { ...p, drinks, preco, custo_drink, margem, revenue_garrafa, roi }
  })

  const configured = list.filter(p => p.drinks > 0 && p.preco > 0)
  const notConfigured = list.filter(p => !p.drinks || !p.preco)
  const filtered = search
    ? list.filter(p => p.nome.toLowerCase().includes(search.toLowerCase()) || p.categoria.toLowerCase().includes(search.toLowerCase()))
    : list

  const selectedProd = list.find(p => p.id === selected)
  const cats = [...new Set(filtered.map(p => p.categoria))]

  if (loading) return <Spinner text={t('portal.pricing.loading')} />

  return (
    <div className="fade-in" style={{ maxWidth:860 }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800 }}>{t('portal.pricing.title')}</div>
          <div style={{ fontSize:13, color:'var(--text2)', marginTop:2 }}>
            {t('portal.pricing.subtitle')}
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--green)' }}>{configured.length}</div>
          <div style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{t('portal.pricing.configured')}</div>
        </div>
      </div>

      {/* Search */}
      <div style={{ position:'relative', marginBottom:16 }}>
        <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', fontSize:16, color:'var(--text3)' }}>🔍</span>
        <input type="text" placeholder={t('portal.pricing.search')} value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width:'100%', padding:'11px 14px 11px 40px', borderRadius:12, fontSize:14 }}
        />
        {search && <button onClick={()=>setSearch('')} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', fontSize:16, cursor:'pointer', color:'var(--text3)' }}>✕</button>}
      </div>

      {/* Summary cards */}
      {configured.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>
          {[
            { label:t('portal.pricing.avgMargin'), value: Math.round(configured.filter(p=>p.margem!==null).reduce((a,p)=>a+p.margem,0)/configured.filter(p=>p.margem!==null).length||0)+'%', color:'var(--green)', icon:'📈' },
            { label:t('portal.pricing.bestMargin'), value: configured.filter(p=>p.margem!==null).sort((a,b)=>b.margem-a.margem)[0]?.nome?.split(' ')[0]||'—', color:'var(--navy)', icon:'🏆' },
            { label:t('portal.pricing.notSet'), value: notConfigured.length, color: notConfigured.length>0?'var(--amber)':'var(--green)', icon:'⚙️' },
          ].map(s => (
            <div key={s.label} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:22 }}>{s.icon}</span>
              <div>
                <div style={{ fontSize:18, fontWeight:800, color:s.color }}>{s.value}</div>
                <div style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Product list by category */}
      {cats.map(cat => (
        <div key={cat} style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10, paddingLeft:4 }}>{cat}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {filtered.filter(p=>p.categoria===cat).map(p => {
              const isSet = p.drinks > 0 && p.preco > 0
              return (
                <div key={p.id} style={{
                  background:'var(--bg2)',
                  border: isSet ? '1px solid var(--border)' : '1px dashed var(--border)',
                  borderRadius:14, padding:'14px 16px',
                  display:'flex', alignItems:'center', gap:14
                }}>
                  {/* Status */}
                  <div style={{ width:8, height:8, borderRadius:'50%', flexShrink:0,
                    background: !isSet ? 'var(--text3)' : p.margem > 60 ? '#34c759' : p.margem > 40 ? '#ff9500' : 'var(--red)',
                    boxShadow: isSet && p.margem > 60 ? '0 0 8px rgba(52,199,89,0.5)' : 'none'
                  }}/>

                  {/* Name */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>{p.nome}</div>
                    <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>
                      {t('portal.pricing.jbmCost', { amount: fmtYen(p.preco_venda) })}
                      {isSet && <span style={{ marginLeft:8 }}>· {t('portal.pricing.drinksBottle', { count: p.drinks, amount: fmtYen(p.custo_drink) })}</span>}
                    </div>
                  </div>

                  {/* Stats if set */}
                  {isSet && (
                    <>
                      <div style={{ textAlign:'center', minWidth:64 }}>
                        <div style={{ fontSize:15, fontWeight:800, color:'var(--navy)' }}>{fmtYen(p.preco)}</div>
                        <div style={{ fontSize:9, color:'var(--text2)', textTransform:'uppercase', marginTop:1 }}>{t('portal.pricing.priceDrink')}</div>
                      </div>
                      <div style={{ textAlign:'center', minWidth:54 }}>
                        <div style={{ fontSize:15, fontWeight:800, color:p.margem>60?'#34c759':p.margem>40?'#ff9500':'var(--red)' }}>{p.margem}%</div>
                        <div style={{ fontSize:9, color:'var(--text2)', textTransform:'uppercase', marginTop:1 }}>{t('portal.pricing.margin')}</div>
                      </div>
                      <div style={{ textAlign:'center', minWidth:70 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'var(--green)' }}>{fmtYen(p.revenue_garrafa)}</div>
                        <div style={{ fontSize:9, color:'var(--text2)', textTransform:'uppercase', marginTop:1 }}>{t('portal.pricing.revBottle')}</div>
                      </div>
                    </>
                  )}

                  {/* Set/Edit button */}
                  <button onClick={()=>{ setSelected(p.id); setForm({ drinks: p.drinks||'', preco: p.preco||'' }) }} style={{
                    background: isSet ? 'var(--bg3)' : 'var(--navy)',
                    color: isSet ? 'var(--text)' : 'white',
                    border: isSet ? '1px solid var(--border)' : 'none',
                    borderRadius:10, padding:'8px 14px', fontSize:12,
                    fontWeight:600, cursor:'pointer', flexShrink:0
                  }}>{isSet ? t('portal.pricing.edit') : t('portal.pricing.setPrice')}</button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Modal */}
      {selected && selectedProd && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--bg2)', borderRadius:24, padding:'32px', width:'100%', maxWidth:380, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:4 }}>{selectedProd.nome}</div>
            <div style={{ fontSize:13, color:'var(--text2)', marginBottom:24 }}>
              {t('portal.pricing.jbmCostBottle')}: <strong>{fmtYen(selectedProd.preco_venda)}</strong>
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:11, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:8 }}>
                {t('portal.pricing.drinksPerBottle')}
              </label>
              <input type="number" min="1" step="1" value={form.drinks}
                onChange={e=>setForm({...form, drinks:e.target.value})}
                placeholder={t('portal.pricing.drinksPlaceholder')}
                style={{ width:'100%', padding:'12px 14px', fontSize:16, borderRadius:12 }}
                autoFocus
              />
              {form.drinks > 0 && selectedProd.preco_venda > 0 && (
                <div style={{ fontSize:12, color:'var(--text2)', marginTop:6 }}>
                  {t('portal.pricing.costPerDrink')}: <strong style={{ color:'var(--red)' }}>{fmtYen(Math.round(selectedProd.preco_venda / form.drinks))}</strong>
                </div>
              )}
            </div>

            <div style={{ marginBottom:24 }}>
              <label style={{ fontSize:11, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:8 }}>
                {t('portal.pricing.yourPrice')}
              </label>
              <input type="number" min="0" value={form.preco}
                onChange={e=>setForm({...form, preco:e.target.value})}
                placeholder={t('portal.pricing.pricePlaceholder')}
                style={{ width:'100%', padding:'12px 14px', fontSize:16, borderRadius:12 }}
              />
              {form.drinks > 0 && form.preco > 0 && selectedProd.preco_venda > 0 && (
                <div style={{ marginTop:10, padding:'12px 14px', background:'var(--bg3)', borderRadius:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:6 }}>
                    <span style={{ color:'var(--text2)' }}>Cost/drink</span>
                    <span style={{ color:'var(--red)', fontWeight:600 }}>{fmtYen(Math.round(selectedProd.preco_venda/form.drinks))}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:6 }}>
                    <span style={{ color:'var(--text2)' }}>Margin/drink</span>
                    <span style={{ color:'var(--green)', fontWeight:600 }}>{fmtYen(Math.round(form.preco - selectedProd.preco_venda/form.drinks))}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:14, fontWeight:700 }}>
                    <span>Revenue/bottle</span>
                    <span style={{ color:'var(--navy)' }}>{fmtYen(Math.round(form.drinks * form.preco))}</span>
                  </div>
                  <div style={{ marginTop:8, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
                    <div style={{
                      height:'100%', borderRadius:2,
                      width: Math.min(Math.round((form.preco - selectedProd.preco_venda/form.drinks)/form.preco*100), 100) + '%',
                      background: Math.round((form.preco - selectedProd.preco_venda/form.drinks)/form.preco*100) > 60 ? '#34c759' : '#ff9500'
                    }}/>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text2)', marginTop:4, textAlign:'right' }}>
                    {Math.round((form.preco - selectedProd.preco_venda/form.drinks)/form.preco*100)}% margin
                  </div>
                </div>
              )}
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:10 }}>
              <button onClick={()=>{setSelected(null);setForm({drinks:'',preco:''})}} style={{
                padding:'13px', borderRadius:14, border:'1px solid var(--border)',
                background:'transparent', fontSize:13, cursor:'pointer', color:'var(--text2)'
              }}>Cancel</button>
              <button onClick={()=>savePricing(selected)} disabled={!form.drinks||!form.preco||saving===selected} style={{
                padding:'13px', borderRadius:14, border:'none',
                background:'var(--navy)', color:'white',
                fontSize:13, fontWeight:700, cursor:'pointer'
              }}>
                {saving===selected ? 'Saving...' : 'Save pricing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ── MENU ─────────────────────────────────────────────────────────────────────
function MenuTab({ bar }) {
  const { t } = useI18n()
  const [drinks,   setDrinks]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [cat,      setCat]      = useState('')
  const [sortBy,   setSortBy]   = useState('margem')
  const [showAdd,  setShowAdd]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [editId,   setEditId]   = useState(null)

  const [ingredientes, setIngredientes] = useState([]) // {nome, volume_garrafa, preco_garrafa, ml_no_drink}
  const emptyForm = { nome:'', categoria:'Custom', receita:'', copo:'', preco_venda:'', custo:'', preco_desconto:'', notas:'' }
  const emptyIng  = { nome:'', volume_garrafa: '', preco_garrafa: '', ml_no_drink: '' }
  const [form, setForm] = useState(emptyForm)

  const [produtosDB, setProdutosDB] = useState([])

  useEffect(() => { load() }, [bar])

  async function load() {
    const [dR, pR] = await Promise.all([
      supabase.from('drink_menu').select('*').eq('bar_id', bar.id).order('categoria').order('nome'),
      supabase.from('produtos_public').select('*').eq('ativo',true).order('nome')
    ])
    setDrinks(dR.data || [])
    setProdutosDB(pR.data || [])
    setLoading(false)
  }

  async function saveDrink() {
    if (!form.nome || !form.preco_venda) return
    setSaving(true)
    // Auto-calculate cost from ingredientes if set
    const autoCost = ingredientes.filter(i=>i.preco_garrafa&&i.volume_garrafa&&i.ml_no_drink)
      .reduce((sum,i) => sum + Math.round((+i.preco_garrafa/+i.volume_garrafa)*(+i.ml_no_drink)), 0)
    const finalCost = autoCost > 0 ? autoCost : (+form.custo||0)
    const autoReceita = ingredientes.filter(i=>i.nome&&i.ml_no_drink).map(i=>i.nome+' '+i.ml_no_drink+'ml').join(' + ')
    const payload = {
      bar_id: bar.id,
      nome: form.nome,
      categoria: form.categoria || 'Custom',
      receita: autoReceita || form.receita || '',
      copo: form.copo || '',
      preco_venda: +form.preco_venda || 0,
      custo: finalCost,
      margem: form.preco_venda > 0 ? (+form.preco_venda - finalCost) / +form.preco_venda : 0,
      preco_desconto: +form.preco_desconto || 500,
      notas: form.notas || '',
      custom: true
    }
    if (editId) {
      await supabase.from('drink_menu').update(payload).eq('id', editId)
    } else {
      await supabase.from('drink_menu').insert(payload)
    }
    setSaving(false)
    setShowAdd(false)
    setEditId(null)
    setForm(emptyForm)
    setIngredientes([])
    load()
  }

  async function deleteDrink(id) {
    if (!confirm(t('portal.menu.deleteConfirm'))) return
    await supabase.from('drink_menu').delete().eq('id', id)
    load()
  }

  function startEdit(d) {
    setForm({ nome:d.nome, categoria:d.categoria, receita:d.receita||'', copo:d.copo||'',
      preco_venda:d.preco_venda, custo:d.custo, preco_desconto:d.preco_desconto||500, notas:d.notas||'' })
    setEditId(d.id)
    setShowAdd(true)
  }

  const cats = [...new Set(drinks.map(d => d.categoria))]
  const allCats = [...new Set([...cats, 'Custom', 'Hennessy','Shochu Hai','Vodka Base','Gin Base','Whisky Base','Tequila Base','Rum Base','Shots','Liqueurs','Champagne','Wine','Beer','Soft Drinks'])]

  const filtered = drinks
    .filter(d => {
      if (cat && d.categoria !== cat) return false
      if (search) {
        const s = search.toLowerCase()
        return d.nome.toLowerCase().includes(s) || (d.receita||'').toLowerCase().includes(s)
      }
      return true
    })
    .sort((a,b) => {
      if (sortBy === 'margem') return b.margem - a.margem
      if (sortBy === 'custo') return a.custo - b.custo
      if (sortBy === 'preco') return b.preco_venda - a.preco_venda
      return a.nome.localeCompare(b.nome)
    })

  const avgMargem = drinks.length > 0 ? Math.round(drinks.reduce((a,d) => a + d.margem, 0) / drinks.length * 100) : 0
  const topDrink  = [...drinks].sort((a,b) => b.margem - a.margem)[0]
  const lowDrink  = [...drinks].sort((a,b) => a.margem - b.margem)[0]

  const liveMargin = form.preco_venda && form.custo
    ? Math.round((+form.preco_venda - +form.custo) / +form.preco_venda * 100) : null
  const liveMarginVip = form.preco_desconto && form.custo
    ? Math.round((+form.preco_desconto - +form.custo) / +form.preco_desconto * 100) : null

  if (loading) return <Spinner text={t('portal.menu.title')} />

  return (
    <div className="fade-in" style={{ maxWidth:900 }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800 }}>{t('portal.menu.title')}</div>
          <div style={{ fontSize:13, color:'var(--text2)', marginTop:2 }}>{t('portal.menu.drinksMeta', { count: drinks.length })}</div>
        </div>
        <button className="btn-primary" onClick={()=>{setShowAdd(x=>!x);setEditId(null);setForm(emptyForm)}}
          style={{ padding:'9px 18px', borderRadius:10 }}>
          {showAdd ? t('common.cancel') : t('portal.menu.addDrink')}
        </button>
      </div>

      {/* Add/Edit form */}
      {showAdd && (
        <div style={{ background:'var(--bg2)', border:'2px solid rgba(193,156,86,0.3)', borderRadius:16, padding:'24px', marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:16 }}>{editId ? t('portal.menu.editDrink') : t('portal.menu.addCustom')}</div>

          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <label className="form-label">{t('portal.menu.name')}</label>
              <input type="text" value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} placeholder={t('portal.menu.namePlaceholder')} />
            </div>
            <div>
              <label className="form-label">{t('portal.menu.category')}</label>
              <select value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value})}>
                {allCats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <label className="form-label">{t('portal.menu.recipe')}</label>
              <input type="text" value={form.receita} onChange={e=>setForm({...form,receita:e.target.value})} placeholder={t('portal.menu.recipePlaceholder')} />
            </div>
            <div>
              <label className="form-label">{t('portal.menu.glass')}</label>
              <input type="text" value={form.copo} onChange={e=>setForm({...form,copo:e.target.value})} placeholder={t('portal.menu.glassPlaceholder')} />
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <label className="form-label">{t('portal.menu.salePrice')}</label>
              <input type="number" value={form.preco_venda} onChange={e=>setForm({...form,preco_venda:e.target.value})} placeholder="1000" />
            </div>
            <div>
              <label className="form-label">{t('portal.menu.cost')}</label>
              <input type="number" value={form.custo} onChange={e=>setForm({...form,custo:e.target.value})} placeholder="0" />
            </div>
            <div>
              <label className="form-label">VIP/Disc. price (¥)</label>
              <input type="number" value={form.preco_desconto} onChange={e=>setForm({...form,preco_desconto:e.target.value})} placeholder="500" />
            </div>
          </div>

          {/* Live margin preview */}
          {liveMargin !== null && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              <div style={{ padding:'12px 16px', borderRadius:12, background: liveMargin>70?'#f0fdf4':'#fffbeb', border:'1px solid', borderColor:liveMargin>70?'#86efac':'#fcd34d' }}>
                <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>Regular margin</div>
                <div style={{ fontSize:22, fontWeight:800, color:liveMargin>70?'#16a34a':'#d97706' }}>{liveMargin}%</div>
                <div style={{ fontSize:11, color:'var(--text2)' }}>¥{Math.round(+form.preco_venda - +form.custo).toLocaleString()} profit/drink</div>
              </div>
              {liveMarginVip !== null && (
                <div style={{ padding:'12px 16px', borderRadius:12, background:liveMarginVip>50?'#fdf8ec':'#fef2f2', border:'1px solid', borderColor:liveMarginVip>50?'var(--gold)':'#fca5a5' }}>
                  <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>VIP margin</div>
                  <div style={{ fontSize:22, fontWeight:800, color:liveMarginVip>50?'var(--gold)':'#dc2626' }}>{liveMarginVip}%</div>
                  <div style={{ fontSize:11, color:'var(--text2)' }}>¥{Math.round(+form.preco_desconto - +form.custo).toLocaleString()} profit/drink</div>
                </div>
              )}
            </div>
          )}

          {/* Ingredient cost calculator */}
          <div style={{ marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <label className="form-label" style={{ marginBottom:0 }}>Ingredients (auto-calculate cost)</label>
              <button type="button" onClick={()=>setIngredientes([...ingredientes,{...emptyIng}])}
                style={{ fontSize:11, padding:'4px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg3)', cursor:'pointer', fontWeight:600 }}>+ Add ingredient</button>
            </div>
            {ingredientes.map((ing,idx) => {
              const selProd = produtosDB.find(p=>p.id===ing.produto_id)
              const costPerMl = selProd && selProd.volume_ml > 0 ? selProd.preco_venda / selProd.volume_ml : 0
              const ingCost = costPerMl > 0 && ing.ml_no_drink ? Math.round(costPerMl * +ing.ml_no_drink) : 0
              return (
                <div key={idx} style={{ background:'var(--bg3)', borderRadius:10, padding:'10px 12px', marginBottom:8 }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 28px', gap:8, marginBottom:8, alignItems:'center' }}>
                    <select value={ing.produto_id||''} onChange={e=>{
                      const p = produtosDB.find(x=>x.id===e.target.value)
                      const a=[...ingredientes]
                      a[idx]={...a[idx], produto_id:e.target.value, nome:p?.nome||'', volume_garrafa:p?.volume_ml||0, preco_garrafa:p?.preco_venda||0}
                      setIngredientes(a)
                    }} style={{ padding:'8px 10px', borderRadius:8, fontSize:13 }}>
                      <option value="">Select product from JBM catalogue...</option>
                      {produtosDB.map(p=>(
                        <option key={p.id} value={p.id}>{p.nome} — ¥{p.preco_venda?.toLocaleString()} / {p.volume_ml||'?'}ml</option>
                      ))}
                    </select>
                    <button onClick={()=>setIngredientes(ingredientes.filter((_,i)=>i!==idx))}
                      style={{ padding:'6px', borderRadius:6, border:'none', background:'#fef2f2', color:'var(--red)', cursor:'pointer', fontSize:13 }}>✕</button>
                  </div>
                  {selProd && (
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ flex:1 }}>
                        <label style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:4 }}>ml in this drink</label>
                        <input type="number" min="0" step="5" placeholder="e.g. 30"
                          value={ing.ml_no_drink} onChange={e=>{const a=[...ingredientes];a[idx]={...a[idx],ml_no_drink:e.target.value};setIngredientes(a)}}
                          style={{ width:'100%', padding:'7px 10px', borderRadius:8, fontSize:13 }} />
                      </div>
                      <div style={{ textAlign:'center', minWidth:80 }}>
                        <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Cost</div>
                        <div style={{ fontSize:16, fontWeight:800, color: ingCost>0?'var(--red)':'var(--text3)' }}>
                          {ingCost>0 ? '¥'+ingCost.toLocaleString() : '—'}
                        </div>
                      </div>
                      <div style={{ textAlign:'center', minWidth:100, fontSize:11, color:'var(--text2)' }}>
                        ¥{selProd.preco_venda?.toLocaleString()} / {selProd.volume_ml}ml<br/>
                        <span style={{ fontSize:10 }}>= ¥{costPerMl.toFixed(1)}/ml</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {ingredientes.length > 0 && (() => {
              const autoCost = ingredientes.filter(i=>i.preco_garrafa&&i.volume_garrafa&&i.ml_no_drink)
                .reduce((sum,i)=>sum+Math.round((+i.preco_garrafa/+i.volume_garrafa)*(+i.ml_no_drink)),0)
              if (autoCost === 0) return null
              const margem = form.preco_venda > 0 ? Math.round((+form.preco_venda-autoCost)/+form.preco_venda*100) : null
              return (
                <div style={{ padding:'10px 14px', background:'var(--bg3)', borderRadius:10, fontSize:13, display:'flex', gap:20 }}>
                  <span>🧮 Auto cost: <strong style={{color:'var(--red)'}}>¥{autoCost.toLocaleString()}</strong></span>
                  {margem!==null && <span>Margin: <strong style={{color:margem>70?'var(--green)':'var(--amber)'}}>{margem}%</strong></span>}
                  {form.preco_venda && <span>Profit: <strong style={{color:'var(--green)'}}>¥{(+form.preco_venda-autoCost).toLocaleString()}</strong></span>}
                </div>
              )
            })()}
          </div>

          <div style={{ marginBottom:12 }}>
            <label className="form-label">Notes</label>
            <input type="text" value={form.notas} onChange={e=>setForm({...form,notas:e.target.value})} placeholder="Special instructions, variations..." />
          </div>

          <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
            <button onClick={()=>{setShowAdd(false);setEditId(null);setForm(emptyForm)}}
              style={{ padding:'10px 20px', borderRadius:10, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>Cancel</button>
            <button className="btn-primary" onClick={saveDrink} disabled={saving || !form.nome || !form.preco_venda}
              style={{ padding:'10px 20px', borderRadius:10 }}>
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Add drink'}
            </button>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
          <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Avg margin</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--green)' }}>{avgMargem}%</div>
          <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>across all drinks</div>
        </div>
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
          <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Best margin 🏆</div>
          <div style={{ fontSize:13, fontWeight:700 }}>{topDrink?.nome}</div>
          <div style={{ fontSize:13, color:'var(--green)', fontWeight:700 }}>{topDrink ? Math.round(topDrink.margem*100)+'%' : ''}</div>
        </div>
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
          <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Watch out ⚠️</div>
          <div style={{ fontSize:13, fontWeight:700 }}>{lowDrink?.nome}</div>
          <div style={{ fontSize:13, color:'var(--red)', fontWeight:700 }}>{lowDrink ? Math.round(lowDrink.margem*100)+'%' : ''}</div>
        </div>
      </div>

      {/* Search + sort */}
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <div style={{ position:'relative', flex:1 }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)' }}>🔍</span>
          <input type="text" placeholder="Search drink or ingredient..." value={search}
            onChange={e=>setSearch(e.target.value)}
            style={{ width:'100%', padding:'10px 12px 10px 36px', borderRadius:10, fontSize:13 }}
          />
          {search && <button onClick={()=>setSearch('')} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:14 }}>✕</button>}
        </div>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ width:'auto', fontSize:12 }}>
          <option value="margem">Margin ↓</option>
          <option value="nome">Name</option>
          <option value="custo">Cost ↑</option>
          <option value="preco">Price ↓</option>
        </select>
      </div>

      {/* Category pills */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:16 }}>
        <button onClick={()=>setCat('')} style={{ padding:'5px 14px', borderRadius:20, fontSize:11, fontWeight:600, background:!cat?'var(--navy)':'var(--bg3)', color:!cat?'white':'var(--text2)', border:'none', cursor:'pointer' }}>
          All ({drinks.length})
        </button>
        {cats.map(c => (
          <button key={c} onClick={()=>setCat(c===cat?'':c)} style={{ padding:'5px 14px', borderRadius:20, fontSize:11, fontWeight:600, background:cat===c?'var(--navy)':'var(--bg3)', color:cat===c?'white':'var(--text2)', border:'none', cursor:'pointer' }}>
            {c} ({drinks.filter(d=>d.categoria===c).length})
          </button>
        ))}
      </div>

      {/* Table header */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 80px 70px 70px 64px 64px 64px', gap:8, padding:'6px 14px', fontSize:10, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em' }}>
        <span>Drink · Recipe</span>
        <span style={{ textAlign:'right' }}>Price</span>
        <span style={{ textAlign:'right' }}>Cost</span>
        <span style={{ textAlign:'right' }}>VIP</span>
        <span style={{ textAlign:'center' }}>Margin</span>
        <span style={{ textAlign:'center' }}>VIP %</span>
        <span></span>
      </div>

      {/* Drink rows */}
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {filtered.map(d => {
          const margPct = Math.round(d.margem * 100)
          const vipMarg = d.preco_desconto && d.custo ? Math.round((d.preco_desconto - d.custo) / d.preco_desconto * 100) : null
          const margColor = margPct >= 85 ? '#34c759' : margPct >= 70 ? '#ff9500' : '#ff3b30'
          const vipColor  = vipMarg !== null ? (vipMarg >= 50 ? '#f59e0b' : '#ff3b30') : 'var(--text3)'
          return (
            <div key={d.id} style={{
              display:'grid', gridTemplateColumns:'1fr 80px 70px 70px 64px 64px 64px',
              gap:8, padding:'10px 14px', alignItems:'center',
              background:'var(--bg2)', border:'1px solid var(--border)',
              borderLeft: d.custom ? '3px solid var(--gold)' : '3px solid transparent',
              borderRadius:10
            }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600 }}>{d.nome} {d.custom && <span style={{ fontSize:10, color:'var(--gold)', fontWeight:700 }}>CUSTOM</span>}</div>
                <div style={{ fontSize:11, color:'var(--text2)', marginTop:1 }}>{d.receita} {d.copo ? '· '+d.copo : ''}</div>
                {d.notas && <div style={{ fontSize:11, color:'var(--gold)', marginTop:1 }}>📝 {d.notas}</div>}
              </div>
              <div style={{ textAlign:'right', fontSize:13, fontWeight:700 }}>¥{d.preco_venda.toLocaleString()}</div>
              <div style={{ textAlign:'right', fontSize:12, color:'var(--red)' }}>¥{d.custo.toLocaleString()}</div>
              <div style={{ textAlign:'right', fontSize:12, color:'var(--gold)' }}>
                {d.preco_desconto ? '¥'+d.preco_desconto.toLocaleString() : '—'}
              </div>
              <div style={{ textAlign:'center' }}>
                <span style={{ fontSize:13, fontWeight:800, color:margColor }}>{margPct}%</span>
              </div>
              <div style={{ textAlign:'center' }}>
                <span style={{ fontSize:12, fontWeight:700, color:vipColor }}>{vipMarg !== null ? vipMarg+'%' : '—'}</span>
              </div>
              <div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                <button onClick={()=>startEdit(d)} style={{ padding:'4px 8px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'transparent', cursor:'pointer', color:'var(--text2)' }}>✏️</button>
                <button onClick={()=>deleteDrink(d.id)} style={{ padding:'4px 8px', fontSize:11, borderRadius:6, border:'none', background:'#fef2f2', cursor:'pointer', color:'var(--red)' }}>🗑</button>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && <Empty text="No drinks found" icon="🍹" />}
      </div>
    </div>
  )
}



// ── FATURAS CLIENTE ───────────────────────────────────────────────────────────
function FaturasTab({ bar }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [faturas, setFaturas] = useState([])
  const [vendas, setVendas] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [payModal, setPayModal] = useState(null)
  const PAY_METHODS = [
    { value: 'transfer', label: t('portal.invoices.payMethodTransfer') },
    { value: 'card', label: t('portal.invoices.payMethodCard') },
    { value: 'cash', label: t('portal.invoices.payMethodCash') },
  ]
  const [payForm, setPayForm] = useState({ valor:"", metodo:"transfer", notas:"" })
  const [image, setImage] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scannedData, setScannedData] = useState(null)
  const [emittingReceipt, setEmittingReceipt] = useState(null)
  const [ryoSeq, setRyoSeq] = useState(1)

  useEffect(() => { load() }, [bar])

  async function load() {
    const [fR, vR, pR] = await Promise.all([
      supabase.from("faturas").select("*").eq("bar_id", bar.id).order("data_vencimento", { ascending:false }),
      supabase.from("vendas").select("total,data").eq("bar_id", bar.id).order("data", { ascending:false }),
      supabase.from("fatura_pagamentos").select("*, faturas!inner(bar_id)").eq("faturas.bar_id", bar.id).order("criado_em", { ascending:false }),
    ])
    const jbmFaturas = filterJbmDrinksFaturas(fR.data || [])
    setFaturas(jbmFaturas)
    setVendas(filterSupplierVendas(vR.data||[]))
    setPagamentos(pR.data||[])
    const { count } = await supabase.from('ryoshusho').select('id', { count: 'exact', head: true }).eq('bar_id', bar.id)
    setRyoSeq((count || 0) + 1)
    setLoading(false)
  }

  async function emitPaymentReceipt({ key, valor, data, metodo, notas, fatura }) {
    if (!valor) return
    setEmittingReceipt(key)
    try {
      const numero = buildRyoshushoNumero(ryoSeq)
      const dataEmissao = (data || new Date().toISOString().slice(0, 10)).slice(0, 10)
      const html = buildPaymentRyoshushoHtml({
        numero,
        dataEmissao,
        barNome: bar.nome,
        valor,
        metodo,
        notas,
        periodoInicio: faturaEmissao(fatura),
        periodoFim: faturaPeriodoFim(fatura),
      })
      printRyoshushoHtml(html)
      await savePaymentRyoshusho(supabase, {
        barId: bar.id,
        numero,
        dataEmissao,
        valor,
        metodo,
        periodoInicio: faturaEmissao(fatura),
        periodoFim: faturaPeriodoFim(fatura),
      })
      setRyoSeq(s => s + 1)
    } finally {
      setEmittingReceipt(null)
    }
  }

  async function scanReceipt(imageData) {
    if (!imageData) return
    setScanning(true)
    setScannedData(null)
    try {
      const image = imageDataUrlToParts(imageData)
      const text = await callGeminiChat({
        messages: [{
          role: 'user',
          content: 'Payment receipt. Extract: amount in yen, date, method. Reply ONLY JSON: {valor:number,data:"YYYY-MM-DD",metodo:string}',
        }],
        image,
        temperature: 0.2,
        maxOutputTokens: 256,
      })
      const parsed = parseJsonFromAI(text)
      setScannedData(parsed)
      if (parsed.valor) setPayForm(f => ({ ...f, valor: parsed.valor, metodo: parsed.metodo || f.metodo }))
    } catch (e) {
      console.error(e)
    }
    setScanning(false)
  }

  async function submitPayment() {
    if (!payForm.valor || !payModal) return
    setSaving(true)
    let comprovante_url = null
    if (image) {
      const blob = await fetch(image).then(r=>r.blob())
      const isPdf = blob.type === 'application/pdf'
      const ext = isPdf ? 'pdf' : 'jpg'
      const filename = "recibos/" + bar.id + "/" + Date.now() + "." + ext
      const { data: up } = await supabase.storage.from("recibos").upload(filename, blob, { contentType: blob.type || (isPdf ? 'application/pdf' : 'image/jpeg') })
      if (up) {
        const { data: urlD } = supabase.storage.from("recibos").getPublicUrl(filename)
        comprovante_url = urlD.publicUrl
      }
    }
    await supabase.from("fatura_pagamentos").insert({
      fatura_id: payModal.id, valor:+payForm.valor, metodo:payForm.metodo,
      notas:payForm.notas, data:new Date().toISOString().slice(0,10),
      comprovante_url, confirmado:false, submetido_por:user?.id
    })
    setSaving(false); setPayModal(null); setPayForm({ valor:"", metodo:"transfer", notas:"" }); setImage(null); setScannedData(null); load()
  }

  const filtered = faturas.filter(f => {
    const emissao = faturaEmissao(f)
    const venc = faturaVencimento(f)
    if (dateFrom && emissao && emissao < dateFrom) return false
    if (dateTo && venc && venc > dateTo) return false
    return true
  })
  const pending = filtered.filter(f=>f.status!=="pago")
  const totalPending = pending.reduce((a,f)=>a+faturaRemaining(f),0)
  const overdue = pending.filter(f=>faturaVencimento(f) && new Date(faturaVencimento(f))<new Date())
  const aging = arAging(filtered)
  const upcoming = pending.filter(f=>!faturaVencimento(f) || new Date(faturaVencimento(f))>=new Date()).sort((a,b)=>faturaVencimento(a).localeCompare(faturaVencimento(b)))
  const monthlySpend = []
  const monthLabels = []
  for (let i=5; i>=0; i--) {
    const d = new Date(); d.setMonth(d.getMonth()-i)
    const mk = d.toISOString().slice(0,7)
    monthLabels.push(mk.slice(5))
    monthlySpend.push(vendas.filter(v=>v.data?.startsWith(mk)).reduce((a,v)=>a+(+v.total||0),0))
  }
  const maxSpend = Math.max(...monthlySpend, 1)
  const mwd = monthlySpend.filter(v=>v>0).length
  const avgMonthly = mwd>0?Math.round(monthlySpend.reduce((a,v)=>a+v,0)/mwd):0
  if (loading) return <Spinner text={t('portal.invoices.loading')} />
  return (
    <div className="fade-in portal-page" style={{ maxWidth:860 }}>
      <SectionTitle sub={t('portal.invoices.subtitle')}>{t('portal.invoices.title')}</SectionTitle>
      <div className="ar-war">
        <div className="ar-war-head">
          <div>
            <div className="ar-war-kicker">{t('portal.invoices.warTitle')}</div>
            <div className="ar-war-total">{fmtYen(aging.total)}</div>
            <div className="ar-war-hint">{t('portal.invoices.warHint')}</div>
          </div>
          <div className="ar-aging">
            {[
              [t('portal.invoices.aging0'), aging.current],
              [t('portal.invoices.aging30'), aging.d30],
              [t('portal.invoices.aging60'), aging.d60],
              [t('portal.invoices.aging90'), aging.d90],
            ].map(([label, amt]) => (
              <div key={label} className={`ar-aging-cell${amt > 0 && label === t('portal.invoices.aging90') ? ' is-hot' : ''}`}>
                <b>{fmtYen(amt)}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        {aging.overdue.length > 0 && (
          <div className="ar-overdue-list">
            {aging.overdue.slice(0, 6).map(f => (
              <div key={f.id} className="ar-overdue-row">
                <div>
                  <strong>{t('portal.invoices.callNow')}</strong>
                  <span> · {t('portal.invoices.dueOn', { date: fmtDate(faturaVencimento(f)) })} · {f.daysOverdue}d</span>
                </div>
                <b>{fmtYen(f.remain)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      {overdue.length>0 && (
        <div style={{ background:"linear-gradient(135deg,#ff3b30,#c0392b)", borderRadius:16, padding:"16px 20px", marginBottom:16 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"white" }}>{t('portal.invoices.overdueAlert', { count: overdue.length })}</div>
        </div>
      )}
      <div className="portal-grid-4" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
        {[
          { label:t('portal.invoices.pending'), value:fmtYen(totalPending), color:totalPending>0?"var(--red)":"var(--green)", icon:"⏳" },
          { label:t('portal.invoices.totalPaid'), value:fmtYen(filtered.filter(f=>f.status==="pago").reduce((a,f)=>a+faturaValor(f),0)), color:"var(--green)", icon:"✅" },
          { label:t('portal.invoices.overdue'), value:overdue.length, color:overdue.length>0?"var(--red)":"var(--green)", icon:"🚨" },
          { label:t('portal.invoices.avgMonthly'), value:fmtYen(avgMonthly), color:"var(--navy)", icon:"📊" },
        ].map(k=>(
          <div key={k.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14, padding:"14px" }}>
            <div style={{ fontSize:18, marginBottom:4 }}>{k.icon}</div>
            <div style={{ fontSize:18, fontWeight:800, color:k.color, lineHeight:1 }}>{k.value}</div>
            <div style={{ fontSize:10, color:"var(--text2)", textTransform:"uppercase", marginTop:4 }}>{k.label}</div>
          </div>
        ))}
      </div>
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:"20px", marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>{t('portal.invoices.monthlySpend')}</div>
        <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:80 }}>
          {monthlySpend.map((v,i) => (
            <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
              <div style={{ fontSize:9, color:"var(--text2)" }}>{v>0?Math.round(v/1000)+"k":""}</div>
              <div style={{ width:"100%", height:Math.max(v/maxSpend*100,v>0?4:0)+"%", minHeight:v>0?3:0, background:i===5?"var(--navy)":"var(--border)", borderRadius:"4px 4px 0 0" }}/>
              <div style={{ fontSize:10, color:i===5?"var(--navy)":"var(--text3)", fontWeight:i===5?700:400 }}>{monthLabels[i]}</div>
            </div>
          ))}
        </div>
      </div>
      {upcoming.length>0 && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:"20px", marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>{t('portal.invoices.upcomingDue')}</div>
          {upcoming.map(f => {
            const venc = faturaVencimento(f)
            const daysLeft = Math.ceil((new Date(venc)-new Date())/(1000*60*60*24))
            const remaining = faturaRemaining(f)
            const fp = pagamentos.filter(p=>p.fatura_id===f.id&&!p.confirmado)
            return (
              <div key={f.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid var(--border)" }}>
                <div style={{ width:44, height:44, borderRadius:12, background:daysLeft<=5?"#fef2f2":"#f0fdf4", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <div style={{ fontSize:16, fontWeight:800, color:daysLeft<=5?"var(--red)":"var(--green)", lineHeight:1 }}>{daysLeft}</div>
                  <div style={{ fontSize:9, color:"var(--text2)", textTransform:"uppercase" }}>{t('portal.invoices.days')}</div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{t('portal.invoices.dueOn', { date: fmtDate(venc) })}</div>
                  <div style={{ fontSize:11, color:"var(--text2)" }}>{t('portal.invoices.periodRange', { from: fmtDate(faturaEmissao(f)), to: fmtDate(venc) })}</div>
                  {f.obs && <div style={{ fontSize:11, color:"var(--text3)", marginTop:2 }}>{f.obs}</div>}
                  {fp.length>0 && <div style={{ fontSize:11, color:"var(--amber)", fontWeight:600 }}>{t('portal.invoices.paymentAwaiting')}</div>}
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
                  <div style={{ fontSize:16, fontWeight:800, color:"var(--red)" }}>{fmtYen(remaining)}</div>
                  {fp.length===0 && <button onClick={()=>setPayModal(f)} style={{ padding:"5px 12px", fontSize:11, borderRadius:8, border:"none", background:"var(--navy)", color:"white", cursor:"pointer", fontWeight:600 }}>{t('portal.invoices.sendProof')}</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:16 }}>
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{ padding:"7px 10px", borderRadius:8, fontSize:12 }} />
        <span style={{ color:"var(--text2)", fontSize:12 }}>{t('portal.invoices.dateTo')}</span>
        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{ padding:"7px 10px", borderRadius:8, fontSize:12 }} />
        {(dateFrom||dateTo)&&<button onClick={()=>{setDateFrom("");setDateTo("")}} style={{ fontSize:12, padding:"6px 12px", borderRadius:8, border:"1px solid var(--border)", background:"transparent", cursor:"pointer" }}>{t('portal.invoices.clear')}</button>}
      </div>
      <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>{t('portal.invoices.history')}</div>
      {filtered.length===0?<Empty text={t('portal.invoices.noInvoices')} icon="🧾" />:(
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {filtered.map(f => {
            const remaining = faturaRemaining(f)
            const total = faturaValor(f)
            const pago = faturaPago(f)
            const pct = total>0?Math.round(pago/total*100):0
            const venc = faturaVencimento(f)
            const isOverdue = f.status==="pendente"&&venc&&new Date(venc)<new Date()
            const fp = pagamentos.filter(p=>p.fatura_id===f.id)
            const pendingP = fp.filter(p=>!p.confirmado)
            return (
              <div key={f.id} style={{ background:"var(--bg2)", border:"1px solid", borderColor:isOverdue?"rgba(255,59,48,0.3)":"var(--border)", borderRadius:14, padding:"14px 18px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700 }}>{t('portal.invoices.periodRange', { from: fmtDate(faturaEmissao(f)), to: fmtDate(venc) })}</div>
                    <div style={{ fontSize:11, color:"var(--text2)" }}>{t('portal.invoices.dueDate', { date: fmtDate(venc) })}</div>
                    {f.obs && <div style={{ fontSize:11, color:"var(--text3)", marginTop:2 }}>{f.obs}</div>}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:f.status==="pago"?"#f0fdf4":isOverdue?"#fef2f2":"#EAF0FA", color:f.status==="pago"?"var(--green)":isOverdue?"var(--red)":"var(--navy)" }}>
                      {f.status==="pago"?t('portal.invoices.statusPaid'):isOverdue?t('portal.invoices.statusOverdue'):t('portal.invoices.statusPending')}
                    </span>
                    <div style={{ fontSize:16, fontWeight:800, color:"var(--navy)", marginTop:4 }}>{fmtYen(total)}</div>
                  </div>
                </div>
                <div style={{ height:4, background:"var(--bg3)", borderRadius:2, overflow:"hidden", marginBottom:6 }}>
                  <div style={{ height:"100%", width:pct+"%", background:f.status==="pago"?"var(--green)":"var(--gold)", borderRadius:2 }}/>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--text2)", marginBottom:8 }}>
                  <span>{t('portal.invoices.paidPct', { amount: fmtYen(pago), pct })}</span>
                  {remaining>0&&<span style={{ color:"var(--red)", fontWeight:600 }}>{t('portal.invoices.remaining', { amount: fmtYen(remaining) })}</span>}
                </div>
                {pendingP.length>0&&(
                  <div style={{ background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:8, padding:"8px 12px", marginBottom:8, fontSize:12 }}>
                    {t('portal.invoices.paymentsAwaiting', { count: pendingP.length, amount: fmtYen(pendingP.reduce((a,p)=>a+p.valor,0)) })}
                  </div>
                )}
                <div style={{ display:"flex", gap:8 }}>
                  {f.status!=="pago"&&pendingP.length===0&&<button onClick={()=>setPayModal(f)} style={{ padding:"6px 14px", fontSize:12, borderRadius:8, border:"none", background:"var(--navy)", color:"white", cursor:"pointer", fontWeight:600 }}>{t('portal.invoices.sendProofBtn')}</button>}
                  {fp.length>0&&<button onClick={()=>setSelected(selected===f.id?null:f.id)} style={{ padding:"6px 14px", fontSize:12, borderRadius:8, border:"1px solid var(--border)", background:"transparent", cursor:"pointer" }}>
                    {selected===f.id?t('portal.invoices.hide'):t('portal.invoices.show')} {fp.length} {t('portal.invoices.payments')}
                  </button>}
                </div>
                {selected===f.id&&fp.length>0&&(
                  <div style={{ marginTop:10, borderTop:"1px solid var(--border)", paddingTop:10 }}>
                    {fp.map(p=>(
                      <div key={p.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:"1px solid var(--border)", fontSize:12 }}>
                        <div>
                          <span style={{ fontWeight:600 }}>{fmtDate(p.data)}</span>
                          <span style={{ color:"var(--text2)", marginLeft:8 }}>{p.metodo}</span>
                          {!p.confirmado&&<span style={{ marginLeft:8, color:"var(--amber)", fontWeight:600 }}>{t('portal.invoices.statusPending')}</span>}
                          {p.confirmado&&<span style={{ marginLeft:8, color:"var(--green)", fontWeight:600 }}>{t('portal.invoices.confirmed')}</span>}
                        </div>
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          {p.comprovante_url&&<a href={p.comprovante_url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"var(--navy)" }}>{t('portal.invoices.proofLink')}</a>}
                          {p.confirmado && (
                            <button
                              type="button"
                              onClick={() => emitPaymentReceipt({ key:`p-${p.id}`, valor:+p.valor, data:p.data, metodo:p.metodo, notas:p.notas, fatura:f })}
                              disabled={emittingReceipt === `p-${p.id}`}
                              style={{ fontSize:11, padding:"4px 10px", borderRadius:8, border:"none", background:"var(--gold)", color:"var(--navy)", cursor:"pointer", fontWeight:700 }}
                            >
                              {emittingReceipt === `p-${p.id}` ? '...' : t('portal.invoices.receipt')}
                            </button>
                          )}
                          <span style={{ fontWeight:700, color:"var(--green)" }}>{fmtYen(p.valor)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {payModal&&(
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
          onClick={()=>{setPayModal(null);setImage(null);setScannedData(null)}}>
          <div style={{ background:"var(--bg2)", borderRadius:20, padding:"28px", width:"100%", maxWidth:420, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 24px 60px rgba(0,0,0,0.3)" }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:4 }}>{t('portal.invoices.sendProofTitle')}</div>
            <div style={{ fontSize:12, color:"var(--text2)", marginBottom:20 }}>
              {t('portal.invoices.periodRange', { from: fmtDate(payModal.periodo_inicio), to: fmtDate(payModal.periodo_fim) })} · {t('portal.invoices.remainingLabel')}: <strong style={{ color:"var(--red)" }}>{fmtYen(faturaRemaining(payModal))}</strong>
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"var(--text2)", textTransform:"uppercase", marginBottom:8 }}>{t('portal.invoices.proofUpload')}</div>
              <div style={{ border:"2px dashed var(--border)", borderRadius:12, padding:"20px", textAlign:"center", cursor:"pointer", background:"var(--bg3)" }}
                onClick={()=>document.getElementById("receipt-upload").click()}>
                {image?(
                  <div>
                    {image.startsWith('data:application/pdf') ? (
                      <div style={{ fontSize:48, marginBottom:8 }}>📄</div>
                    ) : (
                      <img src={image} alt="comprovante" style={{ maxHeight:150, maxWidth:"100%", borderRadius:8, marginBottom:8 }} />
                    )}
                    <div style={{ fontSize:12, color:"var(--text2)", marginTop:4 }}>{t('portal.invoices.fileUploaded')}</div>
                  </div>
                ):(
                  <div>
                    <div style={{ fontSize:24, marginBottom:4 }}>📷</div>
                    <div style={{ fontSize:13, fontWeight:600 }}>{t('portal.invoices.uploadPhotoPdf')}</div>
                    <div style={{ fontSize:11, color:"var(--text2)" }}>{t('portal.invoices.aiExtractHint')}</div>
                  </div>
                )}
                <input id="receipt-upload" type="file" accept="image/*,.pdf,application/pdf" style={{ display:"none" }}
                  onChange={e=>{
                    const file = e.target.files[0]; if (!file) return
                    const reader = new FileReader()
                    reader.onload = ev => {
                      const dataUrl = ev.target.result
                      setImage(dataUrl)
                      if (!file.type?.includes('pdf')) scanReceipt(dataUrl)
                    }
                    reader.readAsDataURL(file)
                  }}
                />
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"var(--text2)", textTransform:"uppercase", marginBottom:8 }}>{t('portal.invoices.amountYen')}</div>
              {scanning && <div style={{ fontSize:12, color:"var(--text2)", marginBottom:8 }}>{t('portal.invoices.extracting')}</div>}
              {scannedData?.valor && !scanning && (
                <div style={{ fontSize:12, color:"var(--green)", marginBottom:8, fontWeight:600 }}>
                  {t('portal.invoices.detected', { amount: fmtYen(scannedData.valor) })}{scannedData.metodo ? ` · ${scannedData.metodo}` : ''}
                </div>
              )}
              <input type="number" value={payForm.valor} onChange={e=>setPayForm({...payForm,valor:e.target.value})} style={{ width:"100%", padding:"12px 14px", fontSize:18, borderRadius:12, fontWeight:700 }} />
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"var(--text2)", textTransform:"uppercase", marginBottom:8 }}>{t('portal.invoices.paymentMethod')}</div>
              <select value={payForm.metodo} onChange={e=>setPayForm({...payForm,metodo:e.target.value})} style={{ width:"100%" }}>
                {PAY_METHODS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"var(--text2)", textTransform:"uppercase", marginBottom:8 }}>{t('common.notes')}</div>
              <input value={payForm.notas} onChange={e=>setPayForm({...payForm,notas:e.target.value})} placeholder={t('portal.invoices.transferRef')} style={{ width:"100%" }} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:8 }}>
              <button onClick={()=>{setPayModal(null);setImage(null);setScannedData(null)}} style={{ padding:"13px", borderRadius:14, border:"1px solid var(--border)", background:"transparent", cursor:"pointer" }}>{t('common.cancel')}</button>
              <button onClick={submitPayment} disabled={saving||!payForm.valor||scanning} style={{ padding:"13px", borderRadius:14, border:"none", background:"var(--navy)", color:"white", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                {saving ? t('portal.invoices.submitting') : t('portal.invoices.submitProof')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



// ── PREÇOS + CARDÁPIO (aba unificada) ─────────────────────────────────────────
function PrecosCardapioTab({ bar }) {
  const { t } = useI18n()
  const [sub, setSub] = useState('precos')
  return (
    <div className="fade-in portal-page">
      <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
        {[
          { id:'precos', label:t('portal.home.posPricesTab'), icon:'💰' },
          { id:'cardapio', label:t('portal.home.menuTab'), icon:'🍹' },
        ].map(item => (
          <button key={item.id} onClick={()=>setSub(item.id)} style={{
            padding:'10px 18px', borderRadius:12, fontSize:13, fontWeight:700, cursor:'pointer',
            border: sub===item.id ? '2px solid var(--navy)' : '1px solid var(--border)',
            background: sub===item.id ? 'var(--navy)' : 'var(--bg2)',
            color: sub===item.id ? 'white' : 'var(--text)',
          }}>{item.icon} {item.label}</button>
        ))}
      </div>
      {sub === 'precos' ? <PricingTab bar={bar} /> : <MenuTab bar={bar} />}
    </div>
  )
}

// ── MAIN PORTAL ───────────────────────────────────────────────────────────────
export default function PortalCliente({ bar, signOut, notifs=[], unread=0, markRead, markAllRead, deleteNotif, deleteAll }) {
  const { perfil } = useAuth()
  const NAV_GROUPS = groupedNavForRole(perfil?.role)
  const DOCK = primaryDockForRole(perfil?.role)
  const [tab, setTab] = useState(() => defaultBarTab(perfil?.role))
  const [menuOpen, setMenuOpen] = useState(false)
  const [door, setDoor] = useState(() => loginDoorFromHash())
  const { t } = useI18n()
  const overdueAlerts = useBarOverdueAlerts(bar?.id)

  useMobileMenuLock(menuOpen)

  useEffect(() => {
    const sync = () => setDoor(loginDoorFromHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  function selectTab(id) {
    setTab(id === 'equipe' || id === 'casa' ? 'staff' : id === 'outro' ? 'fixo' : id)
    setMenuOpen(false)
  }

  const posAccess = posAccessForRole(perfil?.role)
  const tillKiosk = isTillKiosk(perfil?.role, door)
  const clockKiosk = isClockKiosk(perfil?.role)
  const footerKey = perfil?.role === 'caixa' ? 'portal.footerCaixa' : perfil?.role === 'bar_staff' ? 'portal.footerStaff' : 'portal.footerHint'
  const dockOn = DOCK.some(d => d.id === tab)
  const kioskAccess = tillKiosk ? 'cashier' : posAccess

  if (!doorAllowsRole(door, perfil?.role) && (door === 'pos' || door === 'clock')) {
    return (
      <div className="till-kiosk-wrong">
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{t(door === 'pos' ? 'auth.doorPosTitle' : 'auth.doorStaffTitle')}</div>
          <p>{t('auth.wrongDoor')}</p>
          <button className="btn-gold" onClick={signOut}>{t('common.signOut')}</button>
        </div>
      </div>
    )
  }

  if (tillKiosk || clockKiosk) {
    return (
      <div className={`app-shell is-till-kiosk${tillKiosk ? ' is-pos' : ' is-clock'}`}>
        <header className="till-kiosk-bar">
          <div>
            <div className="till-kiosk-name">{bar.nome}</div>
            <div className="till-kiosk-lane">{tillKiosk ? t('auth.lanePos') : t('auth.laneStaff')}</div>
          </div>
          <div className="till-kiosk-actions">
            {tillKiosk && isGerente(perfil?.role) && (
              <button type="button" onClick={() => { setDoorHash('gerente'); setDoor('gerente') }}>{t('auth.openHq')}</button>
            )}
            <button type="button" onClick={signOut}>{t('atomicPos.lockTill')}</button>
          </div>
        </header>
        <main className="app-main app-main-wide till-kiosk-main">
          {tillKiosk && posAccess !== 'none' && (
            <AtomicPosPanel bar={bar} access={kioskAccess} />
          )}
          {clockKiosk && <TimeClockPanel bar={bar} />}
        </main>
      </div>
    )
  }

  return (
    <div className={`app-shell${DOCK.length ? ' has-easy-dock' : ''}`}>
      <ShellOverlay open={menuOpen} onClose={() => setMenuOpen(false)} />
      <MobileTopBar
        open={menuOpen}
        onToggle={() => setMenuOpen(o => !o)}
        title={<div className="logo-mobile-header"><span style={{ fontSize: 14, fontWeight: 800, color: 'white' }}>{bar.nome}</span></div>}
      >
        <NotificationBell notifs={notifs} unread={unread} markRead={markRead} markAllRead={markAllRead} deleteNotif={deleteNotif} deleteAll={deleteAll} onNavigate={selectTab} overdueAlerts={overdueAlerts} placement="header"/>
      </MobileTopBar>

      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <LogoSidebar />
        </div>
        <nav className="sidebar-nav">
          {NAV_GROUPS.map(g => (
            <div key={g.id} className="nav-group">
              {g.labelKey && <div className="nav-group-label">{t(g.labelKey)}</div>}
              {g.items.map(n => (
                <button key={n.id} onClick={() => selectTab(n.id)} className={`nav-item ${tab===n.id?'active':''}`}>
                  <span>{n.icon}</span>
                  <span>{t(n.labelKey)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.06em'}}>{t('shell.clientPortal')}</div>
          <div style={{fontSize:13,fontWeight:700,color:'var(--gold)',marginBottom:12}}>{bar.nome}</div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginBottom:10,lineHeight:1.5}}>
            {t(footerKey)}
          </div>
          <button onClick={signOut} className="sidebar-signout">{t('common.signOut')}</button>
        </div>
      </aside>
      <main className="app-main app-main-wide">
        <WorkspaceChrome>
          <UiPrefsPanel compact />
          {isGerente(perfil?.role) && (
            <button type="button" className="chrome-till" onClick={() => { setDoorHash('pos'); setDoor('pos') }}>
              {t('auth.openTillTablet')}
            </button>
          )}
          <NotificationBell notifs={notifs} unread={unread} markRead={markRead} markAllRead={markAllRead} deleteNotif={deleteNotif} deleteAll={deleteAll} onNavigate={selectTab} overdueAlerts={overdueAlerts} placement="header"/>
        </WorkspaceChrome>
        {tab==='custos'    && isGerente(perfil?.role) && <BarCostsTab bar={bar} onTab={selectTab} />}
        {tab==='metas' && canManageBarTeam(perfil?.role) && <BarGoalsTab bar={bar} />}
        {tab==='eventos' && canManageBarTeam(perfil?.role) && <BarEventsTab bar={bar} />}
        {['fechamento', 'pagamentos', 'salarios'].includes(tab) && canManageBarTeam(perfil?.role) && (
          <BarFinance key={tab} bar={bar} section={tab} onTab={selectTab} />
        )}
        {tab==='inicio' && posAccess !== 'cashier' && (
          <HomeTab bar={bar} onTab={selectTab} />
        )}
        {tab==='pos'       && posAccess !== 'none' && <AtomicPosPanel bar={bar} onOrder={posAccess === 'owner' ? () => selectTab('pedidos') : undefined} access={posAccess} />}
        {tab==='ponto'     && <TimeClockPanel bar={bar} onOpenStaff={() => selectTab('staff')} />}
        {['staff', 'fornecedor', 'parceiro', 'cartao', 'energia', 'aluguel', 'fixo', 'variavel'].includes(tab) && canManageBarTeam(perfil?.role) && (
          <BarHouseTab key={tab} bar={bar} section={tab} onTab={selectTab} />
        )}
        {tab==='equipe'    && canManageBarTeam(perfil?.role) && <BarTeamTab bar={bar} />}
        {tab==='clientes'  && canManageBarTeam(perfil?.role) && <BarGuestsTab bar={bar} />}
        {tab==='espacos'   && canManageBarTeam(perfil?.role) && <BarSpacesTab bar={bar} />}
        {tab==='pedidos'   && canPlaceDrinkOrders(perfil?.role) && <BarOrdersTab bar={bar} />}
        {tab==='entregas'  && canManageBarTeam(perfil?.role) && <DeliveriesTab bar={bar} />}
        {tab==='estoque'   && canManageBarTeam(perfil?.role) && <InventoryTab bar={bar} onOrder={()=>selectTab('pedidos')} />}
        {tab==='precos'    && canManageBarTeam(perfil?.role) && <PrecosCardapioTab bar={bar} />}
        {tab==='faturas'   && canManageBarTeam(perfil?.role) && <FaturasTab bar={bar} />}
        {tab==='recibos'  && canManageBarTeam(perfil?.role) && <PortalRecibosTab bar={bar} />}
        {tab==='ia'       && canManageBarTeam(perfil?.role) && <PortalClienteAI bar={bar} />}
      </main>
      {DOCK.length > 0 && (
        <nav className="easy-dock" aria-label={t('nav.portalHome')}>
          {DOCK.map(d => (
            <button key={d.id} type="button" className={tab===d.id ? 'is-on' : ''} onClick={() => selectTab(d.id)}>
              <span className="easy-dock-icon">{d.icon}</span>
              <span>{t(d.labelKey)}</span>
            </button>
          ))}
          <button type="button" className={!dockOn || menuOpen ? 'is-on' : ''} onClick={() => setMenuOpen(o => !o)}>
            <span className="easy-dock-icon">☰</span>
            <span>{t('nav.more')}</span>
          </button>
        </nav>
      )}
    </div>
  )
}
