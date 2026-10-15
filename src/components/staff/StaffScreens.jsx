import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../Auth'
import { supabase } from '../../lib/supabase'
import { staffFetch } from '../../lib/apiAuth'
import { comparePlan } from '../../lib/payrollCore'
import { monthRange, pairPunches } from '../../lib/timeClock'
import { punchGeoFlag } from '../../lib/clockGeo'
import { earningsRange } from '../../lib/staffNight'
import { shiftMonthKey, tokyoDateKey, tokyoMonthKey } from '../../lib/tokyo'
import { meEarnings, meRequests, meSendRequest, meUploadPhoto } from '../../lib/staffSelfApi'
import { fileToSquareJpeg } from '../../lib/imageSquare'
import { listMyOrders } from '../../lib/staffOrders'
import { errText } from '../../lib/errText'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { LanguageToggle, ThemeToggle } from '../UiPrefsPanel'
import { Avatar, Card, Note, Row, Stat, fmtDay, fmtHours, fmtTime } from './staffUi'

const byNewest = (rows, key = 'created_at') => [...(rows || [])].sort((a, b) => String(b[key] || '').localeCompare(String(a[key] || '')))
const sumPoints = rows => (rows || []).reduce((s, p) => s + (+p.points || 0), 0)

function MonthNav({ t, value, onChange }) {
  const now = tokyoMonthKey()
  const [y, m] = value.split('-').map(Number)
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <div className="sa-monthnav">
      <button type="button" className="sa-icon-btn" onClick={() => onChange(shiftMonthKey(value, -1))} aria-label={t('staffApp.prev')}><Icon name="back" size={18} /></button>
      <strong>{label}</strong>
      <button type="button" className="sa-icon-btn" disabled={value >= now} onClick={() => onChange(shiftMonthKey(value, 1))} aria-label={t('staffApp.next')}><Icon name="next" size={18} /></button>
    </div>
  )
}

function usePack(competence, initial, initialMissing, current) {
  const [pack, setPack] = useState(current === competence ? initial : null)
  const [missing, setMissing] = useState(current === competence ? initialMissing : false)
  useEffect(() => {
    if (competence === current) { setPack(initial); setMissing(initialMissing); return undefined }
    let live = true
    supabase.rpc('payroll_my_pack', { p_competence: competence }).then(({ data, error }) => {
      if (!live) return
      if (error) { setMissing(true); setPack(null); return }
      setMissing(false)
      setPack(data && typeof data === 'object' ? data : null)
    }, () => { if (live) setMissing(true) })
    return () => { live = false }
  }, [competence, current, initial, initialMissing])
  return { pack, missing }
}

function useEarnings(from, to) {
  const [state, setState] = useState({ loading: true, data: null, err: '' })
  useEffect(() => {
    let live = true
    setState(s => ({ ...s, loading: true, err: '' }))
    meEarnings(from, to)
      .then(data => { if (live) setState({ loading: false, data, err: '' }) })
      .catch(e => { if (live) setState({ loading: false, data: null, err: errText(e) }) })
    return () => { live = false }
  }, [from, to])
  return state
}

