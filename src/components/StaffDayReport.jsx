import { useEffect, useMemo, useState } from 'react'
import { staffFetch } from '../lib/apiAuth'
import { nightWindow, nextTokyoDateKey, prevTokyoDateKey } from '../lib/nightClose'
import { staffDayCsv, staffDayReport } from '../lib/staffDayReport'
import { tokyoNightKey } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'
import { fmtYen } from './utils'
import Icon from './ui/Icon'

const STATUS_ICON = { working: 'clock', done: 'ok', absent: 'userOff', off: 'hide' }

function hoursLabel(h) {
  const total = Math.round((+h || 0) * 60)
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
}

/**
 * Daily work report: one card per employee for one night. Clock in/out from the time clock,
 * late/absent from the night sheet, sales and commission from till tickets tagged with their name.
 * Read-only. Download as CSV or print.
 */
export default function StaffDayReport({ staff = [], tickets = [], sheets = [], punches = [], nightPremium = true, onlyId }) {
  const { t } = useI18n()
  const today = tokyoNightKey()
  const [night, setNight] = useState(today)
  const [nightPunches, setNightPunches] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let live = true
    setNightPunches(null)
    const win = nightWindow(night)
    staffFetch(`/api/time-clock?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`)
      .then(r => r.json())
      .then(j => { if (live) setNightPunches(Array.isArray(j?.punches) ? j.punches : null) })
      .catch(() => { if (live) setNightPunches(null) })
    return () => { live = false }
  }, [night])

  const report = useMemo(() => {
    const sheet = (sheets || []).find(s => s.night_key === night) || null
    const r = staffDayReport({ night, punches: nightPunches || punches, staff, tickets, sheet, nightPremium })
    if (onlyId) r.rows = r.rows.filter(row => row.id === onlyId)
    return r
  }, [night, nightPunches, punches, staff, tickets, sheets, nightPremium, onlyId])

  function download() {
    const csv = staffDayCsv(report)
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `daily-report-${report.night}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function print() {
    document.body.classList.add('print-sdr')
    const done = () => { document.body.classList.remove('print-sdr'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
    setTimeout(done, 1500)
  }

  const tot = report.totals
  const withSales = (tickets || []).length > 0
  const shown = report.rows.filter(r => onlyId || r.status !== 'off')
  const off = onlyId ? [] : report.rows.filter(r => r.status === 'off')

  return (
    <section className="desk-card sdr" aria-label={t('staffDay.title')}>
      <div className="sdr-head">
        <div>
          <h3><Icon name="tasks" size={17} /> {t(onlyId ? 'staffDay.mine' : 'staffDay.title')}</h3>
          <p className="desk-note">{t('staffDay.lead')}</p>
        </div>
        <div className="sdr-tools">
          <div className="sdr-night" role="group" aria-label={t('staffDay.night')}>
            <button type="button" className="ui-btn is-ghost is-icon is-sm" onClick={() => setNight(prevTokyoDateKey(night))} aria-label={t('staffDay.prev')}><Icon name="back" size={16} /></button>
            <input type="date" value={night} max={today} onChange={e => e.target.value && setNight(e.target.value)} aria-label={t('staffDay.night')} />
            <button type="button" className="ui-btn is-ghost is-icon is-sm" disabled={night >= today} onClick={() => setNight(nextTokyoDateKey(night))} aria-label={t('staffDay.next')}><Icon name="next" size={16} /></button>
          </div>
          {!onlyId && <button type="button" className="ui-btn is-sm" onClick={download}><Icon name="download" size={15} /> CSV</button>}
          <button type="button" className="ui-btn is-sm" onClick={print}><Icon name="print" size={15} /> {t('staffDay.print')}</button>
        </div>
      </div>

      {!onlyId && (
        <div className="sdr-sum">
          <div><b>{tot.people}</b><span>{t('staffDay.worked')}</span></div>
          <div><b>{hoursLabel(tot.hours)}</b><span>{t('staffDay.hours')}</span></div>
          <div><b>{fmtYen(tot.pay)}</b><span>{t('staffDay.pay')}</span></div>
          {withSales && <div><b>{fmtYen(tot.sales)}</b><span>{t('staffDay.sales')}</span></div>}
          <div className={tot.late || tot.absent ? 'is-warn' : ''}><b>{tot.late} · {tot.absent}</b><span>{t('staffDay.lateAbsent')}</span></div>
        </div>
      )}

      {!shown.length ? (
        <div className="ui-empty-state"><span className="ui-empty-icon"><Icon name="tasks" size={22} /></span><p>{t('staffDay.empty')}</p></div>
      ) : (
        <div className="sdr-list">
          {shown.map(r => (
            <article key={r.id} className={`sdr-row is-${r.status}`}>
              <button type="button" className="sdr-row-main" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span className="sdr-avatar" aria-hidden="true">{(r.nome || '?').slice(0, 1).toUpperCase()}</span>
                <span className="sdr-who">
                  <strong>{r.nome}</strong>
                  <small>{r.cargo || t(`staffDay.st.${r.status}`)}</small>
                </span>
                <span className="sdr-time">
                  {r.firstIn ? `${r.firstIn} – ${r.lastOut || t('staffDay.now')}` : '—'}
                  <small>{hoursLabel(r.hours)}</small>
                </span>
                <span className="sdr-badges">
                  <span className={`sdr-badge is-${r.status}`}><Icon name={STATUS_ICON[r.status]} size={13} /> {t(`staffDay.st.${r.status}`)}</span>
                  {r.late && <span className="sdr-badge is-late"><Icon name="timer" size={13} /> {t('staffDay.late')}</span>}
                </span>
              </button>
              {(open === r.id || onlyId) && (
                <div className="sdr-detail">
                  <dl>
                    <div><dt>{t('staffDay.shifts')}</dt><dd>{r.blocks.length ? r.blocks.map((b, i) => <span key={i}>{b.in} – {b.out || t('staffDay.now')} ({hoursLabel(b.hours)})</span>) : '—'}</dd></div>
                    <div><dt>{t('staffDay.lateNight')}</dt><dd>{hoursLabel(r.lateHours)}</dd></div>
                    <div><dt>{t('staffDay.pay')}</dt><dd>{fmtYen(r.pay)}</dd></div>
                    {withSales && <div><dt>{t('staffDay.tickets')}</dt><dd>{r.tickets}</dd></div>}
                    {withSales && <div><dt>{t('staffDay.sales')}</dt><dd>{fmtYen(r.sales)}</dd></div>}
                    {withSales && <div><dt>{t('staffDay.commission')}</dt><dd>{fmtYen(r.commission)}</dd></div>}
                  </dl>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {off.length > 0 && <p className="desk-note sdr-off">{t('staffDay.offList', { names: off.map(r => r.nome).join(', ') })}</p>}
      {!onlyId && withSales && tot.unassigned > 0 && <p className="desk-note">{t('staffDay.unassigned', { count: tot.unassigned })}</p>}
      <p className="desk-note sdr-foot">{t('staffDay.source')}</p>
    </section>
  )
}
