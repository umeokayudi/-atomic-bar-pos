import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../Auth'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { staffFetch } from '../../lib/apiAuth'
import { tokyoMonthKey } from '../../lib/tokyo'
import { monthRange } from '../../lib/timeClock'
import { punchGeoFlag } from '../../lib/clockGeo'
import {
  barBrand, bottomTabFor, elapsedLabel, myClockState, staffAppTabFor, staffAppTabsFor, staffMoreItemsFor,
} from '../../lib/staffApp'
import { meDay, meProfile } from '../../lib/staffSelfApi'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { useClockPunch } from './ClockPunch'
import { Avatar, Card, Note, Row, Stat, fmtDay, fmtHours, fmtTime, useNow } from './staffUi'
import { EarningsScreen, OccurrencesScreen, PerformanceScreen, ProfileScreen, ReportsScreen, SettingsScreen, ShiftsScreen } from './StaffScreens'

const StaffAlerts = lazy(() => import('../StaffAlerts'))
const BRAND_KEY = 'staff_app_brand'

/** Last bar seen by a staff login on this device: the sign-in screen shows its name and colour. */
export function readStaffBrand() {
  try {
    const raw = localStorage.getItem(BRAND_KEY)
    const b = raw ? JSON.parse(raw) : null
    return b && b.name ? b : null
  } catch {
    return null
  }
}

function rememberBrand(brand) {
  try { localStorage.setItem(BRAND_KEY, JSON.stringify({ name: brand.name, initials: brand.initials, color: brand.color, logo: brand.logo })) } catch { /* storage blocked */ }
}

function BarMark({ brand, size = 36 }) {
  return (
    <span className="sa-barmark" style={{ width: size, height: size, ...(brand.color ? { background: brand.color } : {}) }} aria-hidden="true">
      {brand.logo ? <img src={brand.logo} alt="" /> : brand.initials}
    </span>
  )
}

function greetingKey() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(new Date()))
  if (h >= 5 && h < 12) return 'employee.greetMorning'
  if (h >= 12 && h < 18) return 'employee.greetAfternoon'
  return 'employee.greetEvening'
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
      <p className="sa-clock-hint"><Icon name="location" size={13} /> {t('staffApp.gpsHint')}</p>
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

function HomeScreen({ t, perfil, profile, bar, clock, punch, canClock, day, monthHours, pack, missing, onTab }) {
  const firstName = String(profile?.nome || perfil?.nome || '').trim().split(/\s+/)[0] || ''
  const goals = (pack?.goals || []).slice(0, 3)
  return (
    <div className="sa-screen">
      <div className="sa-greet">
        <div className="sa-kicker">{fmtDay(Date.now(), { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>{t(greetingKey(), { name: firstName })}</h1>
      </div>
      <ClockCard t={t} clock={clock} punch={punch} canClock={canClock} />
      <div className="sa-wide">
        <TonightCard t={t} day={day} onTab={onTab} />
        <div className="sa-stats">
          <Stat label={t('employee.statHours')} value={fmtHours(monthHours)} sub={t('employee.thisMonth')} onClick={() => onTab('shifts')} />
          <Stat label={t('staffApp.home.tonightSales')} value={fmtYen(day?.summary?.sales || 0)} onClick={() => onTab('performance')} />
          <Stat label={t('staffApp.home.earnings')} value={t('staffApp.home.open')} onClick={() => onTab('salary')} />
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

  useEffect(() => { if (brand.name) rememberBrand(brand) }, [brand])

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
    return Math.round(h * 100) / 100
  }, [punches, meId])

  const tabs = staffAppTabsFor(canOpen)
  const moreItems = staffMoreItemsFor(canOpen)
  const lit = moreOpen ? 'more' : bottomTabFor(screen)
  const work = ['pos', 'mesas', 'pedidos'].includes(screen) && canOpen(screen)
  const go = id => { setMoreOpen(false); onTab(id) }
  const shared = { t, perfil, profile, bar, pack, missing, competence, onTab: go, punches, nightPremium, meId }

  return (
    <div className={`sa-app${work ? ' is-work' : ''}`} style={brand.color ? { '--sa-brand': brand.color } : undefined}>
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
        {screen === 'hoje' && <HomeScreen {...shared} clock={clock} punch={punch} canClock={canClock} day={day} monthHours={monthHours} />}
        {screen === 'ponto' && <ClockScreen t={t} clock={clock} punch={punch} canClock={canClock} venue={venue} punches={punches} />}
        {screen === 'performance' && <PerformanceScreen {...shared} day={day} />}
        {screen === 'shifts' && <ShiftsScreen {...shared} />}
        {screen === 'salary' && <EarningsScreen {...shared} />}
        {screen === 'reports' && <ReportsScreen {...shared} />}
        {screen === 'profile' && <ProfileScreen {...shared} onProfile={setProfile} signOut={signOut} />}
        {screen === 'occurrences' && <OccurrencesScreen {...shared} />}
        {screen === 'settings' && <SettingsScreen {...shared} signOut={signOut} />}
        {work && (
          <div className="sa-work">
            {/* HOOK(staff-pos): the mobile till, sales attribution to this staff member and cast splits are built in
                AtomicPos by another branch; the staff app only opens it here with the cashier access. */}
            {renderWork?.(screen)}
          </div>
        )}
        {['pos', 'mesas', 'pedidos'].includes(screen) && !canOpen(screen) && <Note>{t('barUsers.noAccessBody')}</Note>}
      </main>

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