// ── Performance: goals, sales, points, rewards ───────────────────────────────
export function PerformanceScreen({ t, pack, missing, day }) {
  const range = earningsRange('month', tokyoDateKey())
  const month = useEarnings(range.from, range.to)
  const goals = pack?.goals || []
  const points = byNewest(pack?.points)
  const rewards = byNewest(pack?.rewards)
  const approved = rewards.filter(r => r.status === 'approved' || r.status === 'posted').reduce((s, r) => s + (+r.amount || 0), 0)
  const g = day?.goal || {}
  return (
    <div className="sa-screen">
      <h1 className="sa-title">{t('staffApp.tabPerformance')}</h1>
      <div className="sa-stats">
        <Stat label={t('staffApp.perf.salesMonth')} value={month.data ? fmtYen(month.data.totals.sales) : '—'} sub={month.data ? t('staffApp.out.tickets', { n: month.data.totals.tickets }) : ''} />
        <Stat label={t('staffApp.perf.commission')} value={month.data ? fmtYen(month.data.totals.commission) : '—'} tone="good" />
        <Stat label={t('employee.statPoints')} value={missing ? '—' : String(sumPoints(points))} />
      </div>
      <Card title={t('staffApp.home.tonight')}>
        {g.target > 0 ? (
          <div className="sa-goal">
            <div className="sa-goal-head"><span>{t('staffApp.brief.myGoal')}</span><b>{fmtYen(day?.summary?.sales || 0)} / {fmtYen(g.target)}</b></div>
            <div className="sa-bar"><div style={{ width: `${g.pct || 0}%` }} className={g.reached ? 'is-done' : ''} /></div>
            {g.week > 0 && <p className="sa-muted">{t('staffApp.perf.weekGoal', { amount: fmtYen(g.week) })}</p>}
          </div>
        ) : <Note icon="goals">{t('staffApp.home.noPersonalGoal')}</Note>}
        {day?.summary?.drinkBackCount > 0 && <Row title={t('staffApp.out.drank')} value={String(day.summary.drinkBackCount)} />}
      </Card>
      <div className="sa-wide">
        <Card title={t('employee.goals')}>
          {missing ? <Note>{t('staffApp.payrollSoon')}</Note> : goals.length === 0 ? <Note icon="goals">{t('employee.noGoals')}</Note> : goals.map(goal => {
            const pct = +goal.target ? Math.max(0, Math.min(100, Math.round(((+goal.actual || 0) / +goal.target) * 100))) : null
            return (
              <div key={goal.id} className="sa-goal">
                <div className="sa-goal-head"><span>{goal.title}</span><b>{goal.actual ?? '—'} / {goal.target ?? '—'}</b></div>
                {pct !== null && <div className="sa-bar"><div style={{ width: `${pct}%` }} className={pct >= 100 ? 'is-done' : ''} /></div>}
              </div>
            )
          })}
        </Card>
        <Card title={t('employee.points')} right={missing ? null : <b className="sa-pill">{sumPoints(points)} pt</b>}>
          {missing ? <Note>{t('staffApp.payrollSoon')}</Note> : points.length === 0 ? <Note icon="points">{t('employee.none')}</Note> : points.slice(0, 20).map(p => (
            <Row key={p.id} title={p.reason} meta={fmtDay(p.created_at)} value={`${+p.points > 0 ? '+' : ''}${p.points} pt`} tone={+p.points >= 0 ? 'good' : 'bad'} />
          ))}
        </Card>
        <Card title={t('employee.rewards')} right={missing ? null : <b className="sa-pill">{fmtYen(approved)}</b>}>
          {missing ? <Note>{t('staffApp.payrollSoon')}</Note> : rewards.length === 0 ? <Note icon="rewards">{t('employee.none')}</Note> : rewards.slice(0, 20).map(r => (
            <Row key={r.id} title={r.title} meta={`${fmtDay(r.created_at)} · ${t(`employee.reward_${r.status}`)}`} value={fmtYen(r.amount)} tone={r.status === 'cancelled' ? 'muted' : 'good'} />
          ))}
        </Card>
      </div>
    </div>
  )
}

// ── Shifts: planned schedule + my punch history ──────────────────────────────
export function ShiftsScreen({ t, pack: currentPack, missing: currentMissing, competence: current, meId }) {
  const [month, setMonth] = useState(current)
  const { pack, missing } = usePack(month, currentPack, currentMissing, current)
  const [punches, setPunches] = useState(null)
  useEffect(() => {
    let live = true
    setPunches(null)
    const r = monthRange(`${month}-01`)
    staffFetch(`/api/time-clock?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`)
      .then(res => res.json())
      .then(j => { if (live) setPunches((j?.punches || []).filter(p => p.staff_id === meId)) })
      .catch(() => { if (live) setPunches([]) })
    return () => { live = false }
  }, [month, meId])
  const shifts = useMemo(() => pairPunches(punches || []).sort((a, b) => String(b.clockIn?.punched_at || '').localeCompare(String(a.clockIn?.punched_at || ''))), [punches])
  const worked = shifts.reduce((s, sh) => s + (sh.open ? 0 : +sh.hours || 0), 0)
  const plans = [...(pack?.plans || [])].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  const plan = comparePlan(plans, punches || [], meId)
  const upcoming = plans.filter(p => new Date(p.ends_at).getTime() > Date.now())
  return (
    <div className="sa-screen">
      <h1 className="sa-title">{t('staffApp.more.shifts')}</h1>
      <MonthNav t={t} value={month} onChange={setMonth} />
      <div className="sa-stats">
        <Stat label={t('employee.workedHours')} value={fmtHours(worked)} />
        <Stat label={t('employee.plannedHours')} value={missing ? '—' : fmtHours(plan.plannedHours)} />
        <Stat label={t('employee.late')} value={missing ? '—' : `${plan.lateMinutes}m`} tone={plan.lateMinutes ? 'bad' : undefined} />
      </div>
      <div className="sa-wide">
        <Card title={t('employee.upcomingShifts')}>
          {missing ? <Note>{t('staffApp.payrollSoon')}</Note> : upcoming.length === 0 ? <Note icon="shifts">{t('employee.noNextShift')}</Note> : upcoming.map(p => (
            <Row key={p.id} title={fmtDay(p.starts_at)} value={`${fmtTime(p.starts_at)}–${fmtTime(p.ends_at)}`} />
          ))}
        </Card>
        <Card title={t('staffApp.shifts.history')}>
          {punches == null && <Note>{t('common.wait')}</Note>}
          {punches != null && !shifts.length && <Note icon="clock">{t('clock.noShifts')}</Note>}
          {shifts.map((sh, i) => {
            const flags = [punchGeoFlag(sh.clockIn), punchGeoFlag(sh.clockOut)].filter(Boolean)
            return (
              <Row
                key={sh.clockIn?.id || i}
                title={fmtDay(sh.clockIn?.punched_at)}
                meta={`${fmtTime(sh.clockIn?.punched_at)} – ${sh.open ? t('staffApp.onShift') : fmtTime(sh.clockOut?.punched_at)}`}
                value={sh.open ? <span className="sa-chip is-ok">{t('staffApp.onShift')}</span> : fmtHours(sh.hours)}
              >
                {flags.map((f, k) => (
                  <span key={k} className={`sa-chip is-${f.status}`}>{f.status === 'outside' ? t('staffApp.geo.badgeOutside', { distance: f.distance ?? '?' }) : t('staffApp.geo.badgeNoGps')}</span>
                ))}
              </Row>
            )
          })}
        </Card>
      </div>
      <p className="sa-muted">{t('employee.lateNotDeducted')}</p>
    </div>
  )
}

