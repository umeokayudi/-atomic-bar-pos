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

const TITLES = {
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

export default function EmployeeDesk({ section = 'salary' }) {
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

  return (
    <AdminPage
      title={t(TITLES[section] || 'employee.salary')}
      actions={
        <input type="month" value={competence} onChange={e => setCompetence(e.target.value)} />
      }
    >
      {missing && <PortalSurface><Empty text={t('employee.schemaMissing')} /></PortalSurface>}
      {err && <PortalSurface><Empty text={err} /></PortalSurface>}
      {!missing && section === 'profile' && (
        <PortalSurface title={perfil?.nome || t('employee.profile')}>
          <p>{t(`shell.roles.${perfil?.role}`) || perfil?.role}</p>
          <p>{t('employee.barsWorked')}: {clock.byBar.length ? clock.byBar.map(b => b.barId || '—').join(', ') : t('employee.none')}</p>
        </PortalSurface>
      )}
      {!missing && section === 'shifts' && (
        <PortalSurface title={t('employee.shifts')}>
          <div className="admin-kpi-grid">
            <PortalKpi label={t('employee.plannedHours')} value={`${plan.plannedHours}h`} />
            <PortalKpi label={t('employee.workedHours')} value={`${plan.workedHours}h`} />
            <PortalKpi label={t('employee.late')} value={`${plan.lateMinutes} min`} />
            <PortalKpi label={t('employee.absent')} value={String(plan.absent)} />
            <PortalKpi label={t('employee.overtimeIndicator')} value={`${plan.overtimeHours}h`} />
          </div>
          <p>{t('employee.lateNotDeducted')}</p>
        </PortalSurface>
      )}
      {!missing && section === 'clock' && (
        <PortalSurface title={t('employee.clock')}>
          <PortalKpi label={t('employee.workedHours')} value={`${clock.workedHours}h`} />
          <PortalKpi label={t('employee.nightHours')} value={`${clock.nightHours}h`} />
          {(pack?.punches || []).length === 0
            ? <Empty text={t('employee.noPunches')} />
            : (pack.punches || []).slice(0, 30).map(p => (
              <div key={p.id || p.punched_at}>{p.tipo} · {p.punched_at}</div>
            ))}
        </PortalSurface>
      )}
      {!missing && section === 'goals' && (
        <PortalSurface title={t('employee.goals')}>
          {(pack?.goals || []).length === 0 && <Empty text={t('employee.none')} />}
          {(pack?.goals || []).map(g => (
            <div key={g.id}>{g.title} · {g.actual ?? '—'} / {g.target ?? '—'}</div>
          ))}
        </PortalSurface>
      )}
      {!missing && section === 'result' && (
        <PortalSurface title={t('employee.result')}>
          <div className="admin-kpi-grid">
            <PortalKpi label={t('employee.workedHours')} value={`${clock.workedHours}h`} />
            <PortalKpi label={t('employee.points')} value={String((pack?.points || []).reduce((s, p) => s + (+p.points || 0), 0))} />
            <PortalKpi label={t('employee.rewards')} value={fmtYen((pack?.rewards || []).filter(r => r.status === 'approved' || r.status === 'posted').reduce((s, r) => s + (+r.amount || 0), 0))} />
          </div>
          {bars.map(b => (
            <div key={b.barId || 'none'}>{t('employee.barResult')} {b.barId || '—'} · {fmtYen(b.totals.net)}</div>
          ))}
        </PortalSurface>
      )}
      {!missing && section === 'points' && (
        <PortalSurface title={t('employee.points')}>
          {(pack?.points || []).length === 0 && <Empty text={t('employee.none')} />}
          {(pack?.points || []).map(p => (
            <div key={p.id}>{p.points} · {p.reason}</div>
          ))}
        </PortalSurface>
      )}
      {!missing && section === 'occurrences' && (
        <PortalSurface title={t('employee.occurrences')}>
          <p>{t('employee.occurrenceNotPay')}</p>
          {(pack?.occurrences || []).length === 0 && <Empty text={t('employee.none')} />}
          {(pack?.occurrences || []).map(o => <div key={o.id}>{o.note}</div>)}
        </PortalSurface>
      )}
      {!missing && section === 'rewards' && (
        <PortalSurface title={t('employee.rewards')}>
          {(pack?.rewards || []).length === 0 && <Empty text={t('employee.none')} />}
          {(pack?.rewards || []).map(r => (
            <div key={r.id}>{r.title} · {fmtYen(r.amount)} · {r.status}</div>
          ))}
        </PortalSurface>
      )}
      {!missing && section === 'salary' && (
        <>
          <div className="admin-kpi-grid">
            <PortalKpi label={t('employee.competence')} value={competence} />
            <PortalKpi label={t('employee.base')} value={fmtYen(totals.base)} />
            <PortalKpi label={t('employee.workedHours')} value={`${clock.workedHours}h`} />
            <PortalKpi label={t('employee.overtimeIndicator')} value={`${plan.overtimeHours}h`} />
            <PortalKpi label={t('employee.commission')} value={fmtYen(totals.commissions)} />
            <PortalKpi label={t('employee.rewards')} value={fmtYen(totals.rewards)} />
            <PortalKpi label={t('employee.advance')} value={fmtYen(-totals.advances)} />
            <PortalKpi label={t('employee.gross')} value={fmtYen(totals.gross)} />
            <PortalKpi label={t('employee.deductions')} value={fmtYen(totals.deductions)} />
            <PortalKpi label={t('employee.net')} value={fmtYen(totals.net)} />
            <PortalKpi label={t('employee.status')} value={t(`employee.status_${paymentLabel(status)}`)} />
          </div>
          <PortalSurface title={t('employee.statement')}>
            {lines.length === 0 && <Empty text={t('employee.noStatement')} />}
            {lines.map(row => (
              <div key={row.id || `${row.type}-${row.source_id}`}>
                {t(`employee.type_${row.type}`)} · {row.description} · {fmtYen(row.amount)}
                {row.source ? ` · ${row.source}${row.source_id ? ` ${row.source_id}` : ''}` : ''}
              </div>
            ))}
            <p>{t('employee.pdfLater')}</p>
          </PortalSurface>
        </>
      )}
    </AdminPage>
  )
}
