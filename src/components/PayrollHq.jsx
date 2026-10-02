import { useEffect, useState } from 'react'
import { isLocalDemo, supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { fmtYen, Empty } from './utils'
import { AdminPage, PortalKpi, PortalSurface } from './ui/PageLayout'
import { schemaMissing } from '../lib/fulfillment'
import { hqRows, statementTotals } from '../lib/payrollCore'

function competenceNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function PayrollHq() {
  const { t } = useI18n()
  const [competence, setCompetence] = useState(competenceNow())
  const [barId, setBarId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [status, setStatus] = useState('')
  const [board, setBoard] = useState(null)
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)
  const [adjust, setAdjust] = useState({ employee_id: '', bar_id: '', amount: '', description: '' })

  async function load() {
    setErr('')
    const { data, error } = await supabase.rpc('payroll_hq_board', {
      p_competence: competence,
      p_bar: barId || null,
      p_employee: employeeId || null,
      p_status: status || null,
    })
    if (error && schemaMissing(error)) {
      setMissing(true)
      return
    }
    if (error) {
      setErr(error.message)
      return
    }
    setBoard(data)
  }

  useEffect(() => { load() }, [competence, barId, employeeId, status])

  async function act(fn, args) {
    setErr('')
    const { error } = await supabase.rpc(fn, args)
    if (error) setErr(error.message)
    else load()
  }

  const lines = board?.lines || []
  const periodStatus = board?.period?.status || ''
  const rows = !status || status === periodStatus ? hqRows(lines) : []
  const totals = statementTotals(!status || status === periodStatus ? lines : [])

  return (
    <AdminPage title={t('payroll.title')}>
      {missing && <PortalSurface><Empty text={isLocalDemo ? t('common.demoBlocked') : t('employee.schemaMissing')} /></PortalSurface>}
      {err && <p>{err}</p>}
      <PortalSurface>
        <div className="bar-add-row">
          <input type="month" value={competence} onChange={e => setCompetence(e.target.value)} />
          <input placeholder={t('payroll.bar')} value={barId} onChange={e => setBarId(e.target.value)} />
          <input placeholder={t('payroll.employee')} value={employeeId} onChange={e => setEmployeeId(e.target.value)} />
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t('payroll.anyStatus')}</option>
            {['draft', 'calculated', 'approved', 'paid', 'cancelled'].map(id => (
              <option key={id} value={id}>{t(`employee.status_${id}`)}</option>
            ))}
          </select>
        </div>
        {board?.period?.id && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" onClick={() => act('payroll_transition', { p_period: board.period.id, p_status: 'approved', p_paid_on: null })}>{t('payroll.approve')}</button>
            <button type="button" onClick={() => act('payroll_transition', { p_period: board.period.id, p_status: 'paid', p_paid_on: new Date().toISOString().slice(0, 10) })}>{t('payroll.markPaid')}</button>
          </div>
        )}
        {!board?.period && (
          <button type="button" onClick={() => act('payroll_open_period', { p_competence: competence })}>{t('payroll.open')}</button>
        )}
      </PortalSurface>
      <div className="admin-kpi-grid">
        <PortalKpi label={t('employee.gross')} value={fmtYen(totals.gross)} />
        <PortalKpi label={t('employee.commission')} value={fmtYen(totals.commissions)} />
        <PortalKpi label={t('employee.bonus')} value={fmtYen(totals.bonuses + totals.rewards)} />
        <PortalKpi label={t('employee.deductions')} value={fmtYen(totals.deductions)} />
        <PortalKpi label={t('employee.net')} value={fmtYen(totals.net)} />
      </div>
      <PortalSurface title={t('payroll.people')}>
        {rows.length === 0 && <Empty text={t('employee.none')} />}
        {rows.map(row => (
          <div key={row.employeeId}>
            {row.employeeId} · {row.hours}h · {t('employee.base')} {fmtYen(row.base)} · {t('employee.gross')} {fmtYen(row.gross)} · {t('employee.net')} {fmtYen(row.net)} · {periodStatus}
          </div>
        ))}
      </PortalSurface>
      <PortalSurface title={t('payroll.adjust')}>
        <input placeholder={t('payroll.employee')} value={adjust.employee_id} onChange={e => setAdjust({ ...adjust, employee_id: e.target.value })} />
        <input placeholder={t('payroll.bar')} value={adjust.bar_id} onChange={e => setAdjust({ ...adjust, bar_id: e.target.value })} />
        <input placeholder={t('payroll.amount')} value={adjust.amount} onChange={e => setAdjust({ ...adjust, amount: e.target.value })} />
        <input placeholder={t('payroll.reason')} value={adjust.description} onChange={e => setAdjust({ ...adjust, description: e.target.value })} />
        <button
          type="button"
          disabled={!board?.period?.id}
          onClick={() => act('payroll_adjust', {
            p_period: board.period.id,
            p_employee: adjust.employee_id,
            p_bar: adjust.bar_id || null,
            p_amount: Math.round(+adjust.amount || 0),
            p_description: adjust.description,
          })}
        >{t('payroll.postAdjustment')}</button>
      </PortalSurface>
    </AdminPage>
  )
}
