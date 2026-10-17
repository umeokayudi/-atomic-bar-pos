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
import { ScheduleCta, ScheduleHomeCard, ScheduleScreen, rangeLabel, useMySchedule } from './ScheduleScreen'
import StaffBell from './StaffBell'
import { tokyoNightKey } from '../../lib/tokyo'
import { greetingPart } from '../../lib/greeting'
import { shiftCountdown, spanLabel } from '../../lib/staffSchedule'

const StaffAlerts = lazy(() => import('../StaffAlerts'))
/** Screens that stay open while next week's schedule is still to send (the rest point to "Send schedule"). */
export const GATE_FREE = ['hoje', 'ponto', 'schedule', 'profile', 'settings']
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

/** Home greeting (KuriPuro style): date + live Tokyo time, "Good evening, Aiko" with a wave, and the other language under it. */
function HomeHello({ firstName, lang }) {
  const now = useNow(true, 15000)
  const g = greetingFor(new Date(now))
  const main = lang === 'ja' ? `${g.ja}${firstName ? `、${firstName}さん` : ''}` : `${g.en}${firstName ? `, ${firstName}` : ''}`
  const other = lang === 'ja' ? `${g.en}${firstName ? `, ${firstName}` : ''}` : `${g.ja}${firstName ? `、${firstName}さん` : ''}`
  return (
    <section className={`sa-hello is-${g.part}`} aria-live="off">
      <div className="sa-hello-kicker">
        <Icon name={g.icon} size={14} />
        <span>{fmtDay(now, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <b>{clockText(now)} <small>JST</small></b>
      </div>
      <h1>
        <span>{main}</span>
        <span className="welcome-wave" aria-hidden="true"><Icon name="wave" size={20} /></span>
      </h1>
      <p lang={lang === 'ja' ? 'en' : 'ja'}>{other}</p>
    </section>
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

/** After the owner confirms: time to start, late, time left to finish (shown inside the clock card). */
function shiftLine(t, shift, tolerance, now) {
  if (!shift) return null
  const c = shiftCountdown({ ...shift, toleranceMin: tolerance, now: new Date(now) })
  if (!c) return null
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
  return { ...c, tone, big, sub }
}

/** The one big card: status pill, tonight's confirmed hours + countdown, live timer and the clock-in / out button. */
function ClockCard({ t, clock, punch, canClock, compact, shift, tolerance, today }) {
  const now = useNow(clock.onShift || !!shift, 1000)
  const ms = clock.onShift ? now - Date.parse(clock.since) : 0
  const line = shiftLine(t, shift, tolerance, now)
  const when = shift ? (shift.day === today ? t('schedule.tonight') : fmtDay(`${shift.day}T12:00:00+09:00`, { weekday: 'short', month: 'short', day: 'numeric' })) : ''
  const label = punch.phase === 'locating' ? t('staffApp.locating') : punch.phase === 'sending' ? t('common.wait') : (clock.onShift ? t('employee.clockOutCta') : t('employee.clockInCta'))
  return (
    <section className={`sa-clock${clock.onShift ? ' is-on' : ''}${compact ? ' is-compact' : ''}`} aria-live="polite">
      <div className="sa-clock-top">
        <span className={`sa-status${clock.onShift ? ' is-on' : ''}`}><span className="sa-dot" />{clock.onShift ? t('employee.onShiftSince', { time: fmtTime(clock.since) }) : t('employee.offShift')}</span>
        {shift && <span className="sa-clock-shift"><Icon name="calendar" size={14} /> {when} · <b>{shift.start}{shift.end ? `–${shift.end}` : ''}</b></span>}
      </div>
      <div className="sa-clock-mid">
        <div className="sa-timer" aria-label={t('staffApp.timer')}>{clock.onShift ? elapsedLabel(ms) : '0:00:00'}</div>
        {line && (
          <div className={`sa-clock-count${line.tone ? ` is-${line.tone}` : ''}`}>
            <b>{line.big}</b>
            {line.sub && <small>{line.sub}</small>}
          </div>
        )}
      </div>
      {line?.phase === 'on' && line.pct != null && (
        <div className="sa-bar is-clock" role="progressbar" aria-valuenow={line.pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${line.pct}%` }} /></div>
      )}
      {line && line.lateMinutes > 0 && ['on', 'over', 'done'].includes(line.phase) && (
        <div className="sa-clock-late"><Icon name="warning" size={14} /> {t('shiftTimer.cameLate', { min: line.lateMinutes })}</div>
      )}
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

/** Four big shortcuts with a live hint each: till, results, pay, reports. */
function QuickActions({ t, canPos, day, monthHours, onTab }) {
  const items = [
    canPos && { id: 'pos', icon: 'pos', label: t('staffApp.home.newOrder'), sub: t('staffApp.home.qaPosSub'), primary: true },
    { id: 'performance', icon: 'result', label: t('staffApp.tabPerformance'), sub: t('staffApp.home.qaResultsSub', { amount: fmtYen(day?.summary?.sales || 0) }) },
    { id: 'salary', icon: 'salary', label: t('staffApp.more.earnings'), sub: t('staffApp.home.qaPaySub', { hours: fmtHours(monthHours) }) },
    { id: 'reports', icon: 'send', label: t('staffApp.home.qaReports'), sub: t('staffApp.home.qaReportsSub') },
  ].filter(Boolean)
  return (
    <nav className={`sa-quick is-${items.length}`} aria-label={t('staffApp.home.quick')}>
      {items.map(it => (
        <button key={it.id} type="button" className={`sa-quick-btn${it.primary ? ' is-primary' : ''}`} onClick={() => onTab(it.id)}>
          <span className="sa-quick-icon"><Icon name={it.icon} size={22} /></span>
          <span className="sa-quick-text">
            <strong>{it.label}</strong>
            <small>{it.sub}</small>
          </span>
        </button>
      ))}
    </nav>
  )
}

/** Next week not sent and the person opened another screen: a gentle sheet that points to the schedule. */
function ScheduleGateSheet({ t, schedule, onSend, onHome }) {
  const status = schedule.data?.status
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onHome() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onHome])
  if (!status?.week) return null
  const range = rangeLabel(status.week.from, status.week.to)
  return (
    <div className="sa-sheet-wrap" role="presentation" onClick={e => { if (e.target === e.currentTarget) onHome() }}>
      <div className="sa-sheet" role="dialog" aria-modal="true" aria-labelledby="sa-gate-title">
        <div className="sa-sheet-grip" />
        <div className="sa-sheet-head">
          <span className="sa-sheet-icon"><Icon name="calendar" size={24} /></span>
          <div>
            <h2 id="sa-gate-title">{t('schedule.gateSheetTitle')}</h2>
            <p>{t('schedule.gateSheetLead', { range })}</p>
          </div>
        </div>
        <div className="sa-sheet-actions">
          <button type="button" className="sa-btn is-primary" onClick={onSend}><Icon name="send" size={18} /> {t('schedule.ctaButton')}</button>
          <button type="button" className="sa-btn is-ghost" onClick={onHome}><Icon name="home" size={18} /> {t('schedule.backHome')}</button>
        </div>
      </div>
    </div>
  )
}

function HomeScreen({ t, lang, perfil, profile, clock, punch, canClock, day, monthHours, onTab, schedule, canPos, meId, punches }) {
  const firstName = String(profile?.nome || perfil?.nome || '').trim().split(/\s+/)[0] || ''
  const today = tokyoNightKey()
  const shift = confirmedShift(schedule, punches, meId, today)
  return (
    <div className="sa-screen sa-home">
      <HomeHello firstName={firstName} lang={lang} />
      <ScheduleCta t={t} schedule={schedule} onOpen={() => onTab('schedule')} />
      <ClockCard t={t} clock={clock} punch={punch} canClock={canClock} compact shift={shift} tolerance={schedule?.data?.tolerance} today={today} />
      <QuickActions t={t} canPos={canPos} day={day} monthHours={monthHours} onTab={onTab} />
      <TonightCard t={t} day={day} onTab={onTab} />
      <ScheduleHomeCard t={t} schedule={schedule} today={today} onOpen={() => onTab('schedule')} />
    </div>
  )
}

function ClockScreen({ t, clock, punch, canClock, venue, punches, schedule, meId }) {
  const recent = clock.mine.slice(0, 12)
  const today = tokyoNightKey()
  const shift = confirmedShift(schedule, punches, meId, today)
  return (
    <div className="sa-screen">
      <h1 className="sa-title">{t('staffApp.tabClock')}</h1>
      <ClockCard t={t} clock={clock} punch={punch} canClock={canClock} shift={shift} tolerance={schedule?.data?.tolerance} today={today} />
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
  const { t, lang } = useI18n()
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
  const go = id => { setMoreOpen(false); onTab(id) }
  const canPos = canOpen('pos')
  // Next week's schedule is required: until it is sent, Home shows a clear "Send schedule" card and any other
  // feature (except the clock, the schedule itself, profile and settings) opens a gentle sheet pointing to it.
  const mustSend = !!schedule.data?.status?.mustSend
  const blocked = mustSend && !GATE_FREE.includes(screen)
  const shown = blocked ? 'hoje' : screen
  const lit = moreOpen ? 'more' : bottomTabFor(shown)
  const work = ['pos', 'mesas', 'pedidos'].includes(shown) && canOpen(shown)
  const shared = { t, lang, perfil, profile, bar, pack, missing, competence, onTab: go, punches, nightPremium, meId }
  const fab = canPos && !mustSend && !work && !['hoje', 'schedule'].includes(shown)
  const today = tokyoNightKey()

  return (
    <div className={`sa-app${work ? ' is-work' : ''}`} style={brand.color ? { '--sa-brand': brand.color } : undefined}>
      <header className="sa-top">
        <button type="button" className="sa-top-bar" onClick={() => go('hoje')} aria-label={t('staffApp.tabHome')}>
          <BarMark brand={brand} size={40} />
          <span className="sa-top-name">
            <strong>{brand.name || t('staffApp.yourBar')}</strong>
            <small>{clock.onShift ? <><span className="sa-dot is-live" /> {t('staffApp.onShift')}</> : (profile?.cargo || t('staffApp.staffLabel'))}</small>
          </span>
        </button>
        <StaffBell t={t} schedule={schedule} onNavigate={go} />
        <span className={`sa-me${clock.onShift ? ' is-on' : ''}`}>
          <Avatar name={profile?.nome || perfil?.nome} url={profile?.foto_url} size={42} onClick={() => go('profile')} label={t('employee.profile')} />
        </span>
      </header>

      <Suspense fallback={null}><div className="sa-alerts"><StaffAlerts /></div></Suspense>

      <main className="sa-main">
        {shown === 'hoje' && <HomeScreen {...shared} clock={clock} punch={punch} canClock={canClock} day={day} monthHours={monthHours} schedule={schedule} canPos={canPos} />}
        {shown === 'ponto' && <ClockScreen t={t} clock={clock} punch={punch} canClock={canClock} venue={venue} punches={punches} schedule={schedule} meId={meId} />}
        {shown === 'performance' && <PerformanceScreen {...shared} day={day} />}
        {shown === 'shifts' && <ShiftsScreen {...shared} />}
        {shown === 'salary' && <PayHubScreen {...shared} />}
        {shown === 'schedule' && <ScheduleScreen {...shared} today={today} schedule={schedule} onBack={() => go('hoje')} />}
        {shown === 'reports' && <ReportsScreen {...shared} />}
        {shown === 'profile' && <ProfileScreen {...shared} onProfile={setProfile} signOut={signOut} />}
        {shown === 'occurrences' && <OccurrencesScreen {...shared} />}
        {shown === 'settings' && <SettingsScreen {...shared} signOut={signOut} />}
        {work && (
          <div className="sa-work">
            {/* HOOK(staff-pos): the POS tab renders the staff till (pos/StaffPos: attribution + equal cast split via
                saleCredit) for bar_staff, else AtomicPos with cashier access. PortalCliente supplies it. */}
            {renderWork?.(shown)}
          </div>
        )}
        {['pos', 'mesas', 'pedidos'].includes(shown) && !canOpen(shown) && <Note>{t('barUsers.noAccessBody')}</Note>}
      </main>

      {blocked && <ScheduleGateSheet t={t} schedule={schedule} onSend={() => go('schedule')} onHome={() => go('hoje')} />}
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
