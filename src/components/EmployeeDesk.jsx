import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { fmtYen, Empty } from './utils'
import { AdminPage, PortalKpi, PortalSurface } from './ui/PageLayout'
import { schemaMissing } from '../lib/fulfillment'
import {
  comparePlan,
  hoursFromPunches,
  paymentLabel,
  statementTotals,
  groupByBar,
} from '../lib/payrollCore'
import Icon from './ui/Icon'
import GoalGuide from './GoalGuide'
import StaffQuickOrder from './StaffQuickOrder'
import { personalGoalSource } from '../lib/goalDefinitions'

const TITLES = {
  hoje: 'employee.today',
  profile: 'employee.profile',
  shifts: 'employee.shifts',
  clock: 'employee.clock',
  goals: 'employee.goals',
  result: 'employee.result',
  points: 'employee.points',
  occurrences: 'employee.occurrences',
  rewards: 'employee.rewards',
  salary: 'employee.salary',
}

function competenceNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthOf(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtDay(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function goalPct(goal) {
  const target = +goal.target || 0
  if (!target) return null
  return Math.max(0, Math.min(100, Math.round(((+goal.actual || 0) / target) * 100)))
}

function sumPoints(rows) {
  return rows.reduce((s, p) => s + (+p.points || 0), 0)
}

function GoalRow({ goal, t }) {
  const pct = goalPct(goal)
  return (
    <div className="emp-goal">
      <div className="emp-goal-head">
        <strong>{goal.title}</strong>
        <span>{goal.actual ?? '—'} / {goal.target ?? '—'}</span>
      </div>
      {pct !== null && (
        <div className="emp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} className={pct >= 100 ? 'is-done' : ''} />
        </div>
      )}
      {t && <p className="emp-goal-how"><Icon name="help" size={12} /> {t(`goalDef.source.${personalGoalSource(goal)}`)}</p>}
    </div>
  )
}

function ListRow({ title, meta, value, tone }) {
  return (
    <div className="emp-row">
      <div className="emp-row-main">
        <strong>{title}</strong>
        {meta && <span>{meta}</span>}
      </div>
      {value !== undefined && <div className={`emp-row-value${tone ? ` is-${tone}` : ''}`}>{value}</div>}
    </div>
  )
}

function greetingKey() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'employee.greetMorning'
  if (h >= 12 && h < 18) return 'employee.greetAfternoon'
  return 'employee.greetEvening'
}

function TodayView({ t, perfil, bar, pack, missing, onTab, competence }) {
  const punches = [...(pack?.punches || [])].sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at))
  const last = punches[punches.length - 1]
  const onShift = last?.tipo === 'in'
  const now = Date.now()
  const nextPlan = (pack?.plans || [])
    .filter(p => new Date(p.ends_at).getTime() > now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0]
  const monthPunches = punches.filter(p => monthOf(p.punched_at) === competence)
  const monthPlans = (pack?.plans || []).filter(p => monthOf(p.starts_at) === competence)
  const clock = hoursFromPunches(monthPunches, perfil?.id)
  const plan = comparePlan(monthPlans, monthPunches, perfil?.id)
  const monthPoints = (pack?.points || []).filter(p => monthOf(p.created_at) === competence)
  const totals = statementTotals(pack?.lines || [])
  const goals = pack?.goals || []
  const recent = [
    ...(pack?.points || []).map(p => ({ id: `p-${p.id}`, at: p.created_at, title: p.reason, value: `+${p.points} pt` })),
    ...(pack?.rewards || []).filter(r => r.status !== 'cancelled').map(r => ({ id: `r-${r.id}`, at: r.created_at, title: r.title, value: fmtYen(r.amount) })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 4)

  return (
    <>
      <div className="emp-hero">
        <div>
          <div className="emp-hero-kicker">{bar?.nome || ''} · {fmtDay(now)}</div>
          <div className="emp-hero-title">{t(greetingKey(), { name: perfil?.nome || '' })}</div>
          <div className={`emp-status${onShift ? ' is-on' : ''}`}>
            <span className="emp-dot" />
            {onShift ? t('employee.onShiftSince', { time: fmtTime(last.punched_at) }) : t('employee.offShift')}
          </div>
          <div className="emp-hero-sub">
            {nextPlan
              ? `${t('employee.nextShift')}: ${fmtDay(nextPlan.starts_at)} ${fmtTime(nextPlan.starts_at)}–${fmtTime(nextPlan.ends_at)}`
              : t('employee.noNextShift')}
          </div>
        </div>
        <button type="button" className="emp-hero-cta" onClick={() => onTab?.('ponto')}>
          {onShift ? t('employee.clockOutCta') : t('employee.clockInCta')}
        </button>
      </div>

      <div className="emp-quick">
        <button type="button" onClick={() => onTab?.('pos')}><Icon name="pos" size={18} />{t('employee.openTill')}</button>
        <button type="button" onClick={() => onTab?.('pedidos')}><Icon name="tasks" size={18} />{t('nav.myTasks')}</button>
        <button type="button" onClick={() => onTab?.('shifts')}><Icon name="shifts" size={18} />{t('nav.myShifts')}</button>
        <button type="button" onClick={() => onTab?.('salary')}><Icon name="salary" size={18} />{t('nav.mySalary')}</button>
      </div>

      <StaffQuickOrder bar={bar} perfil={perfil} onTab={onTab} />

      {missing ? (
        <PortalSurface><Empty text={t('employee.schemaMissing')} /></PortalSurface>
      ) : (
        <>
          <div className="emp-section-label">{t('employee.thisMonth')}</div>
          <div className="admin-kpi-grid" style={{ marginBottom: 16 }}>
            <PortalKpi label={t('employee.workedHours')} value={`${clock.workedHours}h`} sub={plan.plannedHours ? `${t('employee.plannedHours')}: ${plan.plannedHours}h` : undefined} />
            <PortalKpi label={t('employee.pointsMonth')} value={String(sumPoints(monthPoints))} />
            <PortalKpi label={t('employee.late')} value={`${plan.lateMinutes} min`} color={plan.lateMinutes ? 'var(--red)' : undefined} />
            <PortalKpi label={t('employee.netSoFar')} value={fmtYen(totals.net)} color="var(--green)" onClick={() => onTab?.('salary')} />
          </div>
          <div className="emp-two">
            <PortalSurface title={t('employee.goals')} headerRight={goals.length > 3 ? <button type="button" className="emp-link" onClick={() => onTab?.('goals')}>{t('employee.seeAll')}</button> : null}>
              {goals.length === 0 ? <Empty text={t('employee.noGoals')} icon="🎯" /> : goals.slice(0, 3).map(g => <GoalRow key={g.id} goal={g} t={t} />)}
            </PortalSurface>
            <PortalSurface title={t('employee.recent')}>
              {recent.length === 0
                ? <Empty text={t('employee.noRecent')} icon="⭐" />
                : recent.map(r => <ListRow key={r.id} title={r.title} meta={fmtDay(r.at)} value={r.value} tone="good" />)}
            </PortalSurface>
          </div>
        </>
      )}
    </>
  )
}

