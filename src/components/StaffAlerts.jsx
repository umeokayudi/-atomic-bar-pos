import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { listMyOrders, setOrderStatus } from '../lib/staffOrders'
import { tokyoClock } from '../lib/staffDayReport'
import Icon from './ui/Icon'

const POLL_MS = 20000

/**
 * Orders from the owner/manager, on top of every staff screen until the person answers.
 * "Got it" tells the manager it was seen; "Done" closes it. Urgent ones vibrate the phone once.
 */
export default function StaffAlerts() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [orders, setOrders] = useState([])
  const [busy, setBusy] = useState(null)
  const seen = useRef(new Set())

  const load = useCallback(async () => {
    if (!user?.id) return
    try {
      const { orders: list } = await listMyOrders(supabase, user.id)
      const fresh = list.filter(o => !seen.current.has(o.id))
      if (fresh.some(o => o.prioridade === 'urgent') && seen.current.size) navigator.vibrate?.([180, 80, 180])
      list.forEach(o => seen.current.add(o.id))
      setOrders(list)
    } catch { /* the alert bar never blocks the screen */ }
  }, [user?.id])

  useEffect(() => {
    load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    let channel = null
    if (user?.id) {
      try {
        channel = supabase.channel(`staff-orders-${user.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_orders', filter: `staff_id=eq.${user.id}` }, load)
          .subscribe()
      } catch { channel = null }
    }
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
      if (channel) supabase.removeChannel(channel)
    }
  }, [load, user?.id])

  async function answer(order, status) {
    setBusy(order.id)
    try {
      await setOrderStatus(supabase, order, status)
      setOrders(cur => (status === 'done' || order.notifId ? cur.filter(o => o.id !== order.id) : cur.map(o => (o.id === order.id ? { ...o, status } : o))))
    } catch { load() } finally { setBusy(null) }
  }

  if (!orders.length) return null

  return (
    <section className="salert" aria-label={t('orders.alertTitle')} aria-live="assertive">
      {orders.map(o => (
        <article key={o.id} className={`salert-item${o.prioridade === 'urgent' ? ' is-urgent' : ''}${o.status === 'seen' ? ' is-seen' : ''}`} role="alert">
          <span className="salert-icon" aria-hidden="true"><Icon name={o.prioridade === 'urgent' ? 'ordens' : 'alert'} size={20} /></span>
          <div className="salert-body">
            <div className="salert-kicker">
              {o.prioridade === 'urgent' ? t('orders.urgentKicker') : t('orders.alertTitle')}
              {o.from_nome ? ` · ${o.from_nome}` : ''}
              {o.criado_em ? ` · ${tokyoClock(o.criado_em)}` : ''}
            </div>
            <p>{o.mensagem}</p>
            {o.due_at && <small>{t('orders.dueBy', { time: tokyoClock(o.due_at) })}</small>}
          </div>
          <div className="salert-actions">
            {o.status === 'sent' && !o.notifId && (
              <button type="button" className="ui-btn is-sm" disabled={busy === o.id} onClick={() => answer(o, 'seen')}><Icon name="eye" size={14} /> {t('orders.gotIt')}</button>
            )}
            <button type="button" className="ui-btn is-sm is-primary" disabled={busy === o.id} onClick={() => answer(o, 'done')}><Icon name="check" size={14} /> {t('orders.done')}</button>
          </div>
        </article>
      ))}
    </section>
  )
}
