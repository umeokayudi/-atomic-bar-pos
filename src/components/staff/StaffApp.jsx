import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../Auth'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { staffFetch } from '../../lib/apiAuth'
import { tokyoMonthKey } from '../../lib/tokyo'
import { monthRange } from '../../lib/timeClock'
import { punchGeoFlag } from '../../lib/clockGeo'
import {
  barBrand, bottomTabFor, rememberStaffBrand, elapsedLabel, myClockState, staffAppTabFor, staffAppTabsFor, staffMoreItemsFor,
} from '../../lib/staffApp'
import { meDay, meProfile } from '../../lib/staffSelfApi'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { useClockPunch } from './ClockPunch'
import { Avatar, Card, Note, Row, Stat, fmtDay, fmtHours, fmtTime, useNow } from './staffUi'
import { OccurrencesScreen, PerformanceScreen, ProfileScreen, ReportsScreen, SettingsScreen, ShiftsScreen } from './StaffScreens'

import { PayHubScreen } from './PayHub'
import { NextShiftsCard, NextWeekGate, ScheduleScreen, useMySchedule } from './ScheduleScreen'
import { tokyoNightKey } from '../../lib/tokyo'
import { greetingPart } from '../../lib/greeting'
import { shiftCountdown, spanLabel } from '../../lib/staffSchedule'

const StaffAlerts = lazy(() => import('../StaffAlerts'))
function BarMark({ brand, size = 36 }) {
  return (
    <span className="sa-barmark" style={{ width: size, height: size, ...(brand.color ? { background: brand.color } : {}) }} aria-hidden="true">
      {brand.logo ? <img src={brand.logo} alt="" /> : brand.initials}
    </span>
  )
}

/** Greeting in English and Japanese at once (Tokyo time): morning 5–12, afternoon 12–18, evening after. */
export const GREETINGS = {
  morning: { en: 'Good morning', ja: 'おはようございます', icon: 'sun' },
  afternoon: { en: 'Good afternoon', ja: 'こんにちは', icon: 'sun' },
  evening: { en: 'Good evening', ja: 'こんばんは', icon: 'moon' },
}
export function greetingFor(date = new Date()) {
  const part = greetingPart(date)
  return { part: part === 'night' ? 'evening' : part, ...GREETINGS[part === 'night' ? 'evening' : part] }
}
const clockText = ms => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))