export default function EmployeeDesk({ section = 'salary', bar, onTab }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const [competence, setCompetence] = useState(competenceNow())
  const [pack, setPack] = useState(null)
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setErr('')
    supabase.rpc('payroll_my_pack', { p_competence: competence }).then(({ data, error }) => {
      if (cancelled) return
      if (error && schemaMissing(error)) {
        setMissing(true)
        return
      }
      if (error) {
        setErr(error.message)
        return
      }
      setPack(data || null)
    })
    return () => { cancelled = true }
  }, [competence])

  const lines = pack?.lines || []
  const totals = statementTotals(lines)
  const clock = hoursFromPunches(pack?.punches || [], perfil?.id)
  const plan = comparePlan(pack?.plans || [], pack?.punches || [], perfil?.id)
  const status = pack?.period?.status || 'draft'
  const bars = groupByBar(lines)
  const barName = id => (id && bar?.id === id ? bar.nome : id || '—')
  const byNewest = (rows, key = 'created_at') => [...rows].sort((a, b) => new Date(b[key]) - new Date(a[key]))
  const plans = [...(pack?.plans || [])].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  const upcoming = plans.filter(p => new Date(p.ends_at).getTime() > Date.now())
  const pastPlans = plans.filter(p => new Date(p.ends_at).getTime() <= Date.now() && monthOf(p.starts_at) === competence)

  return (
    <AdminPage
      title={section === 'hoje' ? null : t(TITLES[section] || 'employee.salary')}
      actions={section === 'hoje' ? null : (
        <input type="month" value={competence} onChange={e => setCompetence(e.target.value)} />
      )}
    >
      {err && <PortalSurface><Empty text={err} /></PortalSurface>}
      {section === 'hoje' && (
        <TodayView t={t} perfil={perfil} bar={bar} pack={pack} missing={missing} onTab={onTab} competence={competence} />
      )}
      {missing && section !== 'hoje' && <PortalSurface><Empty text={t('employee.schemaMissing')} /></PortalSurface>}
      {!missing && section === 'profile' && (
        <PortalSurface>
          <div className="emp-profile">
            <div className="emp-avatar">{(perfil?.nome || perfil?.email || '?').slice(0, 1).toUpperCase()}</div>
            <div>
              <div className="emp-hero-title" style={{ fontSize: 22 }}>{perfil?.nome || t('employee.profile')}</div>
              <div className="emp-hero-sub">{t(`shell.roles.${perfil?.role}`) || perfil?.role}{perfil?.cargo && perfil.cargo !== perfil.role ? ` · ${perfil.cargo}` : ''}</div>
              {perfil?.email && <div className="emp-hero-sub">{perfil.email}</div>}
            </div>
          </div>
          <ListRow title={t('employee.barsWorked')} value={clock.byBar.length ? clock.byBar.map(b => barName(b.barId)).join(', ') : t('employee.none')} />
          {bar?.nome && <ListRow title={t('employee.homeBar')} value={bar.nome} />}
        </PortalSurface>
      )}
      {!missing && section === 'shifts' && (
        <>
          <div className="admin-kpi-grid" style={{ marginBottom: 16 }}>
            <PortalKpi label={t('employee.plannedHours')} value={`${plan.plannedHours}h`} />
            <PortalKpi label={t('employee.workedHours')} value={`${plan.workedHours}h`} />
            <PortalKpi label={t('employee.late')} value={`${plan.lateMinutes} min`} />
            <PortalKpi label={t('employee.absent')} value={String(plan.absent)} />
            <PortalKpi label={t('employee.overtimeIndicator')} value={`${plan.overtimeHours}h`} />
          </div>
          <PortalSurface title={t('employee.upcomingShifts')}>
            {upcoming.length === 0 && <Empty text={t('employee.noNextShift')} icon="🗓️" />}
            {upcoming.map(p => (
              <ListRow key={p.id} title={fmtDay(p.starts_at)} meta={barName(p.bar_id)} value={`${fmtTime(p.starts_at)}–${fmtTime(p.ends_at)}`} />
            ))}
          </PortalSurface>
          {pastPlans.length > 0 && (
            <PortalSurface title={t('employee.pastShifts')}>
              {pastPlans.map(p => (
                <ListRow key={p.id} title={fmtDay(p.starts_at)} meta={barName(p.bar_id)} value={`${fmtTime(p.starts_at)}–${fmtTime(p.ends_at)}`} />
              ))}
            </PortalSurface>
          )}
          <p className="emp-note">{t('employee.lateNotDeducted')}</p>
        </>
      )}
      {!missing && section === 'clock' && (
        <PortalSurface title={t('employee.clock')}>
          <div className="admin-kpi-grid" style={{ marginBottom: 12 }}>
            <PortalKpi label={t('employee.workedHours')} value={`${clock.workedHours}h`} />
            <PortalKpi label={t('employee.nightHours')} value={`${clock.nightHours}h`} />
          </div>
          {(pack?.punches || []).length === 0
            ? <Empty text={t('employee.noPunches')} />
            : byNewest(pack.punches, 'punched_at').slice(0, 30).map(p => (
              <ListRow key={p.id || p.punched_at} title={fmtDay(p.punched_at)} meta={barName(p.bar_id)} value={`${p.tipo === 'in' ? t('employee.punchIn') : t('employee.punchOut')} ${fmtTime(p.punched_at)}`} tone={p.tipo === 'in' ? 'good' : undefined} />
            ))}
        </PortalSurface>
      )}
      {!missing && section === 'goals' && (
        <PortalSurface title={t('employee.goals')}>
          {(pack?.goals || []).length === 0 && <Empty text={t('employee.noGoals')} icon="🎯" />}
          {(pack?.goals || []).map(g => <GoalRow key={g.id} goal={g} t={t} />)}
        </PortalSurface>
      )}
      {section === 'goals' && <GoalGuide title={t('goalDef.staffTitle')} lead={t('goalDef.staffLead')} />}
      {!missing && section === 'result' && (
        <>
          <div className="admin-kpi-grid" style={{ marginBottom: 16 }}>
            <PortalKpi label={t('employee.workedHours')} value={`${clock.workedHours}h`} />
            <PortalKpi label={t('employee.points')} value={String(sumPoints(pack?.points || []))} />
            <PortalKpi label={t('employee.rewards')} value={fmtYen((pack?.rewards || []).filter(r => r.status === 'approved' || r.status === 'posted').reduce((s, r) => s + (+r.amount || 0), 0))} />
            <PortalKpi label={t('employee.net')} value={fmtYen(totals.net)} color="var(--green)" />
          </div>
          <PortalSurface title={t('employee.barResult')}>
            {bars.length === 0 && <Empty text={t('employee.none')} />}
            {bars.map(b => (
              <ListRow key={b.barId || 'none'} title={barName(b.barId)} value={fmtYen(b.totals.net)} />
            ))}
          </PortalSurface>
        </>
      )}
      {!missing && section === 'points' && (
        <PortalSurface title={t('employee.points')} headerRight={<strong className="emp-total">{sumPoints(pack?.points || [])} pt</strong>}>
          {(pack?.points || []).length === 0 && <Empty text={t('employee.none')} icon="⭐" />}
          {byNewest(pack?.points || []).map(p => (
            <ListRow key={p.id} title={p.reason} meta={fmtDay(p.created_at)} value={`${+p.points > 0 ? '+' : ''}${p.points} pt`} tone={+p.points >= 0 ? 'good' : 'bad'} />
          ))}
        </PortalSurface>
      )}
      {!missing && section === 'occurrences' && (
        <PortalSurface title={t('employee.occurrences')} sub={t('employee.occurrenceNotPay')}>
          {(pack?.occurrences || []).length === 0 && <Empty text={t('employee.none')} icon="📝" />}
          {byNewest(pack?.occurrences || []).map(o => <ListRow key={o.id} title={o.note} meta={fmtDay(o.created_at)} />)}
        </PortalSurface>
      )}
      {!missing && section === 'rewards' && (
        <PortalSurface title={t('employee.rewards')}>
          {(pack?.rewards || []).length === 0 && <Empty text={t('employee.none')} icon="🏅" />}
          {byNewest(pack?.rewards || []).map(r => (
            <ListRow
              key={r.id}
              title={r.title}
              meta={`${fmtDay(r.created_at)} · ${t(`employee.reward_${r.status}`)}`}
              value={fmtYen(r.amount)}
              tone={r.status === 'cancelled' ? 'muted' : 'good'}
            />
          ))}
        </PortalSurface>
      )}
      {!missing && section === 'salary' && (
        <>
          <div className="emp-pay-hero">
            <div>
              <div className="emp-hero-kicker">{t('employee.net')} · {competence}</div>
              <div className="emp-pay-net">{fmtYen(totals.net)}</div>
              <div className="emp-hero-sub">{t('employee.gross')} {fmtYen(totals.gross)} · {t('employee.deductions')} {fmtYen(totals.deductions)}</div>
            </div>
            <span className={`emp-pill is-${paymentLabel(status)}`}>{t(`employee.status_${paymentLabel(status)}`)}</span>
          </div>
          <div className="admin-kpi-grid" style={{ marginBottom: 16 }}>
            <PortalKpi label={t('employee.base')} value={fmtYen(totals.base)} />
            <PortalKpi label={t('employee.workedHours')} value={`${clock.workedHours}h`} />
            <PortalKpi label={t('employee.overtimeIndicator')} value={`${plan.overtimeHours}h`} />
            <PortalKpi label={t('employee.commission')} value={fmtYen(totals.commissions)} />
            <PortalKpi label={t('employee.rewards')} value={fmtYen(totals.rewards)} />
            <PortalKpi label={t('employee.advance')} value={fmtYen(-totals.advances)} />
          </div>
          <PortalSurface title={t('employee.statement')}>
            {lines.length === 0 && <Empty text={t('employee.noStatement')} />}
            {lines.map(row => (
              <ListRow
                key={row.id || `${row.type}-${row.source_id}`}
                title={t(`employee.type_${row.type}`)}
                meta={[row.description, row.source ? `${row.source}${row.source_id ? ` ${row.source_id}` : ''}` : ''].filter(Boolean).join(' · ')}
                value={fmtYen(row.amount)}
                tone={+row.amount < 0 ? 'bad' : undefined}
              />
            ))}
            <p className="emp-note">{t('employee.pdfLater')}</p>
          </PortalSurface>
        </>
      )}
    </AdminPage>
  )
}
