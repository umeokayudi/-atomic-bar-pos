import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../Auth'
import { listMyOrders } from '../../lib/staffOrders'
import { spanLabel } from '../../lib/staffSchedule'
import { tokyoNightKey } from '../../lib/tokyo'
import { STAFF_NOTIF_TYPES, isStaffNotif } from '../../lib/staffApp'
import Icon from '../ui/Icon'
import { fmtDay, fmtTime } from './staffUi'
import { rangeLabel } from './ScheduleScreen'

const POLL_MS = 60000
const SEEN_KEY = 'sa_bell_seen'

function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() }
}
function writeSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-200))) } catch { /* storage blocked */ }
}

function ago(t, iso) {
  const when = Date.parse(iso || '')
  if (!when) return ''
  const m = Math.floor((Date.now() - when) / 60000)
  if (m < 1) return t('common.justNow')
  if (m < 60) return t('common.minsAgo', { count: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('common.hoursAgo', { count: h })
  return fmtDay(iso, { month: 'short', day: 'numeric' })
}

/** My bell: own staff notifications, open orders for me, and the schedule to send. Read-only except "mark read". */
function useStaffInbox({ t, schedule }) {
  const { user } = useAuth()
  const uid = user?.id
  const [notifs, setNotifs] = useState([])
  const [orders, setOrders] = useState([])
  const [seen, setSeen] = useState(readSeen)

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const { data } = await supabase.from('notificacoes').select('*').eq('user_id', uid).like('tipo', 'staff%').order('criado_em', { ascending: false }).limit(20)
      setNotifs((data || []).filter(isStaffNotif))
    } catch { /* the bell never blocks the app */ }
    try {
      const { orders: list } = await listMyOrders(supabase, uid)
      setOrders(list || [])
    } catch { /* idem */ }
  }, [uid])

  useEffect(() => {
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const items = useMemo(() => {
    const out = []
    const data = schedule?.data
    const status = data?.status
    const today = tokyoNightKey()
    if (status?.week && !status.submitted) {
      const range = rangeLabel(status.week.from, status.week.to)
      const when = `${fmtDay(status.deadline, { weekday: 'short' })} ${fmtTime(status.deadline)}`
      out.push({
        key: `sched:${status.week.from}`, icon: 'calendar', tone: status.overdue ? 'bad' : 'warn', tab: 'schedule', pinned: true,
        title: t('bell.schedTitle', { range }),
        body: status.overdue ? t('schedule.ctaLate', { when }) : t('schedule.ctaDeadline', { when, left: spanLabel(status.msLeft) }),
      })
    }
    const tonight = data?.confirmed?.[today]
    if (tonight?.in) {
      out.push({ key: `tonight:${today}`, icon: 'ok', tone: 'ok', tab: 'ponto', title: t('bell.tonightTitle'), body: `${tonight.start || ''}${tonight.end ? `–${tonight.end}` : ''}` })
    }
    for (const o of orders) {
      out.push({
        key: `order:${o.id}`, icon: o.prioridade === 'urgent' ? 'ordens' : 'alert', tone: o.prioridade === 'urgent' ? 'bad' : 'info', tab: null,
        title: `${o.prioridade === 'urgent' ? t('orders.urgentKicker') : t('orders.alertTitle')}${o.from_nome ? ` · ${o.from_nome}` : ''}`,
        body: o.mensagem, time: o.criado_em,
      })
    }
    for (const n of notifs) {
      const kind = STAFF_NOTIF_TYPES[n.tipo]
      out.push({ key: `n:${n.id}`, id: n.id, icon: kind.icon, tone: kind.tone, tab: kind.tab, title: n.titulo, body: n.mensagem, time: n.criado_em, unread: !n.lida })
    }
    return out.map(it => (it.id ? it : { ...it, unread: !seen.has(it.key) }))
  }, [schedule?.data, orders, notifs, seen, t])

  const unread = items.filter(it => it.unread).length

  async function markAllSeen() {
    const next = new Set(seen)
    items.forEach(it => { if (!it.id) next.add(it.key) })
    setSeen(next)
    writeSeen(next)
    const ids = notifs.filter(n => !n.lida).map(n => n.id)
    if (!ids.length) return
    setNotifs(prev => prev.map(n => ({ ...n, lida: true })))
    try { await supabase.from('notificacoes').update({ lida: true }).in('id', ids) } catch { /* next poll retries */ }
  }

  return { items, unread, markAllSeen, reload: load }
}

/** Bell with an unread badge in the staff header; opens a panel under the header (sheet-like on phones). */
export default function StaffBell({ t, schedule, onNavigate }) {
  const inbox = useStaffInbox({ t, schedule })
  const [open, setOpen] = useState(false)
  const { markAllSeen } = inbox

  useEffect(() => {
    if (!open) return undefined
    markAllSeen()
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = tab => { setOpen(false); if (tab) onNavigate(tab) }
  const badge = inbox.unread

  const panel = open && createPortal(
    <div className="sa-bell-layer" role="presentation" onClick={e => { if (e.target === e.currentTarget || e.target.classList.contains('sa-bell-col')) setOpen(false) }}>
      <div className="sa-bell-col">
        <section className="sa-bell-panel" role="dialog" aria-modal="false" aria-label={t('notifications.title')}>
          <header className="sa-bell-head">
            <strong>{t('notifications.title')}</strong>
            <button type="button" className="sa-icon-btn" onClick={() => setOpen(false)} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
          </header>
          <div className="sa-bell-list">
            {inbox.items.length === 0 ? (
              <div className="sa-bell-empty">
                <Icon name="bell" size={26} />
                <strong>{t('bell.emptyTitle')}</strong>
                <span>{t('bell.emptyHint')}</span>
              </div>
            ) : inbox.items.map(it => {
              const Tag = it.tab ? 'button' : 'div'
              return (
                <Tag key={it.key} {...(it.tab ? { type: 'button', onClick: () => go(it.tab) } : {})} className={`sa-bell-item is-${it.tone}${it.unread ? ' is-unread' : ''}${it.pinned ? ' is-pinned' : ''}`}>
                  <span className="sa-bell-icon"><Icon name={it.icon} size={18} /></span>
                  <span className="sa-bell-text">
                    <strong>{it.title}</strong>
                    {it.body && <span>{it.body}</span>}
                    {it.time && <small>{ago(t, it.time)}</small>}
                  </span>
                  {it.tab ? <Icon name="next" size={16} /> : it.unread ? <i className="sa-bell-dot" aria-hidden="true" /> : null}
                </Tag>
              )
            })}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  )

  return (
    <>
      <button
        type="button"
        className={`sa-bell${open ? ' is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={badge ? t('notifications.badgeCount', { count: badge }) : t('notifications.title')}
      >
        <Icon name="bell" size={21} />
        {badge > 0 && <span className="sa-bell-badge">{badge > 9 ? '9+' : badge}</span>}
      </button>
      {panel}
    </>
  )
}
