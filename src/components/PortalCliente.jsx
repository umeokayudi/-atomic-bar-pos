import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Icon, { hasIcon } from './ui/Icon'
import PhotoField from './ui/PhotoField'
import { SidebarCollapseButton, useSidebarCollapse } from '../lib/sidebarCollapse'
import { BAR_ADMIN_TABS, aiModuleForTab, pathForTab, tabFromPath } from '../lib/navigation'
import { useAiPanel } from '../lib/aiPanel'
import AskAiDrawer, { AskAiButton } from './ai/AskAiDrawer'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { callGeminiChat, imageDataUrlToParts, parseJsonFromAI } from '../lib/ai'
import { LogoSidebar } from './Logo'
import { MobileTopBar, ShellOverlay, WorkspaceChrome, TopbarUser, useMobileMenuLock } from './MobileShell'
import GlobalSearch from './GlobalSearch'
import { fmtYen, fmtDate, Spinner, Empty, SectionTitle, isSupplierProduct, filterSupplierVendas, roleLabel } from './utils'
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
import BarDesk from './BarDesk'
import DashboardGrid from './ui/DashboardGrid'
import { ColumnChart, RankList, deltaPct } from './ui/Charts'
import { PageHeader, PortalHero, PortalKpi, PortalPills, PortalSurface, WelcomeHeader } from './ui/PageLayout'
import { useDashboardLayout } from '../lib/dashboardLayout'
import { aggregateHourlySales, computeDayMetrics } from '../lib/atomicPos'
import { nightKeyOfSale } from '../lib/nightClose'
import { sameWeekdaySales } from '../lib/barClose'
import AutoReorder from './AutoReorder'
import BillMatch from './BillMatch'
import RangeCalendar from './RangeCalendar'
import AutoClose from './AutoClose'
const ClientAnalyticsTab = lazy(() => import('./ClientAnalyticsTab'))
const PortalRecibosTab = lazy(() => import('./PortalRecibosTab'))
const AiCenter = lazy(() => import('./ai/AiCenter'))
const FloorScreen = lazy(() => import('./floor/FloorScreen'))
const MarketingHub = lazy(() => import('./growth/MarketingHub'))
const ConsultingHub = lazy(() => import('./growth/ConsultingHub'))
const AtomicPosPanel = lazy(() => import('./AtomicPos'))
const TimeClockPanel = lazy(() => import('./TimeClock'))
const BarTeamTab = lazy(() => import('./BarTeamTab'))
const BarHouseTab = lazy(() => import('./BarHouse'))
const DrinkBackTab = lazy(() => import('./DrinkBackTab'))
const BarGoalsTab = lazy(() => import('./BarGoals'))
const BarEventsTab = lazy(() => import('./BarEvents'))
const BarFinance = lazy(() => import('./BarFinance'))
const BarGuestsTab = lazy(() => import('./BarGuestsTab'))
const BarSpacesTab = lazy(() => import('./BarSpacesTab'))
const BarVipTab = lazy(() => import('./BarVipTab'))
const StaffOrdersTab = lazy(() => import('./StaffOrdersTab'))
const StaffAlerts = lazy(() => import('./StaffAlerts'))
const EmployeeDesk = lazy(() => import('./EmployeeDesk'))
import { fetchAllStockMovements } from '../lib/posSupply'
import { coalesceStockMoves, decorateStockList, deliveryNoteMoves, posPourMoves, stockFlow, stockGlance } from '../lib/barStock'
import { groupedNavForRole, primaryDockForRole, defaultBarTab, posAccessForRole, canManageBarTeam, isGerente, costAccessForRole, canPlaceDrinkOrders } from '../lib/access'
import { isTillKiosk, isClockKiosk, loginDoorFromHash, setDoorHash, doorAllowsRole } from '../lib/barDoors'
import UiPrefsPanel from './UiPrefsPanel'
import { useI18n } from '../lib/i18n'
import { tokyoMonthKey, tokyoNightKey } from '../lib/tokyo'
import { buildBarCalendarEvents, dateInRange, invoiceInRange } from '../lib/barCalendar'
import { birthdayThisMonth, decorateSpaces } from '../lib/barCrm'
import BarCostsTab, { CostBooksHero, loadCostBooks, BarCommandActions } from './BarCostsTab'
import BarOpsGlance from './BarOpsGlance'
import { buildBarOpsGlance } from '../lib/barOpsGlance'
import { fetchHqSnapshot, peekHqSnapshot } from '../lib/hqSnapshot'
import { booksAreSeparate } from '../lib/costBooks'
import { asReactText } from '../lib/errText'
import { NotificationBell, useBarOverdueAlerts } from './Notifications'
const BarOrdersTab = lazy(() => import('./BarOrdersTab'))
const DashboardCalendar = lazy(() => import('./DashboardCalendar'))

function TabHold({ children }) {
  return <Suspense fallback={<div style={{ padding: 28, color: 'var(--text2)' }}>…</div>}>{children}</Suspense>
}
import {
  buildPaymentRyoshushoHtml,
  buildRyoshushoNumero,
  printRyoshushoHtml,
  savePaymentRyoshusho,
} from '../lib/ryoshushoPrint'

