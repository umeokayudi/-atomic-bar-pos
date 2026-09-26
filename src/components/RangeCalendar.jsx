import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { tokyoDateKey, tokyoMonthKey } from '../lib/tokyo'
import { monthBounds, shiftMonth } from '../lib/barCalendar'

function addDays(key, days) {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export default function RangeCalendar({ from = '', to = '', onChange }) {
  const { t, monthLabel } = useI18n()
  const today = tokyoDateKey()
  const thisMonth = tokyoMonthKey()
  const prev = shiftMonth(thisMonth, -1)
  const [ym, setYm] = useState((from || thisMonth).slice(0, 7))
  const [anchor, setAnchor] = useState('')

  useEffect(() => {
    if (from) setYm(from.slice(0, 7))
  }, [from])

  const [year, mo] = ym.split('-').map(Number)
  const firstDay = new Date(year, mo - 1, 1).getDay()
  const daysInMonth = new Date(year, mo, 0).getDate()
  const monthStart = monthBounds(thisMonth)
  const prevStart = monthBounds(prev)
  const ninetyFrom = addDays(today, -90)

  function pick(dayKey) {
    if (!anchor || (from && to && from !== to && anchor === '')) {
      setAnchor(dayKey)
      onChange?.(dayKey, dayKey)
      return
    }
    const start = anchor
    const a = start < dayKey ? start : dayKey
    const b = start < dayKey ? dayKey : start
    setAnchor('')
    onChange?.(a, b)
  }

  function preset(id) {
    setAnchor('')
    if (id === 'all') { onChange?.('', ''); return }
    if (id === 'month') { setYm(thisMonth); onChange?.(monthStart.from, monthStart.to); return }
    if (id === 'prev') { setYm(prev); onChange?.(prevStart.from, prevStart.to); return }
    setYm(today.slice(0, 7))
    onChange?.(ninetyFrom, today)
  }

  const chips = [
    ['all', t('portal.home.rangeAll'), !from && !to],
    ['month', t('portal.home.rangeMonth'), from === monthStart.from && to === monthStart.to],
    ['prev', t('portal.home.rangePrev'), from === prevStart.from && to === prevStart.to],
    ['90', t('portal.home.range90'), from === ninetyFrom && to === today],
  ]

  const lo = from && to ? (from < to ? from : to) : from
  const hi = from && to ? (from < to ? to : from) : to

  return (
    <div className="range-cal">
      <div className="date-filter">
        {chips.map(([id, label, on]) => (
          <button key={id} type="button" className={`date-filter-chip${on ? ' is-on' : ''}`} onClick={() => preset(id)}>{label}</button>
        ))}
        {(from || to) && (
          <button type="button" className="date-filter-chip" onClick={() => preset('all')}>{t('portal.invoices.clear')}</button>
        )}
      </div>
      <div className="range-cal-card">
        <div className="range-cal-nav">
          <button type="button" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="Previous month">←</button>
          <strong>{monthLabel(ym)}</strong>
          <button type="button" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="Next month">→</button>
        </div>
        <div className="range-cal-head">
          {(Array.isArray(t('dashboard.calDays')) ? t('dashboard.calDays') : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map(d => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="range-cal-grid">
          {Array.from({ length: firstDay }).map((_, i) => <span key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const key = `${ym}-${String(i + 1).padStart(2, '0')}`
            const inRange = lo && hi && key >= lo && key <= hi
            const edge = key === lo || key === hi
            return (
              <button
                key={key}
                type="button"
                className={`range-cal-day${inRange ? ' is-in' : ''}${edge ? ' is-edge' : ''}${key === today ? ' is-today' : ''}`}
                onClick={() => pick(key)}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
        <p className="range-cal-range">
          {from && to ? `${from} → ${to}` : t('portal.home.rangeAll')}
        </p>
      </div>
    </div>
  )
}
