import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { hoursBetween } from '../../lib/timeClock'
import { initialsOf } from '../../lib/staffApp'
import { fmtDay, fmtTime } from './staffUi'

/** The owner's clock page parts, in the order of the buttons. */
export const CLOCK_VIEWS = [
  { id: 'home', icon: 'dashboard' },
  { id: 'schedule', icon: 'calendar' },
  { id: 'nextWeek', icon: 'send' },
  { id: 'fines', icon: 'fine' },
  { id: 'hours', icon: 'clock' },
  { id: 'reports', icon: 'tasks' },
  { id: 'settings', icon: 'settings' },
]
const VIEW_KEY = 'jbm_clock_view'
const STATUS_TONE = { ok: 'is-ok', late: 'is-outside', absent: 'is-bad', missing: 'is-outside', pending: '' }

/** Which part of the clock page is open; remembered for this browser tab. */
export function useClockView(manager) {
  const [view, setView] = useState(() => {
    if (!manager) return 'all'
    try {
      const v = sessionStorage.getItem(VIEW_KEY)
      if (CLOCK_VIEWS.some(x => x.id === v)) return v
    } catch { /* ignore */ }
    return 'home'
  })
  function open(next) {
    setView(next)
    try { sessionStorage.setItem(VIEW_KEY, next) } catch { /* ignore */ }
  }
  return { view: manager ? view : 'all', open }
}

/**
 * Buttons at the top of the owner's clock page. On the overview they are a big grid; inside a part they shrink
 * to a strip so the part starts right under them.
 */
export default function ClockHub({ view, onOpen, onNewFine, onOpenStaff }) {
  const { t } = useI18n()
  const home = view === 'home'
  const extras = [
    onNewFine && { id: 'newFine', icon: 'plus', label: t('clockHub.newFine'), onClick: onNewFine, tone: 'is-danger' },
    onOpenStaff && { id: 'staffLogins', icon: 'users', label: t('clockHub.staffLogins'), onClick: () => onOpenStaff() },
  ].filter(Boolean)
  const items = home ? CLOCK_VIEWS.filter(v => v.id !== 'home') : CLOCK_VIEWS
  const nav = useRef(null)
  // Inside a part the strip scrolls sideways: keep the open part's button in sight.
  useEffect(() => {
    if (home) return
    const on = nav.current?.querySelector('.is-on')
    if (on && nav.current) nav.current.scrollLeft = Math.max(0, on.offsetLeft - (nav.current.clientWidth - on.offsetWidth) / 2)
  }, [view, home])
  return (
    <nav ref={nav} className={home ? 'clock-hub is-grid' : 'clock-hub is-strip'} aria-label={t('clockHub.nav')}>
      {items.map(v => (
        <button
          key={v.id}
          type="button"
          data-view={v.id}
          className={`clock-hub-btn${view === v.id ? ' is-on' : ''}`}
          aria-current={view === v.id ? 'page' : undefined}
          onClick={() => onOpen(v.id)}
        >
          <Icon name={!home && v.id === 'home' ? 'back' : v.icon} size={home ? 22 : 16} />
          <span>{t(`clockHub.${v.id}`)}</span>
        </button>
      ))}
      {home && extras.map(x => (
        <button key={x.id} type="button" data-view={x.id} className={`clock-hub-btn ${x.tone || ''}`} onClick={x.onClick}>
          <Icon name={x.icon} size={22} />
          <span>{x.label}</span>
        </button>
      ))}
    </nav>
  )
}

function Tile({ label, value, sub, tone = '', onClick }) {
  return (
    <button type="button" className={`clock-tile ${tone}`} onClick={onClick}>
      <span className="clock-tile-label">{label}</span>
      <b className="clock-tile-value">{value}</b>
      {sub && <small className="clock-tile-sub">{sub}</small>}
    </button>
  )
}

/** At-a-glance numbers: tonight's list, who is working, late/absent, fines, next week sent, hours and pay. */
const liveOf = row => {
  const sh = (row?.shifts || []).find(x => x.open)
  return sh?.clockIn?.punched_at ? { at: sh.clockIn.punched_at, hours: hoursBetween(sh.clockIn.punched_at, new Date().toISOString()) } : null
}
const hoursText = h => `${(Math.round((+h || 0) * 10) / 10).toFixed(1)}h`

