import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { fmtYen, fmtDate } from './utils'
import { splitPendingCompras, splitPendingFaturas } from '../lib/compraPagamentos'
import { filterJbmDrinksFaturas, faturaRemaining } from '../lib/barPortal'
import { billChecks } from '../lib/billMatch'
import { filterSupplierVendas } from './utils'
import { useI18n } from '../lib/i18n'
import { asReactText } from '../lib/errText'
import { panelBoxStyle, placeNotifPanel } from '../lib/notifPanel'

export function useNotifications() {
  const { user } = useAuth()
  const [notifs, setNotifs] = useState([])

  const load = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('notificacoes')
      .select('*')
      .eq('user_id', user.id)
      .order('criado_em', { ascending: false })
      .limit(20)
    setNotifs(data || [])
  }, [user])

  useEffect(() => {
    load()
    const interval = setInterval(() => { if (!document.hidden) load() }, 30000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  async function markRead(id) {
    await supabase.from('notificacoes').update({ lida: true }).eq('id', id)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n))
  }

  async function markAllRead() {
    if (!user) return
    await supabase.from('notificacoes').update({ lida: true }).eq('user_id', user.id)
    setNotifs(prev => prev.map(n => ({ ...n, lida: true })))
  }

  async function deleteNotif(id) {
    await supabase.from('notificacoes').delete().eq('id', id)
    setNotifs(prev => prev.filter(n => n.id !== id))
  }

  async function deleteAll() {
    const ids = notifs.filter(n => n.lida).map(n => n.id)
    if (!ids.length) return
    await supabase.from('notificacoes').delete().in('id', ids)
    setNotifs(prev => prev.filter(n => !n.lida))
  }

  const unread = notifs.filter(n => !n.lida).length
  return { notifs, unread, markRead, markAllRead, deleteNotif, deleteAll, reload: load }
}