/** Home header: live Tokyo clock and the greeting in English + Japanese. */
function HomeHello({ firstName }) {
  const now = useNow(true, 15000)
  const g = greetingFor(new Date(now))
  return (
    <section className={`sa-hello is-${g.part}`} aria-live="off">
      <div className="sa-hello-text">
        <div className="sa-kicker">{fmtDay(now, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>{g.en}{firstName ? `, ${firstName}` : ''}</h1>
        <p lang="ja">{g.ja}{firstName ? `、${firstName}さん` : ''}</p>
      </div>
      <div className="sa-hello-clock">
        <Icon name={g.icon} size={18} />
        <strong>{clockText(now)}</strong>
        <small>JST</small>
      </div>
    </section>
  )
}

/** Once per part of the day on this device: a small "Good evening · こんばんは · 20:14" toast. */
function greetingToastOnce() {
  const g = greetingFor()
  const key = `sa_greet_${tokyoNightKey()}_${g.part}`
  try {
    if (localStorage.getItem(key)) return ''
    localStorage.setItem(key, '1')
  } catch { return '' }
  return `${g.en} · ${g.ja} · ${clockText(Date.now())}`
}

/** Big, thumb-sized way into the till from Home. */
function PosQuickButton({ t, onOpen }) {
  return (
    <button type="button" className="sa-posbtn" onClick={onOpen}>
      <span className="sa-posbtn-icon"><Icon name="pos" size={26} /></span>
      <span className="sa-posbtn-text">
        <strong>{t('staffApp.home.newOrder')}</strong>
        <small>{t('staffApp.home.newOrderSub')}</small>
      </span>
      <Icon name="next" size={22} />
    </button>
  )
}

/** My next confirmed shift (tonight first) and my punches on that night. */
export function confirmedShift(schedule, punches, meId, today = tokyoNightKey()) {
  const confirmed = schedule?.data?.confirmed || {}
  const day = Object.keys(confirmed).filter(d => d >= today && confirmed[d]?.in && confirmed[d]?.start).sort()[0]
  if (!day) return null
  const mine = (punches || []).filter(p => p && p.staff_id === meId && p.punched_at && tokyoNightKey(new Date(p.punched_at)) === day)
    .sort((a, b) => Date.parse(a.punched_at) - Date.parse(b.punched_at))
  const firstIn = mine.find(p => p.tipo === 'in') || null
  const last = mine[mine.length - 1] || null
  return {
    day, start: confirmed[day].start, end: confirmed[day].end || '',
    inAt: firstIn?.punched_at || null,
    outAt: last && last.tipo === 'out' && firstIn ? last.punched_at : null,
  }
}

/** After the owner confirms: time to start, late, time left to finish. */
function ShiftCountdownCard({ t, shift, tolerance, today }) {
  const now = useNow(!!shift, 1000)
  if (!shift) return null
  const c = shiftCountdown({ ...shift, toleranceMin: tolerance, now: new Date(now) })
  if (!c) return null
  const when = shift.day === today ? t('schedule.tonight') : fmtDay(`${shift.day}T12:00:00+09:00`, { weekday: 'short', month: 'short', day: 'numeric' })
  const hours = `${shift.start}${shift.end ? `–${shift.end}` : ''}`
  let tone = ''
  let big = ''
  let sub = ''
  if (c.phase === 'before') { big = spanLabel(c.msToStart); sub = t('shiftTimer.toStart') }
  else if (c.phase === 'due') { tone = 'warn'; big = t('shiftTimer.now'); sub = t('shiftTimer.clockInNow') }
  else if (c.phase === 'late') { tone = 'bad'; big = t('shiftTimer.lateBy', { min: c.lateMinutes }); sub = t('shiftTimer.lateNotIn') }
  else if (c.phase === 'missed') { tone = 'bad'; big = t('shiftTimer.missed'); sub = t('shiftTimer.missedSub') }
  else if (c.phase === 'on') { tone = 'on'; big = c.msToEnd != null ? spanLabel(c.msToEnd) : '—'; sub = c.msToEnd != null ? t('shiftTimer.toEnd') : t('shiftTimer.noEnd') }
  else if (c.phase === 'over') { tone = 'warn'; big = `+${spanLabel(c.msOver)}`; sub = t('shiftTimer.over') }
  else if (c.phase === 'done') { tone = 'ok'; big = t('shiftTimer.done'); sub = '' }
  return (
    <section className={`sa-shift${tone ? ` is-${tone}` : ''}`} aria-live="polite">
      <div className="sa-shift-head">
        <span className="sa-chip is-ok"><Icon name="check" size={12} /> {t('schedule.confirmed')}</span>
        <span className="sa-shift-when">{when} · <b>{hours}</b></span>
      </div>
      <div className="sa-shift-big">{big}</div>
      {sub && <div className="sa-shift-sub">{sub}</div>}
      {c.lateMinutes > 0 && ['on', 'over', 'done'].includes(c.phase) && (
        <div className="sa-shift-late"><Icon name="warning" size={14} /> {t('shiftTimer.cameLate', { min: c.lateMinutes })}</div>
      )}
      {c.phase === 'on' && c.pct != null && (
        <div className="sa-bar" role="progressbar" aria-valuenow={c.pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${c.pct}%` }} /></div>
      )}
    </section>
  )
}

/** The one big card: status, live timer and the clock-in / clock-out button. */
function ClockCard({ t, clock, punch, canClock, compact }) {
  const now = useNow(clock.onShift)
  const ms = clock.onShift ? now - Date.parse(clock.since) : 0
  const label = punch.phase === 'locating' ? t('staffApp.locating') : punch.phase === 'sending' ? t('common.wait') : (clock.onShift ? t('employee.clockOutCta') : t('employee.clockInCta'))
  return (
    <section className={`sa-clock${clock.onShift ? ' is-on' : ''}${compact ? ' is-compact' : ''}`} aria-live="polite">
      <div className="sa-clock-top">
        <span className={`sa-status${clock.onShift ? ' is-on' : ''}`}><span className="sa-dot" />{clock.onShift ? t('employee.onShiftSince', { time: fmtTime(clock.since) }) : t('employee.offShift')}</span>
      </div>
      <div className="sa-timer" aria-label={t('staffApp.timer')}>{clock.onShift ? elapsedLabel(ms) : '0:00:00'}</div>
      {canClock ? (
        <button type="button" className="sa-clock-cta" disabled={punch.busy} onClick={() => punch.start(clock.onShift ? 'out' : 'in')}>
          <Icon name={punch.phase === 'locating' ? 'location' : 'clock'} size={22} /> {label}
        </button>
      ) : (
        <Note>{t('staffApp.noClockArea')}</Note>
      )}
      {!compact && <p className="sa-clock-hint"><Icon name="location" size={13} /> {t('staffApp.gpsHint')}</p>}
      {punch.err && <div className="sa-error" role="alert">{punch.err}</div>}
    </section>
  )
}

function TonightCard({ t, day, onTab }) {
  if (!day) return null
  const g = day.goal || {}
  return (
    <Card title={t('staffApp.home.tonight')} right={<button type="button" className="sa-link" onClick={() => onTab('performance')}>{t('employee.seeAll')}</button>}>
      <div className="sa-mission">
        <Icon name="goals" size={18} />
        <div>
          <span>{t('staffApp.brief.mission')}</span>
          <strong>{day.mission || t('staffApp.brief.noMission')}</strong>
        </div>
      </div>
      <div className="sa-brief-grid">
        <Stat label={t('staffApp.brief.role')} value={day.role || '—'} />
        <Stat label={t('staffApp.brief.barGoal')} value={day.barGoal ? fmtYen(day.barGoal) : '—'} />
      </div>
      {g.target > 0 ? (
        <div className="sa-goal">
          <div className="sa-goal-head"><span>{t('staffApp.brief.myGoal')}</span><b>{fmtYen(day.summary?.sales || 0)} / {fmtYen(g.target)}</b></div>
          <div className="sa-bar" role="progressbar" aria-valuenow={g.pct || 0} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${g.pct || 0}%` }} className={g.reached ? 'is-done' : ''} /></div>
        </div>
      ) : <Note icon="goals">{t('staffApp.home.noPersonalGoal')}</Note>}
    </Card>
  )
}

function HomeScreen({ t, perfil, profile, clock, punch, canClock, day, monthHours, pack, missing, onTab, schedule, canPos, meId, punches }) {
  const firstName = String(profile?.nome || perfil?.nome || '').trim().split(/\s+/)[0] || ''
  const goals = (pack?.goals || []).slice(0, 3)
  const today = tokyoNightKey()
  const shift = confirmedShift(schedule, punches, meId, today)
  return (
    <div className="sa-screen">
      <HomeHello firstName={firstName} />
      {canPos && <PosQuickButton t={t} onOpen={() => onTab('pos')} />}
      <ShiftCountdownCard t={t} shift={shift} tolerance={schedule?.data?.tolerance} today={today} />
      <ClockCard t={t} clock={clock} punch={punch} canClock={canClock} compact />
      <div className="sa-wide">
        <TonightCard t={t} day={day} onTab={onTab} />
        <NextShiftsCard t={t} schedule={schedule} today={tokyoNightKey()} onOpen={() => onTab('schedule')} />
        <div className="sa-stats">
          <Stat label={t('employee.statHours')} value={fmtHours(monthHours)} sub={t('employee.thisMonth')} onClick={() => onTab('shifts')} />
          <Stat label={t('staffApp.home.tonightSales')} value={fmtYen(day?.summary?.sales || 0)} onClick={() => onTab('performance')} />
          <Stat label={t('staffApp.home.earnings')} value={t('staffApp.home.open')} sub={t('staffApp.home.earningsSub')} onClick={() => onTab('salary')} />
        </div>
        <Card title={t('employee.goals')} right={<button type="button" className="sa-link" onClick={() => onTab('performance')}>{t('employee.seeAll')}</button>}>
          {missing ? <Note>{t('staffApp.payrollSoon')}</Note> : goals.length === 0 ? <Note icon="goals">{t('employee.noGoals')}</Note> : goals.map(g => {
            const pct = +g.target ? Math.max(0, Math.min(100, Math.round(((+g.actual || 0) / +g.target) * 100))) : null
            return (
              <div key={g.id} className="sa-goal">
                <div className="sa-goal-head"><span>{g.title}</span><b>{g.actual ?? '—'} / {g.target ?? '—'}</b></div>
                {pct !== null && <div className="sa-bar"><div style={{ width: `${pct}%` }} className={pct >= 100 ? 'is-done' : ''} /></div>}
              </div>
            )
          })}
        </Card>
        <button type="button" className="sa-wide-btn" onClick={() => onTab('reports')}>
          <Icon name="send" size={18} /> <span>{t('staffApp.home.sendReport')}</span> <Icon name="next" size={16} />
        </button>
      </div>
    </div>
  )
}

function ClockScreen({ t, clock, punch, canClock, venue, punches }) {
  const recent = clock.mine.slice(0, 12)
  return (
    <div className="sa-screen">
      <h1 className="sa-title">{t('staffApp.tabClock')}</h1>
      <ClockCard t={t} clock={clock} punch={punch} canClock={canClock} />
      <Card title={t('staffApp.clock.location')}>
        {venue?.configured
          ? <Note icon="location">{t('staffApp.clock.venueOn', { radius: venue.radius_m })}</Note>
          : <Note icon="location">{t('staffApp.clock.venueOff')}</Note>}
      </Card>
      <Card title={t('staffApp.clock.recent')}>
        {!recent.length && <Note>{t('employee.noPunches')}</Note>}
        {recent.map(p => {
          const flag = punchGeoFlag(p)
          return (
            <Row
              key={p.id || p.punched_at}
              title={`${p.tipo === 'in' ? t('employee.punchIn') : t('employee.punchOut')} · ${fmtTime(p.punched_at)}`}
              meta={fmtDay(p.punched_at)}
              value={flag ? <span className={`sa-chip is-${flag.status}`}>{flag.status === 'outside' ? t('staffApp.geo.badgeOutside', { distance: flag.distance ?? '?' }) : t('staffApp.geo.badgeNoGps')}</span> : (p.geo_status === 'ok' ? <span className="sa-chip is-ok">{t('staffApp.clock.atBar')}</span> : '')}
            >
              {flag?.justification ? <em className="sa-reason">“{flag.justification}”</em> : null}
            </Row>
          )
        })}
        {punches == null && <Note>{t('common.wait')}</Note>}
      </Card>
    </div>
  )
}

function MoreMenu({ t, open, onClose, items, onTab, profile, perfil, bar, signOut }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('sa-lock')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('sa-lock') }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sa-more" role="dialog" aria-modal="true" aria-label={t('staffApp.tabMore')}>
      <div className="sa-more-inner">
        <header className="sa-more-head">
          <Avatar name={profile?.nome || perfil?.nome} url={profile?.foto_url} size={56} />
          <div>
            <strong>{profile?.nome || perfil?.nome}</strong>
            <span>{[profile?.cargo, bar?.nome].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" className="sa-icon-btn" onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={22} /></button>
        </header>
        <nav className="sa-more-list">
          {items.map(it => (
            <button key={it.id} type="button" onClick={() => { onTab(it.id); onClose() }}>
              <span className="sa-more-icon"><Icon name={it.icon} size={20} /></span>
              <span>{t(it.labelKey)}</span>
              <Icon name="next" size={18} />
            </button>
          ))}
        </nav>
        <button type="button" className="sa-btn is-ghost sa-signout" onClick={signOut}><Icon name="signOut" size={18} /> {t('common.signOut')}</button>
      </div>
    </div>
  )
}

