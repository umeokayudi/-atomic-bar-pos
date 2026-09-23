import { Component } from 'react'
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e.message } }
  render() {
    if (this.state.error) return <div style={{padding:20,color:'red',fontSize:14,background:'white',minHeight:'100vh'}}><h2>Error</h2><p>{this.state.error}</p></div>
    return this.props.children
  }
}

import { LogoSidebar } from './components/Logo'
import { MobileTopBar, ShellOverlay, WorkspaceChrome, useMobileMenuLock } from './components/MobileShell'
import { useNotifications, NotificationBell, useOverdueAlerts } from './components/Notifications'
import { useState, useEffect, useRef } from 'react'
import { AuthProvider, useAuth, LoginPage } from './components/Auth'
import { supabase } from './lib/supabase'
import ComprasTab   from './components/Compras'
import VendasTab    from './components/Vendas'
import RelatorioTab from './components/Relatorio'
import RyoshushoTab from './components/Ryoshusho'
import SeikyushoTab from './components/Seikyusho'
import PortalCliente from './components/PortalCliente'
import { isBarRole } from './lib/access'
import { ProductsTab, BarsTab, UsuariosTab } from './components/Configs'
import Fornecedores from './components/Fornecedores'
import Faturas from './components/Faturas'
import Cashflow from './components/Cashflow'
import ReportsBilling from './components/ReportsBilling'
import { PedidosAdminTab } from './components/Configs'
import { fmtYen, fmtDate, roleLabel } from './components/utils'
import { I18nProvider, useI18n } from './lib/i18n'
import UiPrefsPanel from './components/UiPrefsPanel'
import { UiPrefsProvider, useUiPrefs, LAYOUTS } from './lib/uiPrefs'
import { loadDashboard, invalidateDashboard } from './lib/loadDashboard'
import { PageHeader, PortalHero, PortalKpi, PortalSurface, PortalAlert } from './components/ui/PageLayout'
import DashboardMetricModal from './components/DashboardMetricModal'
import DashboardCalendar from './components/DashboardCalendar'
import DashboardAi from './components/DashboardAi'
import MarkPaidPopup from './components/MarkPaidPopup'

// ── TABS por role ─────────────────────────────────────────────────────────────
const ADMIN_TABS = [
  { id:'dashboard', labelKey:'nav.dashboard', icon:'📊' },
  { id:'billingHub', labelKey:'nav.billingHub', icon:'📱' },
  { id:'purchases', labelKey:'nav.purchases', icon:'🛒' },
  { id:'sales',    labelKey:'nav.sales', icon:'💴' },
  { id:'pedidos',   labelKey:'nav.orders', icon:'📋' },
  { id:'relatorio', labelKey:'nav.report', icon:'📈' },
  { id:'ryoshusho', labelKey:'nav.ryoshusho', icon:'🧾' },
  { id:'seikyusho', labelKey:'nav.seikyusho', icon:'📄' },
  { id:'products',  labelKey:'nav.products', icon:'🍾' },
  { id:'bars',      labelKey:'nav.bars', icon:'🏪' },
  { id:'usuarios',  labelKey:'nav.users', icon:'👥' },
  { id:'faturas',    labelKey:'nav.invoices', icon:'💰' },
  { id:'suppliers',  labelKey:'nav.suppliers', icon:'🏭' },
  { id:'cashflow',   labelKey:'nav.cashflow', icon:'💸' },
]

const STAFF_TABS = [
  { id:'purchases', labelKey:'nav.purchases', icon:'🛒' },
  { id:'sales',    labelKey:'nav.sales', icon:'💴' },
  { id:'relatorio', labelKey:'nav.report', icon:'📈' },
  { id:'ryoshusho', labelKey:'nav.ryoshusho', icon:'🧾' },
  { id:'products',  labelKey:'nav.products', icon:'🍾' },
]