/** JBM admin: overdue invoices/purchases across bars. */
export function useOverdueAlerts() {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState(null)

  const load = useCallback(async () => {
    if (!user) return
    const today = new Date().toISOString().slice(0, 10)
    const [fR, cR, foR] = await Promise.all([
      supabase.from('faturas').select('*, bars(nome)').order('data_vencimento'),
      supabase.from('compras').select('*').order('data'),
      supabase.from('fornecedores').select('nome,pagamento'),
    ])
    const faturaSplit = splitPendingFaturas(fR.data || [], today)
    const compraSplit = splitPendingCompras(cR.data || [], foR.data || [])
    setAlerts({
      faturas: faturaSplit.overdue.map(f => ({
        id: f.id,
        label: f.bars?.nome || 'Bar',
        amount: f.amount,
        date: f.dueDate,
        tab: 'faturas',
      })),
      compras: compraSplit.overdue.map(c => ({
        id: c.id,
        label: c.fornecedor || 'Fornecedor',
        amount: c.amount,
        date: c.dueDate,
        tab: 'cashflow',
      })),
      faturasTotal: faturaSplit.overdueTotal,
      comprasTotal: compraSplit.overdueTotal,
    })
  }, [user])

  useEffect(() => {
    load()
    const interval = setInterval(() => { if (!document.hidden) load() }, 60000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  return alerts
}

/** Bar portal: this bar’s JBM drinks invoices only — never compras of the supplier. */
export function useBarOverdueAlerts(barId) {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState(null)

  const load = useCallback(async () => {
    if (!user || !barId) return
    const today = new Date().toISOString().slice(0, 10)
    const [fR, pR, vR] = await Promise.all([
      supabase.from('faturas').select('*').eq('bar_id', barId).order('data_vencimento'),
      supabase.from('pedidos').select('id,status,total_estimado,data_pedido,criado_em,pedidos_itens(qtd,preco_unitario)').eq('bar_id', barId).order('criado_em', { ascending: false }).limit(200),
      supabase.from('vendas').select('total,data,data_venda,obs').eq('bar_id', barId).order('data', { ascending: false }).limit(200),
    ])
    if (fR.error) {
      setAlerts({ faturas: [], compras: [], faturasTotal: 0, comprasTotal: 0, mismatches: [] })
      return
    }
    const drinks = filterJbmDrinksFaturas(fR.data || [])
    const overdue = drinks.filter(f => {
      if (f.status === 'pago') return false
      const venc = f.data_vencimento || f.periodo_fim
      return venc && venc < today && faturaRemaining(f) > 0
    })
    const mismatches = billChecks({
      orders: pR.data || [],
      notes: filterSupplierVendas(vR.data || []),
      invoices: drinks,
    }).rows.filter(r => r.status === 'off' || r.status === 'paid-gap').map(r => ({
      id: r.invoiceId || `${r.start}-${r.end}`,
      start: r.start,
      end: r.end,
      delta: Math.abs(r.delta || 0),
      orders: r.orders,
      invoice: r.invoice,
      gapPaid: r.gapPaid || 0,
      paidGap: r.status === 'paid-gap',
      tab: 'faturas',
    }))
    setAlerts({
      faturas: overdue.map(f => ({
        id: f.id,
        label: f.obs || f.notas || 'JBM',
        amount: faturaRemaining(f),
        date: f.data_vencimento || f.periodo_fim,
        tab: 'faturas',
      })),
      compras: [],
      faturasTotal: overdue.reduce((a, f) => a + faturaRemaining(f), 0),
      comprasTotal: 0,
      mismatches,
    })
  }, [user, barId])

  useEffect(() => {
    load()
    const interval = setInterval(() => { if (!document.hidden) load() }, 60000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  return alerts
}

const TIPO_ICON = {
  pedido_novo:       { icon: '🛒', color: '#8A5A00', bg: '#FDF3E0' },
  pedido_confirmado: { icon: '✅', color: '#1A4E8A', bg: '#EAF0FA' },
  pedido_entregue:   { icon: '📦', color: '#1A7A5E', bg: '#EAF5F0' },
  pedido_cancelado:  { icon: '❌', color: '#C0392B', bg: '#FBEAEA' },
}

function timeAgo(iso, t) {
  const when = new Date(iso).getTime()
  if (!iso || Number.isNaN(when)) return ''
  const diff = Date.now() - when
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return t('common.daysAgo', { count: d })
  if (h > 0) return t('common.hoursAgo', { count: h })
  if (m > 0) return t('common.minsAgo', { count: m })
  return t('common.justNow')
}

function notifTab(link) {
  const s = String(link || '')
  if (!s) return 'pedidos'
  if (s.startsWith('http')) return null
  return s.replace(/^\//, '').split(/[?#]/)[0] || 'pedidos'
}

export function NotificationBell({
  notifs,
  unread,
  markRead,
  markAllRead,
  deleteNotif,
  deleteAll,
  onNavigate,
  overdueAlerts,
  placement = 'sidebar',
}) {
  const { t } = useI18n()
  const list = Array.isArray(notifs) ? notifs : []
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const [panelStyle, setPanelStyle] = useState(null)

  const mismatches = overdueAlerts?.mismatches || []
  const overdueCount = (overdueAlerts?.faturas?.length || 0) + (overdueAlerts?.compras?.length || 0)
  const badgeCount = unread + overdueCount + mismatches.length

  const place = useCallback(() => {
    if (!open || !btnRef.current) {
      setPanelStyle(null)
      return
    }
    const rect = btnRef.current.getBoundingClientRect()
    const vv = window.visualViewport
    setPanelStyle(panelBoxStyle(placeNotifPanel({
      rect,
      placement,
      vw: vv?.width || window.innerWidth,
      vh: vv?.height || window.innerHeight,
    })))
  }, [open, placement])

  useLayoutEffect(() => {
    place()
  }, [place, list.length, overdueCount, mismatches.length])

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    const onDoc = e => {
      if (btnRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      document.removeEventListener('mousedown', onDoc)
    }
  }, [open, place])

  function go(tab) {
    setOpen(false)
    if (tab) onNavigate?.(tab)
  }

  const panel = open && panelStyle && createPortal(
    <div
      ref={panelRef}
      className="notif-panel"
      style={panelStyle}
      role="dialog"
      aria-modal="false"
      aria-label={t('notifications.title')}
    >
        <div className="notif-panel-header">
          <span className="notif-panel-title">{t('notifications.title')}</span>
          <div className="notif-panel-actions">
            {list.some(n => n.lida) && deleteAll && (
              <button type="button" className="notif-panel-link" onClick={deleteAll}>{t('notifications.clearRead')}</button>
            )}
            {unread > 0 && (
              <button type="button" className="notif-panel-link notif-panel-link-primary" onClick={markAllRead}>
                {t('notifications.markRead')}
              </button>
            )}
            <button type="button" className="notif-panel-link" onClick={() => setOpen(false)}>{t('notifications.close')}</button>
          </div>
        </div>

        <div className="notif-panel-body">
          {mismatches.length > 0 && (
            <div className="notif-overdue-block">
              <div className="notif-overdue-title">{mismatches.every(m => m.paidGap) ? t('notifications.paidGapTitle') : t('notifications.mismatchTitle')}</div>
              {mismatches.map(m => (
                <button
                  key={`m-${m.id}`}
                  type="button"
                  className="notif-overdue-row"
                  onClick={() => go(m.tab || 'faturas')}
                >
                  <span className="notif-overdue-kind">{t('notifications.invoiceKind')}</span>
                  <span className="notif-overdue-label">{t(m.paidGap ? 'notifications.paidGapBody' : 'notifications.mismatchBody', {
                    from: m.start || '—',
                    to: m.end || '—',
                    orders: fmtYen(m.orders || 0),
                    invoice: fmtYen(m.invoice || 0),
                    amount: fmtYen(m.gapPaid || m.delta),
                  })}</span>
                  <span className="notif-overdue-amount">{fmtYen(m.invoice)}</span>
                </button>
              ))}
            </div>
          )}
          {overdueCount > 0 && (
            <div className="notif-overdue-block">
              <div className="notif-overdue-title">{t('notifications.overdueAlert')}</div>
              {overdueAlerts.faturas?.map(f => (
                <button
                  key={`f-${f.id}`}
                  type="button"
                  className="notif-overdue-row"
                  onClick={() => go(f.tab || 'faturas')}
                >
                  <span className="notif-overdue-kind">{t('notifications.invoiceKind')}</span>
                  <span className="notif-overdue-label">{asReactText(f.label)}</span>
                  <span className="notif-overdue-amount">{fmtYen(f.amount)}</span>
                  <span className="notif-overdue-date">{t('notifications.expiredOn', { date: fmtDate(f.date) })}</span>
                </button>
              ))}
              {overdueAlerts.compras?.map(c => (
                <button
                  key={`c-${c.id}`}
                  type="button"
                  className="notif-overdue-row"
                  onClick={() => go(c.tab || 'cashflow')}
                >
                  <span className="notif-overdue-kind">{t('notifications.purchaseKind')}</span>
                  <span className="notif-overdue-label">{asReactText(c.label)}</span>
                  <span className="notif-overdue-amount">{fmtYen(c.amount)}</span>
                  <span className="notif-overdue-date">{t('notifications.expiredOn', { date: fmtDate(c.date) })}</span>
                </button>
              ))}
            </div>
          )}

          {list.length === 0 && overdueCount === 0 && mismatches.length === 0 ? (
            <div className="notif-empty">{t('notifications.none')}</div>
          ) : list.map(n => {
            const tipo = TIPO_ICON[n.tipo] || { icon: '🔔', color: 'var(--text2)', bg: 'var(--bg3)' }
            const tab = notifTab(n.link)
            return (
              <div
                key={n.id}
                className={`notif-row${n.lida ? '' : ' is-unread'}`}
              >
                <button
                  type="button"
                  className="notif-row-hit"
                  onClick={() => { markRead(n.id); go(tab) }}
                >
                  <span className="notif-row-icon" style={{ background: tipo.bg }}>{tipo.icon}</span>
                  <span className="notif-row-content">
                    <span className="notif-row-title">{asReactText(n.titulo)}</span>
                    {n.mensagem && <span className="notif-row-msg">{asReactText(n.mensagem)}</span>}
                    <span className="notif-row-time">{timeAgo(n.criado_em, t)}</span>
                  </span>
                  {!n.lida && <span className="notif-unread-dot" aria-hidden />}
                </button>
                {deleteNotif && (
                  <button
                    type="button"
                    className="notif-row-x"
                    aria-label={t('notifications.delete')}
                    onClick={e => { e.stopPropagation(); deleteNotif(n.id) }}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
    </div>,
    document.body
  )

  return (
    <div className="notif-bell-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`notif-bell-btn${open ? ' is-on' : ''}`}
        onClick={() => setOpen(open => !open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={badgeCount > 0 ? t('notifications.badgeCount', { count: badgeCount }) : t('notifications.title')}
      >
        🔔
        {badgeCount > 0 && (
          <span className="notif-badge">{badgeCount > 9 ? '9+' : badgeCount}</span>
        )}
      </button>
      {panel}
    </div>
  )
}