/** One square card per person: photo (or initials), name, working or off, hours tonight and this month, rate per hour. */
export function StaffFaces({ staff, monthRows, todayRows, photos, showRate, onOpen }) {
  const { t } = useI18n()
  const month = new Map(monthRows.map(r => [String(r.staff_id), r]))
  const today = new Map(todayRows.map(r => [String(r.staff_id), r]))
  const people = staff.map(s => {
    const m = month.get(String(s.id))
    const d = today.get(String(s.id))
    const live = liveOf(m)
    const extra = live ? live.hours : 0
    return { ...s, open: !!m?.open, live, today: (d?.hours || 0) + extra, month: (m?.hours || 0) + extra }
  }).sort((a, b) => (b.open - a.open) || (b.today - a.today) || (b.month - a.month) || String(a.nome || '').localeCompare(String(b.nome || '')))
  const working = people.filter(p => p.open).length
  return (
    <section className="desk-card clock-faces">
      <div className="osb-head">
        <h3><Icon name="users" size={17} /> {t('clockHub.team')}</h3>
        <span className={`sa-chip${working ? ' is-ok' : ''}`}>{t('clockHub.workingN', { n: working })}</span>
      </div>
      {!people.length && <p className="desk-note">{t('clock.noStaff')}</p>}
      <div className="clock-faces-grid">
        {people.map(p => {
          const url = p.foto && photos?.[p.foto]
          const rate = +p.salario_hora || 0
          return (
            <button key={p.id} type="button" className={`clock-face${p.open ? ' is-open' : ''}`} onClick={() => onOpen('hours')}>
              <span className="clock-face-photo">
                {url ? <img src={url} alt="" loading="lazy" /> : <span>{initialsOf(p.nome || p.email || '?')}</span>}
                <em className={p.open ? 'is-on' : ''}>{p.open ? t('clockHub.inSince', { time: fmtTime(p.live.at) }) : t('clock.offShift')}</em>
              </span>
              <strong className="clock-face-name">{p.nome || p.email || '—'}</strong>
              <span className="clock-face-stats">
                <span><small>{t('clockHub.today')}</small><b>{hoursText(p.today)}</b></span>
                <span><small>{t('clockHub.month')}</small><b>{hoursText(p.month)}</b></span>
                {showRate && <span><small>{t('clockHub.rate')}</small><b>{rate ? fmtYen(rate) : '—'}</b></span>}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function ClockOverview({ summary, teamRows, loading, onOpen, faces }) {
  const { t } = useI18n()
  const tonight = summary.tonight
  const people = tonight?.attendance || []
  const shown = people.slice(0, 6)
  const working = teamRows.filter(r => r.open)
  const hours = teamRows.reduce((n, r) => n + (+r.hours || 0), 0)
  const pay = teamRows.reduce((n, r) => n + (+r.pay || 0), 0)
  const dash = '—'
  const nw = summary.nextWeek
  return (
    <div className="clock-overview">
      <div className="clock-tiles">
        <Tile label={t('clockHub.workingNow')} value={loading ? dash : working.length} sub={working.length ? working.map(r => r.nome).filter(Boolean).slice(0, 3).join(', ') : t('clockHub.peopleSub')} tone={working.length ? 'is-ok' : ''} onClick={() => onOpen('hours')} />
        <Tile label={t('clockHub.lateWeek')} value={summary.flagged ?? dash} sub={t('clockHub.lateWeekSub')} tone={summary.flagged ? 'is-warn' : ''} onClick={() => onOpen('schedule')} />
        <Tile label={t('clockHub.finesMonth')} value={summary.fines ? fmtYen(summary.fines.total) : dash} sub={t('clockHub.finesSub', { n: summary.fines?.count || 0 })} tone={summary.fines?.total ? 'is-bad' : ''} onClick={() => onOpen('fines')} />
        <Tile label={t('clockHub.nextWeekSent')} value={nw ? `${nw.sent}/${nw.total}` : dash} sub={nw ? t('clockHub.nextWeekSub', { when: `${fmtDay(nw.deadline, { weekday: 'short', month: 'numeric', day: 'numeric' })} ${fmtTime(nw.deadline)}` }) : ''} tone={nw && nw.sent < nw.total ? 'is-warn' : nw ? 'is-ok' : ''} onClick={() => onOpen('nextWeek')} />
        <Tile label={t('clockHub.hoursMonth')} value={loading ? dash : `${hours.toFixed(1)}h`} sub={t('clockHub.monthSub')} onClick={() => onOpen('hours')} />
        <Tile label={t('clockHub.payMonth')} value={loading ? dash : fmtYen(pay)} sub={t('clockHub.monthSub')} onClick={() => onOpen('hours')} />
      </div>
      {faces}
      <section className="desk-card clock-tonight">
        <div className="osb-head">
          <h3><Icon name="calendar" size={17} /> {tonight ? t('clockHub.tonightDay', { day: fmtDay(`${tonight.day}T12:00:00+09:00`, { weekday: 'short', month: 'short', day: 'numeric' }) }) : t('clockHub.tonight')}</h3>
          {tonight && (tonight.confirmed
            ? <span className="sa-chip is-ok"><Icon name="check" size={12} /> {t('clockHub.confirmed')}</span>
            : tonight.count > 0 || tonight.marked > 0 ? <span className="sa-chip is-outside">{t('clockHub.notConfirmed')}</span> : null)}
        </div>
        {!tonight && summary.boardErr && (
          <div className="clock-tonight-err">
            <p className="pos-sale-err">{summary.boardErr}</p>
            {summary.reloadBoard && <button type="button" className="ui-btn" onClick={() => summary.reloadBoard()}><Icon name="refresh" size={16} /> {t('clockHub.retry')}</button>}
          </div>
        )}
        {!tonight && !summary.boardErr && <p className="desk-note">{t('common.wait')}</p>}
        {tonight && (
          <>
            <p className="clock-tonight-count">{t('clockHub.expected', { n: tonight.count })}</p>
            {!people.length && <p className="desk-note">{t('clockHub.nobodyTonight')}</p>}
            {people.length > 0 && (
              <ul className="clock-tonight-list">
                {shown.map(a => (
                  <li key={a.id}>
                    <span className="osb-name">{a.nome || a.id}{a.inAt ? <small> · {fmtTime(a.inAt)}</small> : a.start ? <small> · {a.start}</small> : null}</span>
                    {a.status && a.status !== 'pending' && <span className={`sa-chip ${STATUS_TONE[a.status] || ''}`}>{t(`ownerSchedule.st_${a.status}`, { min: a.lateMinutes })}</span>}
                  </li>
                ))}
                {people.length > shown.length && <li className="clock-tonight-more">{t('clockHub.more', { n: people.length - shown.length })}</li>}
              </ul>
            )}
            <button type="button" className={tonight.confirmed ? 'ui-btn' : 'btn-primary'} onClick={() => onOpen('schedule')}>
              {tonight.confirmed || !(tonight.count || tonight.marked) ? t('clockHub.openSchedule') : t('clockHub.confirmTonight')}
            </button>
          </>
        )}
      </section>
    </div>
  )
}