/**
 * The employee app: own header with the bar's identity, one screen at a time, bottom tabs
 * Home · Performance · POS · Clock · More (full-screen menu). Used for bar staff and "Staff only" logins.
 * Data: payroll_my_pack (own pay pack), /api/time-clock (own punches, venue), /api/bar-staff me* actions.
 */
export default function StaffApp({ bar, tab, onTab, signOut, canOpen = () => true, renderWork }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const screen = staffAppTabFor(tab)
  const brand = useMemo(() => barBrand(bar), [bar])
  const [moreOpen, setMoreOpen] = useState(false)
  const [punches, setPunches] = useState(null)
  const [venue, setVenue] = useState(null)
  const [nightPremium, setNightPremium] = useState(true)
  const [day, setDay] = useState(null)
  const [profile, setProfile] = useState(null)
  const [pack, setPack] = useState(null)
  const [missing, setMissing] = useState(false)
  const [toast, setToast] = useState('')
  const meId = perfil?.id
  const competence = tokyoMonthKey()
  const schedule = useMySchedule()

  useEffect(() => { if (brand.name) rememberStaffBrand(brand) }, [brand])
  useEffect(() => { const hello = greetingToastOnce(); if (hello) setToast(hello) }, [])

  const loadPunches = useCallback(async () => {
    const range = monthRange()
    // Look back far enough to see a shift that started yesterday (night shifts cross midnight and month ends).
    const lookback = new Date(Date.now() - 40 * 3600e3).toISOString()
    const from = lookback < range.from ? lookback : range.from
    try {
      const j = await staffFetch(`/api/time-clock?from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date(Date.now() + 60e3).toISOString())}`).then(r => r.json())
      setPunches(Array.isArray(j?.punches) ? j.punches : [])
      setVenue(j?.venue || null)
      setNightPremium(j?.adicional_noturno !== false)
    } catch {
      setPunches([])
    }
  }, [])

  const loadDay = useCallback(() => meDay().then(setDay).catch(() => setDay(null)), [])

  useEffect(() => {
    loadPunches()
    loadDay()
    meProfile().then(setProfile).catch(() => setProfile(null))
    let live = true
    supabase.rpc('payroll_my_pack', { p_competence: competence }).then(({ data, error }) => {
      if (!live) return
      // Missing payroll tables (schemaMissing) or any other pack error: a small note in Pay, never an error panel.
      if (error) { setMissing(true); setPack(null); return }
      setPack(data && typeof data === 'object' ? data : null)
    }, () => { if (live) setMissing(true) })
    return () => { live = false }
  }, [competence, loadPunches, loadDay])

  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(id)
  }, [toast])

  const clock = myClockState(punches || [], meId)
  const canClock = canOpen('ponto') && !perfil?.lane
  const punch = useClockPunch({
    barId: bar?.id,
    meId,
    venue,
    day,
    openIn: clock.onShift ? { id: clock.openInId, at: clock.since } : null,
    onDone: (j, tipo) => {
      const at = j?.punch?.punched_at || new Date().toISOString()
      setToast(t(tipo === 'out' ? 'staffApp.toastOut' : 'staffApp.toastIn', { time: fmtTime(at) }))
      if (j?.punch) setPunches(prev => [j.punch, ...(prev || [])])
      setTimeout(loadPunches, 800)
      loadDay()
    },
  })

  const monthHours = useMemo(() => {
    const range = monthRange()
    const mine = (punches || []).filter(p => p.staff_id === meId && p.punched_at >= range.from)
    let h = 0
    const sorted = [...mine].sort((a, b) => Date.parse(a.punched_at) - Date.parse(b.punched_at))
    let open = null
    for (const p of sorted) {
      if (p.tipo === 'in') open = p
      else if (p.tipo === 'out' && open) { h += (Date.parse(p.punched_at) - Date.parse(open.punched_at)) / 3600e3; open = null }
    }
    // The shift in progress counts up to now (an open shift older than 20h is a forgotten clock-out: left out).
    if (open && Date.now() - Date.parse(open.punched_at) < 20 * 3600e3) h += Math.max(0, (Date.now() - Date.parse(open.punched_at)) / 3600e3)
    return Math.round(h * 100) / 100
  }, [punches, meId])

  const tabs = staffAppTabsFor(canOpen)
  const moreItems = staffMoreItemsFor(canOpen)
  const lit = moreOpen ? 'more' : bottomTabFor(screen)
  const work = ['pos', 'mesas', 'pedidos'].includes(screen) && canOpen(screen)
  const go = id => { setMoreOpen(false); onTab(id) }
  const shared = { t, perfil, profile, bar, pack, missing, competence, onTab: go, punches, nightPremium, meId }
  const canPos = canOpen('pos')
  // Next week's schedule is required: until it is sent, the app shows only the clock and the week to send.
  const mustSend = !!schedule.data?.status?.mustSend
  const fab = canPos && !mustSend && !work && !['hoje', 'schedule'].includes(screen)

  return (
    <div className={`sa-app${work && !mustSend ? ' is-work' : ''}`} style={brand.color ? { '--sa-brand': brand.color } : undefined}>
      <header className="sa-top">
        <button type="button" className="sa-top-bar" onClick={() => go('hoje')} aria-label={t('staffApp.tabHome')}>
          <BarMark brand={brand} />
          <span className="sa-top-name">
            <strong>{brand.name || t('staffApp.yourBar')}</strong>
            <small>{profile?.nome || perfil?.nome || ''}</small>
          </span>
        </button>
        {clock.onShift && <span className="sa-top-live" aria-label={t('staffApp.onShift')}><span className="sa-dot" /> {t('staffApp.onShift')}</span>}
        <Avatar name={profile?.nome || perfil?.nome} url={profile?.foto_url} size={40} onClick={() => go('profile')} label={t('employee.profile')} />
      </header>

      <Suspense fallback={null}><div className="sa-alerts"><StaffAlerts /></div></Suspense>

      <main className="sa-main">
        {mustSend ? (
          <NextWeekGate t={t} today={tokyoNightKey()} schedule={schedule} top={<ClockCard t={t} clock={clock} punch={punch} canClock={canClock} compact />} />
        ) : (<>
        {screen === 'hoje' && <HomeScreen {...shared} clock={clock} punch={punch} canClock={canClock} day={day} monthHours={monthHours} schedule={schedule} canPos={canPos} />}
        {screen === 'ponto' && <ClockScreen t={t} clock={clock} punch={punch} canClock={canClock} venue={venue} punches={punches} />}
        {screen === 'performance' && <PerformanceScreen {...shared} day={day} />}
        {screen === 'shifts' && <ShiftsScreen {...shared} />}
        {screen === 'salary' && <PayHubScreen {...shared} />}
        {screen === 'schedule' && <ScheduleScreen {...shared} today={tokyoNightKey()} schedule={schedule} />}
        {screen === 'reports' && <ReportsScreen {...shared} />}
        {screen === 'profile' && <ProfileScreen {...shared} onProfile={setProfile} signOut={signOut} />}
        {screen === 'occurrences' && <OccurrencesScreen {...shared} />}
        {screen === 'settings' && <SettingsScreen {...shared} signOut={signOut} />}
        {work && (
          <div className="sa-work">
            {/* HOOK(staff-pos): the POS tab renders the staff till (pos/StaffPos: attribution + equal cast split via
                saleCredit) for bar_staff, else AtomicPos with cashier access. PortalCliente supplies it. */}
            {renderWork?.(screen)}
          </div>
        )}
        {['pos', 'mesas', 'pedidos'].includes(screen) && !canOpen(screen) && <Note>{t('barUsers.noAccessBody')}</Note>}
        </>)}
      </main>

      {fab && (
        <button type="button" className="sa-fab" onClick={() => go('pos')} aria-label={t('staffApp.home.newOrder')}>
          <Icon name="plus" size={22} /> <span>{t('staffApp.fab')}</span>
        </button>
      )}

      {toast && <div className="sa-toast" role="status">{toast}</div>}
      {punch.sheet}

      <nav className="sa-tabs" aria-label={t('staffApp.nav')}>
        {tabs.map(it => (
          <button
            key={it.id}
            type="button"
            className={lit === it.id ? 'is-on' : ''}
            aria-current={lit === it.id ? 'page' : undefined}
            onClick={() => (it.id === 'more' ? setMoreOpen(o => !o) : go(it.id))}
          >
            <Icon name={it.icon} size={22} />
            <span>{t(it.labelKey)}</span>
          </button>
        ))}
      </nav>

      <MoreMenu t={t} open={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} onTab={go} profile={profile} perfil={perfil} bar={bar} signOut={signOut} />
    </div>
  )
}