// ── MINI BAR CHART ────────────────────────────────────────────────────────────
function BarChart({ data, color='#c19c56', height=80, valueLabel=fmtYen }) {
  const [active, setActive] = useState(null)
  if (!data || data.length === 0) return null
  const max = Math.max(...data.map(d => d.value), 1)

  return (
    <div className="chart-bars" style={{ height: height + 48 }}>
      {data.map((d, i) => {
        const barH = Math.max(4, (d.value / max) * height * 0.85)
        const isLast = i === data.length - 1
        const isOn = active === i
        const tip = d.tip || `${d.month || d.label}: ${valueLabel(d.value)}`
        return (
          <div
            key={i}
            className={`chart-bar-cell${isOn ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <div className="chart-bar-tip">{tip}</div>
            <div className="chart-bar-value">{valueLabel(d.value)}</div>
            <div
              className="chart-bar-fill"
              style={{
                height: `${barH}px`,
                background: color,
                opacity: isOn || isLast ? 1 : 0.45,
              }}
            />
            <div className="chart-bar-label">{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function MetricCard({ label, value, sub, color, onClick, hint }) {
  return (
    <PortalKpi
      label={label}
      value={value}
      sub={sub}
      color={color}
      onClick={onClick}
      hint={hint}
    />
  )
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function goToReport(onNav, month) {
  try { sessionStorage.setItem('relatorioMonth', month) } catch {}
  onNav('relatorio')
}

function Dashboard({ onNav }) {
  const { user } = useAuth()
  const { t, monthLabel } = useI18n()
  const [data, setData] = useState(null)
  const [selMonth, setSelMonth] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [detailModal, setDetailModal] = useState(null)
  const [payItem, setPayItem] = useState(null)

  useEffect(() => { if (user) loadStats() }, [user])

  async function loadStats() {
    setLoadErr('')
    setLoading(true)
    try {
      const payload = await loadDashboard()
      const now = new Date()
      const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      setData(payload)
      setSelMonth(prev => prev || mesAtual)
    } catch (e) {
      console.error('loadStats error', e)
      setLoadErr(e.message || t('dashboard.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const emptyMonth = {
    receita: 0, faturamento: 0, compras: 0, lucro: 0, lucroProjetado: 0,
    margem: 0, vendasCount: 0, comprasCount: 0, aReceber: 0, entregasDetalhe: [],
  }
  const m = data?.byMonth?.[selMonth] || emptyMonth
  const lucroChart = (data?.chart || []).map(row => ({
    label: monthLabel(row.month).split('/')[0],
    month: monthLabel(row.month),
    value: row.lucro,
    tip: t('dashboard.chartTip', {
      month: monthLabel(row.month),
      profit: fmtYen(row.lucro),
      revenue: fmtYen(row.faturamento || row.receita),
      purchases: fmtYen(row.compras),
    }),
  }))

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text2)' }}><span className="spinner" />{t('common.loading')}</div>
  if (loadErr) {
    return (
      <div style={{ maxWidth: 520, padding: 24 }}>
        <PortalAlert variant="red">
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('dashboard.loadError')}</div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>{loadErr}</div>
        </PortalAlert>
        <button className="btn-primary" onClick={loadStats} style={{ marginTop: 16 }}>{t('common.retry')}</button>
      </div>
    )
  }
  const now = new Date()
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const isCurrentMonth = selMonth === mesAtual
  const noSales = !(m.faturamento || m.receita || m.compras || (m.entregasDetalhe || []).length)
  const entregasCount = m.entregasDetalhe?.length ?? m.vendasCount ?? 0
  const modalStats = {
    faturamento: m.faturamento ?? m.receita,
    receitaMes: m.receita,
    totalVendas: entregasCount,
    vendasDetalhe: m.entregasDetalhe || [],
    entregasDetalhe: m.entregasDetalhe || [],
  }

  return (
    <div className="fade-in" style={{ maxWidth: 1000 }}>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={`${isCurrentMonth ? t('dashboard.currentMonth') : t('dashboard.history')} · ${monthLabel(selMonth)}`}
      />

      <DashboardAi snapshot={{
        monthLabel: monthLabel(selMonth),
        lucro: m.lucroProjetado ?? m.lucro,
        faturamento: m.faturamento ?? m.receita,
        compras: m.compras,
        margem: m.margem,
        aReceber: m.aReceber || 0,
        entregas: entregasCount,
        pedidosPendentes: data.pedidosPendentes || 0,
        overdueText: (data.alertas?.faturasAtrasadas || []).map(f => `${f.barNome} ${fmtYen(f.valor)} (${fmtDate(f.vencimento)})`).join('\n'),
        payText: (data.alertas?.comprasAtrasadas || []).map(c => `${c.fornecedor} ${fmtYen(c.valor)} (${fmtDate(c.vencimento)})`).join('\n'),
        calText: (data.calendar || [])
          .filter(e => e.date?.startsWith(selMonth))
          .slice(0, 40)
          .map(e => `${e.date} ${e.kind} ${e.label} ${e.amount || 0}`)
          .join('\n'),
      }} />

      {data.pedidosPendentes > 0 && (
        <PortalAlert variant="navy" onClick={() => onNav('pedidos')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t('dashboard.pendingOrders', { count: data.pedidosPendentes })}</span>
            <span style={{ color: 'var(--gold)', fontSize: 12, fontWeight: 700 }}>{t('dashboard.see')}</span>
          </div>
        </PortalAlert>
      )}

      {(data.alertas?.faturasAtrasadasTotal > 0 || data.alertas?.comprasAtrasadasTotal > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {data.alertas.faturasAtrasadasTotal > 0 && (
            <PortalAlert variant="red" onClick={() => onNav('faturas')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                    {t('dashboard.overdueInvoices', { count: data.alertas.faturasAtrasadas.length })}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.95 }}>
                    Total {fmtYen(data.alertas.faturasAtrasadasTotal)}
                    {data.alertas.faturasAtrasadas.slice(0, 4).map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setPayItem({ type: 'fatura', id: f.id, label: f.barNome, amount: f.valor, dueDate: f.vencimento, paid: false })
                        }}
                        style={{ display: 'inline', margin: 0, padding: 0, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }}
                      >
                        {' · '}{f.barNome} ({fmtDate(f.vencimento)})
                      </button>
                    ))}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.9, whiteSpace: 'nowrap' }}>{t('dashboard.seeInvoices')}</span>
              </div>
            </PortalAlert>
          )}
          {data.alertas.comprasAtrasadasTotal > 0 && (
            <PortalAlert variant="amber" onClick={() => onNav('cashflow')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: 'var(--red)' }}>
                    {t('dashboard.overduePayments', { count: data.alertas.comprasAtrasadas.length })}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                    Total {fmtYen(data.alertas.comprasAtrasadasTotal)}
                    {data.alertas.comprasAtrasadas.slice(0, 4).map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setPayItem({ type: 'compra', id: c.id, label: c.fornecedor, amount: c.valor, dueDate: c.vencimento, paid: false })
                        }}
                        style={{ display: 'inline', margin: 0, padding: 0, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }}
                      >
                        {' · '}{c.fornecedor} ({fmtDate(c.vencimento)})
                      </button>
                    ))}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap' }}>{t('dashboard.seeCashflow')}</span>
              </div>
            </PortalAlert>
          )}
        </div>
      )}

      <div className="portal-hero-grid">
        <PortalHero
          label={t('dashboard.projectedProfit', { month: monthLabel(selMonth) })}
          value={fmtYen(m.lucroProjetado ?? m.lucro)}
          sub={m.comprasEstimadas
            ? t('dashboard.marginSubEst', { margin: m.margem, revenue: fmtYen(m.faturamento), cost: fmtYen(m.compras) })
            : t('dashboard.marginSub', { margin: m.margem, revenue: fmtYen(m.faturamento ?? m.receita), purchases: fmtYen(m.compras) })}
          onClick={() => goToReport(onNav, selMonth)}
        />
        <PortalKpi
          label={t('dashboard.billing')}
          value={fmtYen(m.faturamento ?? m.receita)}
          sub={m.comprasEstimadas
            ? t('dashboard.billingSubOrders', { count: entregasCount })
            : m.receita > 0 && m.faturamento !== m.receita
              ? t('dashboard.billingSubPaid', { paid: fmtYen(m.receita), count: entregasCount })
              : t('dashboard.billingSub', { count: entregasCount })}
          color="var(--navy)"
          onClick={() => setDetailModal('receita')}
          hint={t('dashboard.clickDeliveries')}
        />
        <PortalKpi
          label={t('dashboard.receivable')}
          value={fmtYen(m.aReceber || 0)}
          sub={t('dashboard.receivableSub')}
          color={(m.aReceber || 0) > 0 ? 'var(--amber)' : 'var(--green)'}
          onClick={() => onNav('faturas')}
          hint={t('dashboard.seeInvoicesHint')}
        />
        <PortalKpi
          label={t('dashboard.projectedMargin')}
          value={`${m.margem}%`}
          sub={m.comprasEstimadas
            ? t('dashboard.marginDetailEst', { amount: fmtYen(m.compras) })
            : t('dashboard.marginDetail', { amount: fmtYen(m.compras), count: m.comprasCount })}
          color={m.margem >= 20 ? 'var(--green)' : m.margem > 0 ? 'var(--amber)' : 'var(--red)'}
          onClick={() => goToReport(onNav, selMonth)}
          hint={t('dashboard.reportDetail')}
        />
      </div>

      {noSales && (
        <PortalAlert variant="navy">
          <div style={{ fontSize: 13 }}>{t('dashboard.noSalesMonth', { month: monthLabel(selMonth) })}</div>
        </PortalAlert>
      )}

      <DashboardCalendar
        events={data.calendar || []}
        onNav={onNav}
        month={selMonth}
        onMonthChange={setSelMonth}
        onPay={setPayItem}
      />

      <PortalSurface title={t('dashboard.chartTitle')} sub={t('dashboard.chartSub')} style={{ marginTop: 20 }}>
        <BarChart data={lucroChart} color="#1a6b4a" height={72} />
      </PortalSurface>

      <PortalSurface title={t('dashboard.quickActions')}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { labelKey: 'dashboard.newPurchase', tab: 'purchases' },
            { labelKey: 'dashboard.registerSale', tab: 'sales' },
            { labelKey: 'nav.orders', tab: 'pedidos' },
            { labelKey: 'dashboard.invoiceReader', tab: 'seikyusho' },
            { labelKey: 'nav.invoices', tab: 'faturas' },
          ].map(a => (
            <button key={a.tab} onClick={() => onNav(a.tab)} className="btn-primary" style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12 }}>{t(a.labelKey)}</button>
          ))}
        </div>
      </PortalSurface>

      <DashboardMetricModal
        open={detailModal === 'receita'}
        onClose={() => setDetailModal(null)}
        type="receita"
        monthLabel={monthLabel(selMonth)}
        stats={modalStats}
      />
      {payItem && (
        <MarkPaidPopup
          item={payItem}
          onClose={() => setPayItem(null)}
          onSaved={() => { invalidateDashboard(); loadStats() }}
        />
      )}
    </div>
  )
}

// ── SHELL ─────────────────────────────────────────────────────────────────────
function Shell() {
  const { user, perfil, loading, signOut } = useAuth()
  const { layout } = useUiPrefs()
  const { t } = useI18n()
  const [tab, setTab] = useState('dashboard')
  const [bar, setBar] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pedidosPendentes, setPedidosPendentes] = useState(0)
  const { notifs, unread, markRead, markAllRead, deleteNotif, deleteAll } = useNotifications()
  const overdueAlerts = useOverdueAlerts()
  const landedUsers = useRef(false)

  useMobileMenuLock(menuOpen)

  useEffect(() => {
    if (!landedUsers.current && perfil?.role === 'admin') {
      landedUsers.current = true
      setTab('usuarios')
    }
  }, [perfil])

  useEffect(() => {
    if (layout === LAYOUTS.desktop || layout === LAYOUTS.tablet) setMenuOpen(false)
  }, [layout])

  function selectTab(id) {
    setTab(id)
    setMenuOpen(false)
  }

  useEffect(() => {
    if (isBarRole(perfil?.role) && perfil.bar_id) {
      let cancelled = false
      supabase.from('bars').select('*').eq('id', perfil.bar_id).single()
        .then(({ data }) => {
          if (!cancelled) setBar(data || { id: perfil.bar_id, nome: 'Atomic Bar' })
        })
        .catch(() => {
          if (!cancelled) setBar({ id: perfil.bar_id, nome: 'Atomic Bar' })
        })
    }
    if (perfil?.role === 'admin') {
      supabase.from('pedidos').select('id', { count:'exact' }).eq('status','pendente')
        .then(({ count }) => setPedidosPendentes(count||0))
    }
  }, [perfil])

  if (loading || (user && !perfil)) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16,background:'var(--navy)'}}>
      <LogoSidebar />
      <span className="spinner"/>
    </div>
  )

  if (!user && !perfil) return <LoginPage />

  // PORTAL DO BAR (dono / caixa tablet / staff) — isolado do painel JBM
  if (isBarRole(perfil?.role)) {
    if (!perfil.bar_id) {
      return (
        <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--navy)', color:'white', flexDirection:'column', gap:16, padding:24, textAlign:'center' }}>
          <LogoSidebar />
          <div style={{ fontSize:16, fontWeight:700 }}>{t('auth.accountNotLinked')}</div>
          <div style={{ fontSize:13, color:'rgba(255,255,255,0.55)', maxWidth:360, lineHeight:1.6 }}>
            {t('auth.accountNotLinkedHint')}
          </div>
          <button onClick={signOut} style={{ marginTop:8, padding:'10px 20px', borderRadius:8, border:'1px solid rgba(255,255,255,0.2)', background:'transparent', color:'white', cursor:'pointer' }}>{t('common.signOut')}</button>
        </div>
      )
    }
    if (!bar) return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--navy)',color:'white',flexDirection:'column',gap:16}}><LogoSidebar /><div style={{color:'rgba(255,255,255,0.5)',fontSize:13}}>{t('auth.loadingPortal')}</div></div>
    return <PortalCliente bar={bar} signOut={signOut} notifs={notifs} unread={unread} markRead={markRead} markAllRead={markAllRead} deleteNotif={deleteNotif} deleteAll={deleteAll}/>
  }

  // ADMIN / FUNCIONÁRIO
  const tabs = perfil?.role==='admin' ? ADMIN_TABS : STAFF_TABS
  if (tab==='dashboard' && perfil?.role!=='admin') setTab('purchases')

  return (
    <div className="app-shell">
      <ShellOverlay open={menuOpen} onClose={() => setMenuOpen(false)} />
      <MobileTopBar
        open={menuOpen}
        onToggle={() => setMenuOpen(o => !o)}
        title={tab === 'billingHub' ? (
          <span style={{ fontSize: 14, fontWeight: 800, color: 'white', letterSpacing: '-0.02em' }}>{t('billingHub.mobileTitle')}</span>
        ) : undefined}
      >
        {perfil?.role === 'admin' && tab !== 'billingHub' && (
          <button
            type="button"
            className="mobile-hub-btn"
            onClick={() => selectTab('billingHub')}
            aria-label={t('billingHub.mobileTitle')}
          >
            📊
            {(overdueAlerts?.faturas?.length ?? 0) > 0 && (
              <span className="mobile-hub-badge">{overdueAlerts.faturas.length}</span>
            )}
          </button>
        )}
        <NotificationBell notifs={notifs} unread={unread} markRead={markRead} markAllRead={markAllRead} deleteNotif={deleteNotif} deleteAll={deleteAll} onNavigate={selectTab} overdueAlerts={overdueAlerts} placement="header"/>
      </MobileTopBar>

      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <LogoSidebar />
        </div>
        <nav className="sidebar-nav">
          {tabs.map(nav => (
            <button key={nav.id} onClick={()=>selectTab(nav.id)} className={`nav-item ${tab===nav.id?'active':''}`}>
              <span>{nav.icon}</span>
              <span style={{fontSize:13}}>{t(nav.labelKey)}</span>
              {nav.id==='pedidos'&&pedidosPendentes>0&&(
                <span style={{marginLeft:'auto',background:'var(--gold)',color:'var(--navy)',fontSize:10,fontWeight:800,padding:'1px 6px',borderRadius:10}}>{pedidosPendentes}</span>
              )}
              {nav.id==='billingHub'&&(overdueAlerts?.faturas?.length ?? 0)>0&&(
                <span style={{marginLeft:'auto',background:'var(--red)',color:'white',fontSize:10,fontWeight:800,padding:'1px 6px',borderRadius:10}}>{overdueAlerts.faturas.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
            <div style={{width:34,height:34,borderRadius:10,background:'rgba(193,156,86,0.2)',border:'1px solid rgba(193,156,86,0.3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,color:'var(--gold)',flexShrink:0}}>
              {(perfil?.nome||user?.email||'U')[0].toUpperCase()}
            </div>
            <div style={{minWidth:0}}>
              <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.85)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{perfil?.nome||user?.email}</div>
              <div style={{fontSize:10,color:'rgba(193,156,86,0.7)'}}>{roleLabel(perfil?.role)}</div>
            </div>
          </div>
          <button onClick={signOut} className="sidebar-signout">{t('common.signOut')}</button>
        </div>
      </aside>

      <main className="app-main app-main-wide">
        <WorkspaceChrome>
          <UiPrefsPanel compact />
          <NotificationBell notifs={notifs} unread={unread} markRead={markRead} markAllRead={markAllRead} deleteNotif={deleteNotif} deleteAll={deleteAll} onNavigate={selectTab} overdueAlerts={overdueAlerts} placement="header"/>
        </WorkspaceChrome>
        <div className="fade-in" key={tab}>
          {tab==='dashboard' && <Dashboard onNav={selectTab}/>}
          {tab==='billingHub' && <ReportsBilling onNav={selectTab}/>}
          {tab==='purchases'   && <ComprasTab/>}
          {tab==='sales'    && <VendasTab/>}
          {tab==='pedidos'   && <PedidosAdminTab/>}
          {tab==='relatorio' && <RelatorioTab/>}
          {tab==='ryoshusho' && <RyoshushoTab/>}
          {tab==='seikyusho' && <SeikyushoTab/>}
          {tab==='products'  && <ProductsTab/>}
          {tab==='bars'      && <BarsTab/>}
          {tab==='usuarios'  && <UsuariosTab/>}
          {tab==='faturas'   && <Faturas />}
          {tab==='cashflow'   && <Cashflow />}
          {tab==='suppliers' && <Fornecedores />}
        </div>
      </main>
    </div>
  )
}

function AppInner() {
  return (
    <UiPrefsProvider>
      <I18nProvider>
        <AuthProvider><Shell/></AuthProvider>
      </I18nProvider>
    </UiPrefsProvider>
  )
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}