// ── HOME ──────────────────────────────────────────────────────────────────────
/** Bar home cards: id, default width, hidden by default. Titles and content live in HomeTab. */
const HOME_WIDGET_META = [
  ['actions', 'full'], ['tonight', 'full'], ['hourly', 'half'], ['spend', 'half'], ['desk', 'full'], ['ops', 'full'],
  ['books', 'full'], ['calendar', 'full'], ['period', 'full', true], ['topCost', 'half', true], ['topVolume', 'half', true],
  ['margins', 'half', true], ['economics', 'full', true], ['recent', 'half', true], ['analytics', 'full', true],
].map(([id, size, defaultHidden]) => ({ id, size, defaultHidden: !!defaultHidden }))
const ITEM_WIDGETS = new Set(['topCost', 'topVolume', 'margins', 'economics'])

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
  const [posTickets,  setPosTickets]  = useState(() => {
    const snap = peekHqSnapshot()
    return snap?.pos?.history?.length ? snap.pos.history : (snap?.pos?.tickets || [])
  })
  const [costBooks,   setCostBooks]   = useState(() => {
    const snap = peekHqSnapshot()
    return snap?.books && booksAreSeparate(snap.books) ? snap.books : null
  })
  const [hq,          setHq]          = useState(() => peekHqSnapshot())
  const [floorGlance, setFloorGlance] = useState(null)
  const [loading] = useState(false)
  const [periodo,     setPeriodo]     = useState('30')
  const layout = useDashboardLayout('bar-home', HOME_WIDGET_META)
  // Product-level cards need the delivery lines (up to 600 rows): load them only when one is on screen.
  const showMore = layout.items.some(i => !i.hidden && ITEM_WIDGETS.has(i.id))
  const [calMonth,    setCalMonth]    = useState(() => tokyoMonthKey())

  function sinceKey() {
    const [y, mo] = tokyoMonthKey().split('-').map(Number)
    const d = new Date(y, mo - 1 - 8, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }

  function applySnap(snap) {
    if (!snap) return
    setHq(snap)
    setCostBooks(booksAreSeparate(snap.books) ? snap.books : null)
    if (snap.pos) {
      setPosTickets(snap.pos.history?.length ? snap.pos.history : (snap.pos.tickets || []))
      setPosMonthTotal(snap.pos.till != null ? snap.pos.till : null)
    }
  }

  async function load() {
    const since = sinceKey()
    const snapP = fetchHqSnapshot().then(applySnap).catch(async () => {
      try {
        const books = await loadCostBooks(bar.id)
        setCostBooks(booksAreSeparate(books) ? books : null)
      } catch {
        setCostBooks(null)
      }
    })
    const floorP = Promise.all([
      supabase.from('bar_spaces').select('id,ativo,ordem,tipo,zona').eq('bar_id', bar.id).eq('ativo', true),
      supabase.from('bar_visits').select('id,space_id,status,guest_id').eq('bar_id', bar.id).in('status', ['seated', 'reserved']),
      supabase.from('bar_guests').select('id,nome,aniversario,ativo').eq('bar_id', bar.id).eq('ativo', true),
    ]).then(([spR, viR, guR]) => {
      if (spR.error) return
      const floor = decorateSpaces(spR.data || [], viR.data || [])
      setFloorGlance({
        seated: floor.filter(s => s.occupied).length,
        reserved: floor.filter(s => s.reserved).length,
        free: floor.filter(s => !s.occupied && !s.reserved).length,
        birthdays: birthdayThisMonth(guR.data || []).length,
      })
    }).catch(() => {})
    await Promise.all([snapP, floorP])
    Promise.all([
      supabase.from('vendas').select('id,bar_id,data,total,obs').eq('bar_id', bar.id).gte('data', since).order('data', { ascending: false }).limit(240),
      supabase.from('pedidos').select('id,status,total_estimado,criado_em').eq('bar_id', bar.id).order('criado_em', { ascending: false }).limit(40),
      supabase.from('faturas').select('id,status,valor,total,pago,data_vencimento,periodo_fim,periodo_inicio,obs,notes,descricao,client_name,tipo').eq('bar_id', bar.id).order('data_vencimento', { ascending: false }).limit(24),
    ]).then(([vR, pR, fR]) => {
      setVendas(filterSupplierVendas(vR.data || []))
      setPedidos(pR.data || [])
      setFaturas(filterJbmDrinksFaturas(fR.data || []))
    }).catch(() => {})
  }

  useEffect(() => {
    if (!showMore || !bar?.id) return
    let cancelled = false
    const since = sinceKey()
    Promise.all([
      supabase.from('bar_pricing').select('produto_id,drinks_por_garrafa,preco_drink').eq('bar_id', bar.id),
      supabase
        .from('vendas_itens')
        .select('qtd,preco_unitario,produtos(nome,categoria,preco_venda,volume_ml), vendas(data,bar_id,obs)')
        .eq('vendas.bar_id', bar.id)
        .gte('vendas.data', since)
        .limit(600),
    ]).then(([bpR, iR]) => {
      if (cancelled) return
      setBarPricing(bpR.data || [])
      setItens((iR.data || []).filter(i => i.vendas && filterSupplierVendas([i.vendas]).length))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [showMore, bar?.id])

  useEffect(() => { load() }, [bar?.id])

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

  const { labels: monthLabels, values: monthlyData } = monthlySpendSeries(vendas, 6)

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
  const economics = Object.values(byName)
    .map(p => ({
      ...p,
      marginPct: p.posTotal > 0 ? Math.round(p.margin / p.posTotal * 100) : 0,
      costPerUnit: p.qtd > 0 ? Math.round(p.jbmTotal / p.qtd) : 0,
      posPerUnit: p.qtd > 0 ? Math.round(p.posTotal / p.qtd) : 0,
    }))
    .filter(p => p.posTotal > 0)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 12)

  if (loading) return <Spinner text={t('portal.home.loading')} />

  const deliveriesLabel = account.deliveries === 1
    ? t('portal.home.deliveriesThisMonth', { count: account.deliveries })
    : t('portal.home.deliveriesThisMonthPlural', { count: account.deliveries })

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

  const tonightKey = tokyoNightKey()
  const tonightRows = (posTickets || []).filter(x => nightKeyOfSale(x) === tonightKey)
  const lastNightKey = tonightRows.length ? tonightKey : [...new Set((posTickets || []).map(nightKeyOfSale).filter(Boolean))].sort().pop()
  const shownNight = (posTickets || []).filter(x => nightKeyOfSale(x) === lastNightKey)
  const night = computeDayMetrics(tonightRows)
  const weekAgo = sameWeekdaySales(posTickets, tonightKey)
  const hourlyCols = nightHours(aggregateHourlySales(shownNight))
  const periodChips = (
    <PortalPills
      options={[['7', '7d'], ['30', '30d'], ['90', '90d'], ['365', '1y']]}
      value={periodo}
      onChange={setPeriodo}
    />
  )

  const widgets = [
    {
      id: 'actions', title: t('portal.home.doTonight'), icon: 'next', size: 'full',
      render: () => (
        <section className="home-band">
          <div className="hq-actions-label">{t('portal.home.doTonight')}</div>
          <BarCommandActions onTab={onTab} ids={['pos', 'pedidos', 'espacos', 'clientes', 'ponto', 'fechamento']} />
        </section>
      ),
    },
    {
      id: 'tonight', title: t('dash.w.tonight'), icon: 'pos', size: 'full',
      render: () => (
        <div className="portal-hero-grid is-four">
          <PortalKpi icon="sales" label={t('dash.salesTonight')} value={fmtYen(night.total)}
            delta={deltaPct(weekAgo.now, weekAgo.before)} deltaLabel={t('dash.vsLastWeekDay')} onClick={() => onTab('pos')} />
          <PortalKpi icon="pos" tone="info" label={t('dash.tickets')} value={night.count} sub={t('dash.ticketsSub')} />
          <PortalKpi icon="coins" tone="success" label={t('dash.avgTicket')} value={fmtYen(night.ticketMedio)} />
          <PortalKpi icon="clock" tone="warning" label={t('dash.peakHour')} value={night.peakHour?.total > 0 ? night.peakHour.label : '—'}
            sub={night.peakHour?.total > 0 ? fmtYen(night.peakHour.total) : t('dash.noSalesYet')} />
        </div>
      ),
    },
    {
      id: 'hourly', title: t('dash.w.hourly'), icon: 'result', size: 'half',
      render: () => (
        <PortalSurface title={t('dash.w.hourly')} sub={lastNightKey && lastNightKey !== tonightKey ? t('dash.lastNight', { date: fmtDate(lastNightKey) }) : t('dash.tonight')}>
          <ColumnChart data={hourlyCols} format={fmtYen} empty={t('dash.noSalesYet')} ariaLabel={t('dash.w.hourly')} />
        </PortalSurface>
      ),
    },
    {
      id: 'spend', title: t('portal.home.monthlySpend'), icon: 'purchases', size: 'half',
      render: () => (
        <PortalSurface title={t('portal.home.monthlySpend')} sub={t('dash.spendSub')}>
          <ColumnChart
            data={monthlyData.map((v, i) => ({ label: monthLabels[i], value: v }))}
            format={fmtYen} highlight="last" empty={t('portal.home.noDeliveriesYet')}
          />
        </PortalSurface>
      ),
    },
    {
      id: 'desk', title: t('dash.w.desk'), icon: 'goals', size: 'full',
      render: () => (
        <BarDesk bar={bar} hq={hq} tickets={posTickets} invoices={faturas} openOrders={ativos.length} floor={floorGlance} onTab={onTab} />
      ),
    },
    {
      id: 'ops', title: t('dash.w.ops'), icon: 'floor', size: 'full',
      render: () => (
        <section className="home-band">
          <BarOpsGlance
            glance={buildBarOpsGlance({ hq, floor: floorGlance, openOrders: ativos.length, posTickets, posMonthFallback: posMonthTotal, account, invoices: faturas })}
            onTab={onTab}
          />
        </section>
      ),
    },
    {
      id: 'books', title: t('dash.w.books'), icon: 'custos', size: 'full',
      render: () => (
        <section className="home-band home-band-books">
          {costBooks ? (
            <CostBooksHero books={costBooks} access={access} onSelect={() => onTab('custos')} />
          ) : (
            <div className="portal-hero-grid is-three">
              <PortalHero
                label={t('portal.home.payJbm')}
                value={fmtYen(account.contaMes)}
                sub={<>{t('portal.home.payJbmHint')} · {deliveriesLabel}</>}
              />
              <PortalKpi
                icon="pos" label={t('portal.home.barSold')}
                value={fmtYen(posMonthTotal != null ? posMonthTotal : monthProjection.posTotal)}
                sub={posMonthTotal != null ? t('portal.home.barSoldHint') : t('portal.home.sellAtBarPrice', { pct: monthProjection.posCoveragePct })}
                hint={monthProjection.estimatedSharePct > 0 && posMonthTotal == null ? t('portal.home.estimated', { pct: monthProjection.estimatedSharePct }) : null}
              />
              <PortalKpi
                icon="piggy" tone="success" label={t('portal.home.youKeep')}
                value={fmtYen(monthProjection.margin)} color="var(--green)"
                sub={t('portal.home.marginOnPos', { pct: monthProjection.marginPct })}
              />
            </div>
          )}
          {attentionItems.length > 0 ? (
            <div className="easy-dash-alert">
              <div className="easy-dash-alert-title"><Icon name="warning" size={15} /> {t('portal.home.needsAttention')}</div>
              {attentionItems.map(item => (
                <button key={item.tab} type="button" onClick={() => onTab(item.tab)} className="easy-dash-alert-item">
                  {item.text}
                </button>
              ))}
            </div>
          ) : (
            <div className="easy-dash-ok"><Icon name="ok" size={15} /> {t('portal.home.allClear')}</div>
          )}
        </section>
      ),
    },
    {
      id: 'calendar', title: t('dash.w.calendar'), icon: 'shifts', size: 'full',
      render: () => (
        <Suspense fallback={null}>
          <DashboardCalendar
            events={buildBarCalendarEvents({ invoices: faturas, orders: pedidos, notes: vendas, tickets: posTickets })}
            onNav={onTab}
            month={calMonth}
            onMonthChange={setCalMonth}
            sub={t('portal.home.calSub')}
          />
        </Suspense>
      ),
    },
    {
      id: 'period', title: t('dash.w.period'), icon: 'report', size: 'full', defaultHidden: true,
      render: () => (
        <PortalSurface title={t('dash.w.period')} headerRight={periodChips}>
          <div className="portal-hero-grid is-four">
            <PortalKpi icon="purchases" label={t('portal.home.totalSpend')} value={fmtYen(totalPeriod)} delta={growth} deltaLabel={t('dash.vsPrevPeriod')} deltaGood="down" />
            <PortalKpi icon="entregas" tone="info" label={t('common.deliveries')} value={vendasPeriod.length} sub={t('portal.home.inDays', { days: periodo })} />
            <PortalKpi icon="coins" tone="success" label={t('portal.home.avgPerDelivery')} value={fmtYen(avgOrder)} sub={t('portal.home.perDelivery')} />
            <PortalKpi icon="orders" tone={ativos.length ? 'warning' : 'success'} label={t('portal.home.activeOrders')} value={ativos.length}
              sub={ativos.length > 0 ? ativos.map(p => t(`orderStatus.${p.status}`)).join(', ') : t('portal.home.allOk')} onClick={() => onTab('pedidos')} />
          </div>
        </PortalSurface>
      ),
    },
    {
      id: 'topCost', title: t('portal.home.topByCost'), icon: 'products', size: 'half', defaultHidden: true,
      render: () => (
        <PortalSurface title={t('portal.home.topByCost')} sub={t('portal.home.whatYouSpent', { days: periodo })} headerRight={periodChips}>
          <RankList items={topRevenue.map(([label, value]) => ({ label, value }))} format={fmtYen} empty={t('common.noData')} />
        </PortalSurface>
      ),
    },
    {
      id: 'topVolume', title: t('portal.home.topByVolume'), icon: 'package', size: 'half', defaultHidden: true,
      render: () => (
        <PortalSurface title={t('portal.home.topByVolume')} sub={t('portal.home.lastDays', { days: periodo })} headerRight={periodChips}>
          <RankList items={topVolume.map(([label, value]) => ({ label, value }))} format={v => `${v} ${t('portal.home.units')}`} empty={t('common.noData')} />
        </PortalSurface>
      ),
    },
    {
      id: 'margins', title: t('portal.home.topMarginTitle'), icon: 'percent', size: 'half', defaultHidden: true,
      render: () => (
        <PortalSurface
          title={t('portal.home.topMarginTitle')}
          sub={t('portal.home.topMarginSub', { days: periodo })}
          headerRight={<button type="button" className="ui-btn is-sm" onClick={() => onTab('precos')}>{t('portal.home.editPrices')}</button>}
        >
          <RankList
            items={topMargin.map(p => ({ label: p.nome, value: p.margin, sub: `${p.marginPct}% · ROI ${p.roiPct}${p.source === 'estimate' ? ' · ~' : ''}` }))}
            format={fmtYen} max={6} empty={t('common.noData')}
          />
        </PortalSurface>
      ),
    },
    {
      id: 'economics', title: t('portal.home.detailTitle'), icon: 'scale', size: 'full', defaultHidden: true,
      render: () => (
        <PortalSurface title={t('portal.home.detailTitle')} sub={t('portal.home.detailSub', { days: periodo })} headerRight={periodChips}>
          {economics.length === 0 ? <Empty text={t('common.noData')} /> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="ui-table is-stack">
                <thead><tr>{tableHeaders.map((h, i) => <th key={h || `e${i}`} className={i ? 'num' : ''}>{h}</th>)}</tr></thead>
                <tbody>
                  {economics.map(r => (
                    <tr key={r.nome}>
                      <td data-label={tableHeaders[0]}><strong>{r.source === 'estimate' ? '~ ' : ''}{r.nome}</strong></td>
                      <td className="num" data-label={tableHeaders[1]}>{r.qtd}</td>
                      <td className="num" data-label={tableHeaders[2]}>{fmtYen(r.jbmTotal)}</td>
                      <td className="num" data-label={tableHeaders[3]}>{fmtYen(r.posPerUnit)}</td>
                      <td className="num" data-label={tableHeaders[4]} style={{ color: 'var(--green)', fontWeight: 700 }}>{fmtYen(r.margin)}</td>
                      <td className="num" data-label={tableHeaders[5]}>
                        <span className={`ui-badge ${r.marginPct > 60 ? 'is-success' : r.marginPct > 40 ? 'is-warning' : 'is-danger'}`}>{r.marginPct}%</span>
                      </td>
                      <td className="num" data-label={t('portal.home.posProjection')}>{fmtYen(r.posTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PortalSurface>
      ),
    },
    {
      id: 'recent', title: t('portal.home.recentDeliveries'), icon: 'entregas', size: 'half', defaultHidden: true,
      render: () => (
        <PortalSurface title={t('portal.home.recentDeliveries')}>
          {vendas.length === 0
            ? <Empty text={t('portal.home.noDeliveriesYet')} />
            : vendas.slice(0, 8).map(v => (
              <div key={v.id} className="dash-line">
                <span>{fmtDate(v.data)}</span>
                <strong>{fmtYen(v.total)}</strong>
              </div>
            ))}
        </PortalSurface>
      ),
    },
    {
      id: 'analytics', title: t('dash.w.analytics'), icon: 'crm', size: 'full', defaultHidden: true,
      render: () => <Suspense fallback={null}><ClientAnalyticsTab bar={bar} onTab={onTab} /></Suspense>,
    },
  ]

  return (
    <div className="fade-in portal-page easy-dash hq-dash">
      <DashboardGrid id="bar-home" widgets={widgets} layout={layout} renderHead={customize => (
        <WelcomeHeader
          kicker={`${bar.nome} · ${t('portal.home.atAGlance')}`}
          name={perfil?.nome || ''}
          greet={(part, name) => t(name ? `welcome.${part}` : `welcome.${part}Plain`, { name })}
          lead={t('welcome.barLead')}
          actions={(
            <>
              <button type="button" className="ui-btn is-primary is-sm" onClick={() => onTab?.('pos')}><Icon name="pos" size={15} /> {t('welcome.openTill')}</button>
              <button type="button" className="ui-btn is-sm" onClick={() => onTab?.('fechamento')}><Icon name="fechamento" size={15} /> {t('welcome.closeNight')}</button>
              {customize}
            </>
          )}
        />
      )} />
    </div>
  )
}

/** Night-bar hours: start at noon so a 20:00–05:00 night reads left to right, trimmed to the hours with sales. */
function nightHours(hours) {
  const order = [...hours.slice(12), ...hours.slice(0, 12)]
  const first = order.findIndex(h => h.total > 0)
  if (first < 0) return []
  const last = order.length - 1 - [...order].reverse().findIndex(h => h.total > 0)
  const from = Math.max(0, Math.min(first, last - 5))
  const to = Math.min(order.length - 1, Math.max(last, from + 5))
  return order.slice(from, to + 1).map(h => ({ label: `${String(h.hour).padStart(2, '0')}h`, value: h.total, tip: `${h.label} · ${fmtYen(h.total)} · ${h.count}` }))
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
  const [orders, setOrders] = useState([])

  useEffect(() => { load() }, [bar])

  async function load() {
    setLoading(true)
    try {
      const [movimentos, pR, rR, vR, pourR, priceR, orderR] = await Promise.all([
        fetchAllStockMovements(supabase, bar.id, '*').catch(() => []),
        supabase.from('produtos_public').select('*').eq('ativo', true).order('categoria').order('nome'),
        supabase.from('estoque_regras').select('*').eq('bar_id', bar.id),
        supabase.from('vendas').select('*, vendas_itens(*, produtos(id,nome))').eq('bar_id', bar.id).order('data', { ascending: false }),
        supabase.from('pos_vendas_itens').select('produto_id,nome,qtd,pos_venda_id'),
        supabase.from('bar_pricing').select('produto_id,drinks_por_garrafa').eq('bar_id', bar.id),
        supabase.from('pedidos').select('id,status,pedidos_itens(produto_id)').eq('bar_id', bar.id),
      ])
      setProdutos((pR.data || []).filter(isSupplierProduct))
      setOrders(orderR?.data || [])
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
    <div className="fade-in" style={{ maxWidth:1000 }}>
      <PageHeader title={t('nav.portalInventory')} subtitle={t('portal.inventory.fromDeliveries')} />

      <div className="portal-hero-grid is-three-even">
        <PortalKpi icon="package" label={t('portal.inventory.totalProducts')} value={glance.total} />
        <PortalKpi icon="warning" tone={critical.length > 0 ? 'danger' : low.length > 0 ? 'warning' : 'success'}
          label={t('portal.inventory.needAttention')} value={glance.needAttention}
          color={critical.length>0?'var(--red)':low.length>0?'var(--amber)':'var(--green)'} />
        <PortalKpi icon="ok" tone="success" label={t('portal.inventory.wellStocked')} value={glance.wellStocked} color="var(--green)" />
      </div>

      {[
        critical.length > 0 && { tone: 'danger', icon: 'warning', title: t('portal.inventory.outOfStock', { count: critical.length }), body: critical.map(p => p.nome).join('  ·  ') },
        low.length > 0 && { tone: 'warning', icon: 'warning', title: t('portal.inventory.runningLow', { count: low.length }), body: low.map(p => t('portal.inventory.leftMin', { name: p.nome, stock: p.stock, min: p.minimo })).join('  ·  ') },
      ].filter(Boolean).map(b => (
        <div key={b.tone} className={`ui-banner is-${b.tone}`}>
          <span className="ui-banner-icon"><Icon name={b.icon} size={18} /></span>
          <div className="ui-banner-main">
            <strong>{b.title}</strong>
            <span>{b.body}</span>
          </div>
          <button type="button" className="ui-btn is-primary is-sm" onClick={onOrder}>{t('portal.inventory.orderNow')}</button>
        </div>
      ))}

      <AutoReorder bar={bar} products={list} orders={orders} />

      {/* Search */}
      <div style={{ position:'relative', marginBottom:16 }}>
        <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', display:'flex' }}><Icon name="search" size={16} /></span>
        <input
          type="search" aria-label={t('portal.inventory.search')} placeholder={t('portal.inventory.search')}
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
              const dotColor = isCrit ? 'var(--red)' : isLow ? 'var(--amber)' : p.good ? 'var(--green)' : '#c5c5c7'
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
              {t('portal.inventory.currentStock')}: <strong style={{ color:'var(--c-text)' }}>{selectedProd.stock}</strong>
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
                background:'linear-gradient(135deg,var(--green),#30b350)',
                color:'white', fontSize:14, fontWeight:700, cursor:'pointer',
                boxShadow:'0 4px 12px rgba(52,199,89,0.3)'
              }}>
                {saving?'..':t('portal.inventory.addStock')}
              </button>
              <button onClick={()=>doMove(selected,'saida')} disabled={saving} style={{
                padding:'14px', borderRadius:14, border:'none',
                background:'linear-gradient(135deg,var(--amber),#e67e22)',
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
        <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', fontSize:16, color:'var(--text3)' }}><Icon name="search" size={16} /></span>
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
            { label:t('portal.pricing.avgMargin'), value: Math.round(configured.filter(p=>p.margem!==null).reduce((a,p)=>a+p.margem,0)/configured.filter(p=>p.margem!==null).length||0)+'%', color:'var(--green)', icon:'trendUp' },
            { label:t('portal.pricing.bestMargin'), value: configured.filter(p=>p.margem!==null).sort((a,b)=>b.margem-a.margem)[0]?.nome?.split(' ')[0]||'—', color:'var(--c-text)', icon:'rewards' },
            { label:t('portal.pricing.notSet'), value: notConfigured.length, color: notConfigured.length>0?'var(--amber)':'var(--green)', icon:'settings' },
          ].map(s => (
            <div key={s.label} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
              <span className="ui-kpi-icon"><Icon name={s.icon} size={18} /></span>
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
                    background: !isSet ? 'var(--text3)' : p.margem > 60 ? 'var(--green)' : p.margem > 40 ? 'var(--amber)' : 'var(--red)',
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
                        <div style={{ fontSize:15, fontWeight:800, color:'var(--c-text)' }}>{fmtYen(p.preco)}</div>
                        <div style={{ fontSize:9, color:'var(--text2)', textTransform:'uppercase', marginTop:1 }}>{t('portal.pricing.priceDrink')}</div>
                      </div>
                      <div style={{ textAlign:'center', minWidth:54 }}>
                        <div style={{ fontSize:15, fontWeight:800, color:p.margem>60?'var(--green)':p.margem>40?'var(--amber)':'var(--red)' }}>{p.margem}%</div>
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
                    <span style={{ color:'var(--c-text)' }}>{fmtYen(Math.round(form.drinks * form.preco))}</span>
                  </div>
                  <div style={{ marginTop:8, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
                    <div style={{
                      height:'100%', borderRadius:2,
                      width: Math.min(Math.round((form.preco - selectedProd.preco_venda/form.drinks)/form.preco*100), 100) + '%',
                      background: Math.round((form.preco - selectedProd.preco_venda/form.drinks)/form.preco*100) > 60 ? 'var(--green)' : 'var(--amber)'
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
  const emptyForm = { nome:'', categoria:'Custom', receita:'', copo:'', preco_venda:'', custo:'', preco_desconto:'', notas:'', imagem_url:'' }
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
    // Only send the photo when there is one: databases without pos_start.sql have no imagem_url column yet.
    if (form.imagem_url?.trim()) payload.imagem_url = form.imagem_url.trim()
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
      preco_venda:d.preco_venda, custo:d.custo, preco_desconto:d.preco_desconto||500, notas:d.notas||'', imagem_url:d.imagem_url||'' })
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
        <div style={{ background:'var(--bg2)', border:'2px solid color-mix(in srgb, var(--gold) 30%, transparent)', borderRadius:16, padding:'24px', marginBottom:20 }}>
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

          <div style={{ marginBottom:12 }}>
            <label className="form-label">{t('photo.label')}</label>
            <PhotoField value={form.imagem_url || ''} onChange={url => setForm(f => ({ ...f, imagem_url: url }))} scope={bar.id} name={form.nome} />
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
              <div style={{ padding:'12px 16px', borderRadius:12, background: liveMargin>70?'var(--green-bg)':'var(--amber-bg)', border:'1px solid', borderColor:liveMargin>70?'#86efac':'#fcd34d' }}>
                <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>Regular margin</div>
                <div style={{ fontSize:22, fontWeight:800, color:liveMargin>70?'var(--green)':'#d97706' }}>{liveMargin}%</div>
                <div style={{ fontSize:11, color:'var(--text2)' }}>¥{Math.round(+form.preco_venda - +form.custo).toLocaleString()} profit/drink</div>
              </div>
              {liveMarginVip !== null && (
                <div style={{ padding:'12px 16px', borderRadius:12, background:liveMarginVip>50?'#fdf8ec':'var(--red-bg)', border:'1px solid', borderColor:liveMarginVip>50?'var(--gold)':'#fca5a5' }}>
                  <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>VIP margin</div>
                  <div style={{ fontSize:22, fontWeight:800, color:liveMarginVip>50?'var(--gold)':'var(--red)' }}>{liveMarginVip}%</div>
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
                      style={{ padding:'6px', borderRadius:6, border:'none', background:'var(--red-bg)', color:'var(--red)', cursor:'pointer', fontSize:13 }}>✕</button>
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
                  <span><Icon name="contador" size={14} /> Auto cost: <strong style={{color:'var(--red)'}}>¥{autoCost.toLocaleString()}</strong></span>
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
          <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Best margin</div>
          <div style={{ fontSize:13, fontWeight:700 }}>{topDrink?.nome}</div>
          <div style={{ fontSize:13, color:'var(--green)', fontWeight:700 }}>{topDrink ? Math.round(topDrink.margem*100)+'%' : ''}</div>
        </div>
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
          <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Watch out</div>
          <div style={{ fontSize:13, fontWeight:700 }}>{lowDrink?.nome}</div>
          <div style={{ fontSize:13, color:'var(--red)', fontWeight:700 }}>{lowDrink ? Math.round(lowDrink.margem*100)+'%' : ''}</div>
        </div>
      </div>

      {/* Search + sort */}
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <div style={{ position:'relative', flex:1 }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)' }}><Icon name="search" size={16} /></span>
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
          const margColor = margPct >= 85 ? 'var(--green)' : margPct >= 70 ? 'var(--amber)' : 'var(--red)'
          const vipColor  = vipMarg !== null ? (vipMarg >= 50 ? '#f59e0b' : 'var(--red)') : 'var(--text3)'
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
                {d.notas && <div style={{ fontSize:11, color:'var(--c-text-2)', marginTop:1 }}>{d.notas}</div>}
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
                <button onClick={()=>startEdit(d)} style={{ padding:'4px 8px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'transparent', cursor:'pointer', color:'var(--text2)' }}><Icon name="edit" size={14} /></button>
                <button onClick={()=>deleteDrink(d.id)} style={{ padding:'4px 8px', fontSize:11, borderRadius:6, border:'none', background:'var(--red-bg)', cursor:'pointer', color:'var(--red)' }}><Icon name="trash" size={14} /></button>
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
  const [pedidos, setPedidos] = useState([])
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
    const [fR, vR, pR, pedR] = await Promise.all([
      supabase.from("faturas").select("*").eq("bar_id", bar.id).order("data_vencimento", { ascending:false }),
      supabase.from("vendas").select("total,data,data_venda").eq("bar_id", bar.id).order("data", { ascending:false }),
      supabase.from("fatura_pagamentos").select("*, faturas!inner(bar_id)").eq("faturas.bar_id", bar.id).order("criado_em", { ascending:false }),
      supabase.from("pedidos").select("id,status,total_estimado,data_pedido,criado_em,pedidos_itens(qtd,preco_unitario)").eq("bar_id", bar.id).order("criado_em", { ascending:false }).limit(200),
    ])
    const jbmFaturas = filterJbmDrinksFaturas(fR.data || [])
    setFaturas(jbmFaturas)
    setPedidos(pedR.data || [])
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

  const filtered = faturas.filter(f => invoiceInRange(f, dateFrom, dateTo))
  const ordersInRange = pedidos.filter(p => dateInRange(p.data_pedido || p.criado_em, dateFrom, dateTo))
  const notesInRange = vendas.filter(v => dateInRange(v.data || v.data_venda, dateFrom, dateTo))
  const activeMonth = dateFrom && dateTo && dateFrom.slice(0, 7) === dateTo.slice(0, 7) ? dateFrom.slice(0, 7) : ''
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
      <PageHeader title={t('portal.invoices.title')} subtitle={t('portal.invoices.subtitle')} />
      <RangeCalendar from={dateFrom} to={dateTo} onChange={(a, b) => { setDateFrom(a); setDateTo(b) }} />
      <BillMatch orders={ordersInRange} notes={notesInRange} invoices={filtered} monthKey={activeMonth} variant="slip" />
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
                  <span> · {t('portal.invoices.periodRange', { from: fmtDate(faturaEmissao(f)), to: fmtDate(faturaPeriodoFim(f)) })}</span>
                  <span> · {t('portal.invoices.dueOn', { date: fmtDate(faturaVencimento(f)) })} · {f.daysOverdue}d</span>
                  {faturaPago(f) > 0 && (
                    <span> · {t('portal.invoices.paidPct', { amount: fmtYen(faturaPago(f)), pct: faturaValor(f) > 0 ? Math.round(faturaPago(f) / faturaValor(f) * 100) : 0 })}</span>
                  )}
                </div>
                <b>{fmtYen(f.remain)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      {overdue.length>0 && (
        <div style={{ background:"linear-gradient(135deg,var(--red),#c0392b)", borderRadius:16, padding:"16px 20px", marginBottom:16 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"white" }}>{t('portal.invoices.overdueAlert', { count: overdue.length })}</div>
        </div>
      )}
      <div className="portal-grid-4" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
        {[
          { label:t('portal.invoices.pending'), value:fmtYen(totalPending), color:totalPending>0?"var(--red)":"var(--green)", icon:"stAwaitingOrder" },
          { label:t('portal.invoices.totalPaid'), value:fmtYen(filtered.reduce((a,f)=>a+faturaPago(f),0)), color:"var(--green)", icon:"ok" },
          { label:t('portal.invoices.overdue'), value:overdue.length, color:overdue.length>0?"var(--red)":"var(--green)", icon:"warning" },
          { label:t('portal.invoices.avgMonthly'), value:fmtYen(avgMonthly), color:"var(--navy)", icon:"report" },
        ].map(k=>(
          <div key={k.label} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14, padding:"14px" }}>
            <span className="ui-kpi-icon" style={{ marginBottom:8 }}><Icon name={k.icon} size={18} /></span>
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
                <div style={{ width:44, height:44, borderRadius:12, background:daysLeft<=5?"var(--red-bg)":"var(--green-bg)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
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
                    <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:f.status==="pago"?"var(--green-bg)":isOverdue?"var(--red-bg)":"var(--blue-bg)", color:f.status==="pago"?"var(--green)":isOverdue?"var(--red)":"var(--navy)" }}>
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
                  <div style={{ background:"var(--amber-bg)", border:"1px solid #fcd34d", borderRadius:8, padding:"8px 12px", marginBottom:8, fontSize:12 }}>
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
                      <span className="ui-empty-icon" style={{ margin:'0 auto 8px' }}><Icon name="fileDoc" size={22} /></span>
                    ) : (
                      <img src={image} alt="comprovante" style={{ maxHeight:150, maxWidth:"100%", borderRadius:8, marginBottom:8 }} />
                    )}
                    <div style={{ fontSize:12, color:"var(--text2)", marginTop:4 }}>{t('portal.invoices.fileUploaded')}</div>
                  </div>
                ):(
                  <div>
                    <span className="ui-empty-icon" style={{ margin:'0 auto 6px' }}><Icon name="image" size={20} /></span>
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
          { id:'precos', label:t('portal.home.posPricesTab'), icon:'precos' },
          { id:'cardapio', label:t('portal.home.menuTab'), icon:'catCocktail' },
        ].map(item => (
          <button key={item.id} onClick={()=>setSub(item.id)} style={{
            padding:'10px 18px', borderRadius:12, fontSize:13, fontWeight:700, cursor:'pointer',
            border: sub===item.id ? '2px solid var(--navy)' : '1px solid var(--border)',
            background: sub===item.id ? 'var(--navy)' : 'var(--bg2)',
            color: sub===item.id ? 'white' : 'var(--text)',
          }}><Icon name={item.icon} size={15} /> {item.label}</button>
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
  const location = useLocation()
  const navigate = useNavigate()
  // Tabs reachable by URL (/bar/<tab>): the role's menu plus staff self-service sections.
  const allowedTabs = [...NAV_GROUPS.flatMap(g => g.items.map(n => n.id)), ...DOCK.map(d => d.id), 'hoje', 'profile', 'shifts', 'goals', 'result', 'points', 'occurrences', 'rewards', 'salary', 'equipe', 'entregas']
  const tab = tabFromPath(location.pathname, 'bar', allowedTabs, defaultBarTab(perfil?.role))
  const [opened, setOpened] = useState(() => new Set([tab]))
  const [menuOpen, setMenuOpen] = useState(false)
  const [door, setDoor] = useState(() => loginDoorFromHash())
  const { t } = useI18n()
  const overdueAlerts = useBarOverdueAlerts(bar?.id)
  const { setCtx: setAiCtx } = useAiPanel()
  const aiOn = isGerente(perfil?.role) && BAR_ADMIN_TABS.has(tab)
  const rail = useSidebarCollapse()
  const navLabel = id => NAV_GROUPS.flatMap(g => g.items).find(n => n.id === id)?.labelKey

  useEffect(() => {
    setOpened(prev => (prev.has(tab) ? prev : new Set([...prev, tab])))
    setAiCtx({ module: aiModuleForTab(tab), screen: tab, title: t(navLabel(tab) || 'nav.portalHome'), unit: bar?.nome, barId: bar?.id })
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  useMobileMenuLock(menuOpen)

  useEffect(() => {
    const sync = () => setDoor(loginDoorFromHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  function selectTab(id) {
    const next = id === 'equipe' || id === 'casa' ? 'staff' : id === 'outro' ? 'fixo' : id
    // The hash keeps the login door (pos / clock / gerente); the path carries the screen.
    if (next !== tab) navigate({ pathname: pathForTab('bar', next), hash: location.hash })
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
            <div className="till-kiosk-lane">{perfil?.nome ? `${perfil.nome} · ` : ''}{tillKiosk ? t('auth.lanePos') : t('auth.laneStaff')}</div>
          </div>
          <div className="till-kiosk-actions">
            {tillKiosk && isGerente(perfil?.role) && (
              <button type="button" onClick={() => { setDoorHash('gerente'); setDoor('gerente') }}>{t('auth.openHq')}</button>
            )}
            <button type="button" onClick={signOut}>{t('atomicPos.lockTill')}</button>
          </div>
        </header>
        <main className="app-main app-main-wide till-kiosk-main">
          <AutoClose bar={bar} />
          {tillKiosk && posAccess !== 'none' && (
            <TabHold><AtomicPosPanel bar={bar} access={kioskAccess} /></TabHold>
          )}
          {clockKiosk && <TabHold><TimeClockPanel bar={bar} /></TabHold>}
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
        {aiOn && <AskAiButton />}
        <NotificationBell notifs={notifs} unread={unread} markRead={markRead} markAllRead={markAllRead} deleteNotif={deleteNotif} deleteAll={deleteAll} onNavigate={selectTab} overdueAlerts={overdueAlerts} placement="header"/>
      </MobileTopBar>

      <aside className={`sidebar${menuOpen ? ' open' : ''}${rail.collapsed ? ' is-collapsed' : ''}`}>
        <div className="sidebar-brand">
          <LogoSidebar />
          {rail.allowed && <SidebarCollapseButton collapsed={rail.collapsed} onToggle={rail.toggle} />}
        </div>
        <nav className="sidebar-nav">
          {NAV_GROUPS.map(g => (
            <div key={g.id} className="nav-group">
              {g.labelKey && <div className="nav-group-label">{t(g.labelKey)}</div>}
              {g.items.map(n => (
                <button key={n.id} onClick={() => selectTab(n.id)} className={`nav-item ${tab===n.id?'active':''}`} aria-current={tab===n.id ? 'page' : undefined} title={rail.collapsed ? t(n.labelKey) : undefined} aria-label={rail.collapsed ? t(n.labelKey) : undefined}>
                  <Icon name={hasIcon(n.id) ? n.id : 'info'} size={18} />
                  <span className="nav-label" style={{ fontSize: 13 }}>{t(n.labelKey)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-footer-details">
          <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.06em'}}>{t('shell.clientPortal')}</div>
          <div style={{fontSize:13,fontWeight:700,color:'var(--gold)',marginBottom:2}}>{bar.nome}</div>
          <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.85)',marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{perfil?.nome || ''}</div>
          <div style={{fontSize:10,color:'color-mix(in srgb, var(--gold) 75%, transparent)',marginBottom:12}}>{perfil?.role ? roleLabel(perfil.role) : ''}</div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginBottom:10,lineHeight:1.5}}>
            {t(footerKey)}
          </div>
          </div>
          <button onClick={signOut} className="sidebar-signout" title={rail.collapsed ? `${bar.nome} · ${t('common.signOut')}` : undefined} aria-label={t('common.signOut')}><Icon name="signOut" size={15} className="sidebar-signout-icon" /><span className="nav-label">{t('common.signOut')}</span></button>
        </div>
      </aside>
      <main className="app-main app-main-wide">
        <AutoClose bar={bar} />
        <WorkspaceChrome
          start={<GlobalSearch
            screens={NAV_GROUPS.flatMap(g => g.items).map(n => ({ id: n.id, label: t(n.labelKey), icon: hasIcon(n.id) ? n.id : 'info' }))}
            loadRecords={async () => {
              const ids = new Set(NAV_GROUPS.flatMap(g => g.items).map(n => n.id))
              const out = []
              if (ids.has('precos')) {
                const { data } = await supabase.from('drink_menu').select('id,nome,categoria').eq('bar_id', bar.id).limit(400)
                ;(data || []).forEach(d => out.push({ key: `d-${d.id}`, label: d.nome, sub: d.categoria || t('search.product'), icon: 'precos', tab: 'precos' }))
              }
              return out
            }}
            onGo={selectTab}
          />}
          end={<TopbarUser name={perfil?.nome || ''} role={`${bar.nome}${perfil?.role ? ` · ${roleLabel(perfil.role)}` : ''}`} />}
        >
          {aiOn && <AskAiButton />}
          <UiPrefsPanel compact />
          {isGerente(perfil?.role) && (
            <button type="button" className="chrome-till" onClick={() => { setDoorHash('pos'); setDoor('pos') }}>
              {t('auth.openTillTablet')}
            </button>
          )}
          <NotificationBell notifs={notifs} unread={unread} markRead={markRead} markAllRead={markAllRead} deleteNotif={deleteNotif} deleteAll={deleteAll} onNavigate={selectTab} overdueAlerts={overdueAlerts} placement="header"/>
        </WorkspaceChrome>
        {perfil?.role === 'bar_staff' && <Suspense fallback={null}><StaffAlerts /></Suspense>}
        {tab==='custos'    && isGerente(perfil?.role) && <BarCostsTab bar={bar} onTab={selectTab} />}
        {tab==='metas' && canManageBarTeam(perfil?.role) && <TabHold><BarGoalsTab bar={bar} /></TabHold>}
        {['hoje', 'profile', 'shifts', 'goals', 'result', 'points', 'occurrences', 'rewards', 'salary'].includes(tab) && perfil?.role === 'bar_staff' && <TabHold><EmployeeDesk section={tab} bar={bar} onTab={selectTab} /></TabHold>}
        {tab==='eventos' && canManageBarTeam(perfil?.role) && <TabHold><BarEventsTab bar={bar} /></TabHold>}
        {['fechamento', 'pagamentos', 'salarios'].some(id => opened.has(id)) && canManageBarTeam(perfil?.role) && (
          <div hidden={!['fechamento', 'pagamentos', 'salarios'].includes(tab)}>
            <TabHold><BarFinance bar={bar} section={['fechamento', 'pagamentos', 'salarios'].includes(tab) ? tab : 'fechamento'} onTab={selectTab} /></TabHold>
          </div>
        )}
        {opened.has('inicio') && posAccess !== 'cashier' && (
          <div hidden={tab !== 'inicio'}>
            <HomeTab bar={bar} onTab={selectTab} />
          </div>
        )}
        {tab==='pos'       && posAccess !== 'none' && <TabHold><AtomicPosPanel bar={bar} onOrder={posAccess === 'owner' ? () => selectTab('pedidos') : undefined} access={posAccess} /></TabHold>}
        {tab==='ponto'     && <TabHold><TimeClockPanel bar={bar} onOpenStaff={() => selectTab('staff')} /></TabHold>}
        {['staff', 'fornecedor', 'parceiro', 'cartao', 'energia', 'aluguel', 'fixo', 'variavel', 'contador', 'imposto'].some(id => opened.has(id)) && canManageBarTeam(perfil?.role) && (
          <div hidden={!['staff', 'fornecedor', 'parceiro', 'cartao', 'energia', 'aluguel', 'fixo', 'variavel', 'contador', 'imposto'].includes(tab)}>
            <TabHold><BarHouseTab bar={bar} section={['staff', 'fornecedor', 'parceiro', 'cartao', 'energia', 'aluguel', 'fixo', 'variavel', 'contador', 'imposto'].includes(tab) ? tab : 'staff'} onTab={selectTab} /></TabHold>
          </div>
        )}
        {tab==='drinkback' && canManageBarTeam(perfil?.role) && <TabHold><DrinkBackTab bar={bar} /></TabHold>}
        {tab==='equipe'    && canManageBarTeam(perfil?.role) && <TabHold><BarTeamTab bar={bar} /></TabHold>}
        {tab==='clientes'  && canManageBarTeam(perfil?.role) && <TabHold><BarGuestsTab bar={bar} /></TabHold>}
        {tab==='espacos'   && canManageBarTeam(perfil?.role) && <TabHold><BarSpacesTab bar={bar} onTab={selectTab} /></TabHold>}
        {tab==='vip'       && canManageBarTeam(perfil?.role) && <TabHold><BarVipTab bar={bar} onTab={selectTab} /></TabHold>}
        {tab==='ordens'    && canManageBarTeam(perfil?.role) && <TabHold><StaffOrdersTab bar={bar} /></TabHold>}
        {tab==='pedidos'   && canPlaceDrinkOrders(perfil?.role) && <TabHold><BarOrdersTab bar={bar} manager={canManageBarTeam(perfil?.role)} /></TabHold>}
        {tab==='entregas'  && canManageBarTeam(perfil?.role) && <TabHold><BarOrdersTab bar={bar} section="received" /></TabHold>}
        {tab==='estoque'   && canManageBarTeam(perfil?.role) && <InventoryTab bar={bar} onOrder={()=>selectTab('pedidos')} />}
        {tab==='precos'    && canManageBarTeam(perfil?.role) && <PrecosCardapioTab bar={bar} />}
        {tab==='faturas'   && canManageBarTeam(perfil?.role) && <FaturasTab bar={bar} />}
        {tab==='recibos'  && canManageBarTeam(perfil?.role) && <TabHold><PortalRecibosTab bar={bar} /></TabHold>}
        {tab==='ia'       && canManageBarTeam(perfil?.role) && <TabHold><AiCenter bar={bar} /></TabHold>}
        {tab==='mesas'     && posAccess !== 'none' && <TabHold><FloorScreen bar={bar} onOpenTill={() => selectTab('pos')} /></TabHold>}
        {tab==='marketing' && canManageBarTeam(perfil?.role) && <TabHold><MarketingHub barId={bar.id} /></TabHold>}
        {tab==='consultoria' && canManageBarTeam(perfil?.role) && <TabHold><ConsultingHub barId={bar.id} /></TabHold>}
      </main>
      {aiOn && <AskAiDrawer />}
      {DOCK.length > 0 && (
        <nav className="easy-dock" aria-label={t('nav.portalHome')}>
          {DOCK.map(d => (
            <button key={d.id} type="button" className={tab===d.id ? 'is-on' : ''} onClick={() => selectTab(d.id)}>
              <span className="easy-dock-icon"><Icon name={hasIcon(d.id) ? d.id : 'info'} size={20} /></span>
              <span>{t(d.labelKey)}</span>
            </button>
          ))}
          <button type="button" className={!dockOn || menuOpen ? 'is-on' : ''} onClick={() => setMenuOpen(o => !o)}>
            <span className="easy-dock-icon"><Icon name="menu" size={20} /></span>
            <span>{t('nav.more')}</span>
          </button>
        </nav>
      )}
    </div>
  )
}
