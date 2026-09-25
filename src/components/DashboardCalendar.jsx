import { useMemo, useState } from 'react'
import { fmtYen, fmtDate } from './utils'
import { useI18n } from '../lib/i18n'
import { PortalSurface } from './ui/PageLayout'

const KINDS = ['pedido', 'pagamento', 'lucro', 'entrega']

function kindColor(kind, dir, amount) {
  if (kind === 'pedido') return '#2563eb'
  if (kind === 'entrega') return '#7c3aed'
  if (kind === 'lucro') return amount >= 0 ? '#1a6b4a' : '#dc2626'
  if (kind === 'pagamento') return dir === 'out' ? '#b45309' : '#16a34a'
  return 'var(--navy)'
}

export default function DashboardCalendar({ events = [], onNav, month, onMonthChange, onPay, title, sub }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState('all')
  const [openDay, setOpenDay] = useState(null)

  const now = new Date()
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthStr = /^\d{4}-\d{2}$/.test(month || '') ? month : fallback
  const [year, mo] = monthStr.split('-').map(Number)
  const firstDay = new Date(year, mo - 1, 1).getDay()
  const daysInMonth = new Date(year, mo, 0).getDate()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const isThisMonth = todayStr.startsWith(monthStr)

  function goMonth(next) {
    if (!/^\d{4}-\d{2}$/.test(next)) return
    setOpenDay(null)
    onMonthChange?.(next)
  }

  function shift(delta) {
    const d = new Date(year, mo - 1 + delta, 1)
    goMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const filtered = useMemo(() => {
    const list = Array.isArray(events) ? events : []
    if (filter === 'all') return list
    return list.filter(e => e.kind === filter)
  }, [events, filter])

  const byDay = useMemo(() => {
    const map = {}
    for (const ev of filtered) {
      if (!ev.date?.startsWith(monthStr)) continue
      const day = +ev.date.slice(8, 10)
      if (!map[day]) map[day] = []
      map[day].push(ev)
    }
    return map
  }, [filtered, monthStr])

  const counts = useMemo(() => {
    const out = { all: 0, pedido: 0, pagamento: 0, lucro: 0, entrega: 0 }
    for (const ev of events || []) {
      if (!ev.date?.startsWith(monthStr)) continue
      out.all += 1
      if (out[ev.kind] != null) out[ev.kind] += 1
    }
    return out
  }, [events, monthStr])

  const dayNames = t('dashboard.calDays')
  const labels = {
    pedido: t('dashboard.calOrders'),
    pagamento: t('dashboard.calPayments'),
    lucro: t('dashboard.calProfit'),
    entrega: t('dashboard.calDeliveries'),
  }

  const openEvents = openDay ? (byDay[openDay] || []) : []

  return (
    <PortalSurface
      title={title || t('dashboard.calTitle')}
      sub={sub || t('dashboard.calSub')}
      style={{ marginTop: 20 }}
      headerRight={(
        <div className="dash-cal-nav">
          <button type="button" className="dash-cal-nav-btn" onClick={() => shift(-1)} aria-label="Previous month">←</button>
          <input
            type="month"
            className="dash-cal-month-input"
            value={monthStr}
            onChange={e => goMonth(e.target.value)}
          />
          <button type="button" className="dash-cal-nav-btn" onClick={() => shift(1)} aria-label="Next month">→</button>
        </div>
      )}
    >
      <div className="dash-cal-filters">
        {[['all', t('common.all')], ...KINDS.map(k => [k, labels[k]])].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`dash-cal-filter${filter === id ? ' is-on' : ''}`}
            onClick={() => { setFilter(id); setOpenDay(null) }}
          >
            {id !== 'all' && <span className={`dash-cal-dot ${id}`} />}
            {label}
            <em>{counts[id] || 0}</em>
          </button>
        ))}
      </div>

      <div className="dash-cal">
        <div className="dash-cal-head">
          {(Array.isArray(dayNames) ? dayNames : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map(d => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="dash-cal-grid">
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`e${i}`} className="dash-cal-cell is-empty" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const list = byDay[day] || []
            const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
            const isToday = isThisMonth && dateStr === todayStr
            const kinds = [...new Set(list.map(e => e.kind))]
            return (
              <button
                key={day}
                type="button"
                className={`dash-cal-cell${isToday ? ' is-today' : ''}${openDay === day ? ' is-open' : ''}${list.length ? ' has-ev' : ''}`}
                onClick={() => setOpenDay(list.length ? (openDay === day ? null : day) : null)}
              >
                <span className="dash-cal-num">{day}</span>
                {kinds.length > 0 && (
                  <span className="dash-cal-dots">
                    {kinds.slice(0, 4).map(k => <span key={k} className={`dash-cal-dot ${k}`} />)}
                    {list.length > 4 && <span className="dash-cal-more">+{list.length - 4}</span>}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {openDay && (
        <div className="dash-cal-pop">
          <div className="dash-cal-pop-head">
            <strong>{fmtDate(`${monthStr}-${String(openDay).padStart(2, '0')}`)}</strong>
            <button type="button" onClick={() => setOpenDay(null)}>{t('common.close')}</button>
          </div>
          {openEvents.length === 0 ? (
            <div className="dash-cal-empty">{t('dashboard.calEmpty')}</div>
          ) : openEvents.map(ev => (
            <button
              key={`${ev.kind}-${ev.id}-${ev.date}`}
              type="button"
              className="dash-cal-row"
              onClick={() => {
                if (ev.payType && onPay) {
                  onPay({
                    type: ev.payType,
                    id: ev.payId || ev.id,
                    label: ev.label,
                    amount: ev.amount,
                    dueDate: ev.date,
                    paid: ev.status === 'pago',
                  })
                  return
                }
                onNav?.(ev.tab)
              }}
            >
              <span className="dash-cal-row-kind" style={{ color: kindColor(ev.kind, ev.dir, ev.amount) }}>
                {labels[ev.kind] || ev.kind}
                {ev.dir === 'out' ? ' ↓' : ev.kind === 'pagamento' ? ' ↑' : ''}
              </span>
              <span className="dash-cal-row-label">{ev.label}{ev.status ? ` · ${ev.status}` : ''}</span>
              <span className="dash-cal-row-amt" style={{ color: kindColor(ev.kind, ev.dir, ev.amount) }}>
                {ev.kind === 'pagamento' && ev.dir === 'out' ? '−' : ev.kind === 'lucro' && ev.amount < 0 ? '' : ev.kind !== 'lucro' && ev.kind !== 'pagamento' ? '' : ev.amount >= 0 && ev.kind === 'lucro' ? '+' : ''}
                {fmtYen(ev.amount)}
              </span>
            </button>
          ))}
        </div>
      )}
    </PortalSurface>
  )
}