// ── Reports & requests to the owner ──────────────────────────────────────────
const REQUEST_TYPES = ['problem', 'request', 'stock', 'other']

export function ReportsScreen({ t }) {
  const { user } = useAuth()
  const [list, setList] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [tipo, setTipo] = useState('problem')
  const [texto, setTexto] = useState('')
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const file = useRef(null)

  function load() {
    meRequests().then(j => setList(j.requests || [])).catch(() => setList([]))
    if (user?.id) listMyOrders(supabase, user.id).then(r => setAlerts(r.orders || [])).catch(() => setAlerts([]))
  }
  useEffect(load, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try { setPhoto(await fileToSquareJpeg(f, { size: 900, quality: 0.8 })) } catch (x) { setErr(errText(x)) }
  }

  async function send() {
    setBusy(true); setErr(''); setMsg('')
    try {
      await meSendRequest({ tipo, texto: texto.trim(), ...(photo ? { foto: { contentType: photo.contentType, data: photo.data } } : {}) })
      setTexto(''); setPhoto(null); setMsg(t('staffApp.req.sent'))
      load()
    } catch (x) {
      setErr(errText(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sa-screen">
      <h1 className="sa-title">{t('staffApp.more.reports')}</h1>
      <Card title={t('staffApp.req.new')}>
        <div className="sa-chips" role="radiogroup" aria-label={t('staffApp.req.type')}>
          {REQUEST_TYPES.map(id => (
            <button key={id} type="button" role="radio" aria-checked={tipo === id} className={tipo === id ? 'is-on' : ''} onClick={() => setTipo(id)}>{t(`staffApp.req.type_${id}`)}</button>
          ))}
        </div>
        <label className="sa-field">
          <span>{t('staffApp.req.text')}</span>
          <textarea rows={3} maxLength={800} value={texto} onChange={e => setTexto(e.target.value)} placeholder={t('staffApp.req.placeholder')} />
        </label>
        {photo && (
          <div className="sa-photo-prev"><img src={photo.preview} alt="" /><button type="button" className="sa-link" onClick={() => setPhoto(null)}>{t('staffApp.req.removePhoto')}</button></div>
        )}
        <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
        <div className="sa-actions">
          <button type="button" className="sa-btn" onClick={() => file.current?.click()} disabled={busy}><Icon name="image" size={18} /> {t('staffApp.req.addPhoto')}</button>
          <button type="button" className="sa-btn is-primary" onClick={send} disabled={busy || texto.trim().length < 3}><Icon name="send" size={18} /> {busy ? t('common.wait') : t('staffApp.req.send')}</button>
        </div>
        {msg && <p className="sa-ok" role="status">{msg}</p>}
        {err && <div className="sa-error" role="alert">{err}</div>}
      </Card>
      <div className="sa-wide">
        <Card title={t('staffApp.req.alerts')}>
          {alerts.length === 0 ? <Note icon="bell">{t('staffApp.req.noAlerts')}</Note> : alerts.map(o => (
            <Row key={o.id} title={o.mensagem} meta={`${o.from_nome || ''} · ${fmtDay(o.criado_em)} ${fmtTime(o.criado_em)}`} value={o.prioridade === 'urgent' ? <span className="sa-chip is-outside">!</span> : ''} />
          ))}
        </Card>
        <Card title={t('staffApp.req.mine')}>
          {list == null && <Note>{t('common.wait')}</Note>}
          {list != null && list.length === 0 && <Note icon="send">{t('staffApp.req.none')}</Note>}
          {(list || []).map(r => (
            <Row key={r.id} title={r.texto} meta={`${t(`staffApp.req.type_${r.tipo}`)} · ${fmtDay(r.criado_em)} ${fmtTime(r.criado_em)}`} value={<span className={`sa-chip is-req-${r.status}`}>{t(`staffApp.req.status_${r.status}`)}</span>}>
              {r.foto_url ? <img className="sa-req-photo" src={r.foto_url} alt="" /> : null}
              {r.answer ? <em className="sa-reason">{t('staffApp.req.answer', { who: r.answered_by || '' })} {r.answer}</em> : null}
            </Row>
          ))}
        </Card>
      </div>
    </div>
  )
}

// ── Profile, occurrences, settings ───────────────────────────────────────────
export function ProfileScreen({ t, perfil, profile, bar, onProfile, signOut, onTab }) {
  const file = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function pick(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true); setErr('')
    try {
      const img = await fileToSquareJpeg(f, { size: 480, quality: 0.82 })
      const j = await meUploadPhoto({ contentType: img.contentType, data: img.data })
      onProfile?.({ ...(profile || {}), foto_url: j.foto_url || img.preview })
    } catch (x) {
      setErr(errText(x))
    } finally {
      setBusy(false)
    }
  }
  const name = profile?.nome || perfil?.nome || ''
  return (
    <div className="sa-screen">
      <section className="sa-profile">
        <Avatar name={name} url={profile?.foto_url} size={112} />
        <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
        <button type="button" className="sa-btn" onClick={() => file.current?.click()} disabled={busy}><Icon name="image" size={18} /> {busy ? t('common.wait') : t('staffApp.me.editPhoto')}</button>
        {err && <div className="sa-error" role="alert">{err}</div>}
        <h1>{name}</h1>
        <p>{[profile?.cargo || perfil?.cargo, bar?.nome].filter(Boolean).join(' · ')}</p>
      </section>
      <Card title={t('staffApp.me.details')}>
        <Row title={t('staffApp.me.email')} value={profile?.email || perfil?.email || '—'} />
        {profile?.telefone && <Row title={t('staffApp.me.phone')} value={profile.telefone} />}
        <Row title={t('employee.homeBar')} value={bar?.nome || '—'} />
      </Card>
      <div className="sa-list-links">
        <button type="button" onClick={() => onTab('occurrences')}><Icon name="occurrences" size={20} /> <span>{t('staffApp.more.occurrences')}</span> <Icon name="next" size={16} /></button>
        <button type="button" onClick={() => onTab('settings')}><Icon name="settings" size={20} /> <span>{t('staffApp.more.settings')}</span> <Icon name="next" size={16} /></button>
      </div>
      <button type="button" className="sa-btn is-ghost sa-signout" onClick={signOut}><Icon name="signOut" size={18} /> {t('common.signOut')}</button>
    </div>
  )
}

export function OccurrencesScreen({ t, pack, missing }) {
  const rows = byNewest(pack?.occurrences)
  return (
    <div className="sa-screen">
      <h1 className="sa-title">{t('staffApp.more.occurrences')}</h1>
      <Card>
        {missing ? <Note>{t('staffApp.payrollSoon')}</Note> : rows.length === 0 ? <Note icon="occurrences">{t('employee.none')}</Note> : rows.map(o => (
          <Row key={o.id} title={o.note} meta={fmtDay(o.created_at)} />
        ))}
      </Card>
      <p className="sa-muted">{t('employee.occurrenceNotPay')}</p>
    </div>
  )
}

export function SettingsScreen({ t, signOut }) {
  return (
    <div className="sa-screen">
      <h1 className="sa-title">{t('staffApp.more.settings')}</h1>
      <Card title={t('shell.appearance')}>
        <div className="sa-settings">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </Card>
      <button type="button" className="sa-btn is-ghost sa-signout" onClick={signOut}><Icon name="signOut" size={18} /> {t('common.signOut')}</button>
    </div>
  )
}
