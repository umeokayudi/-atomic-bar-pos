import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { fmtYen, Empty } from './utils'
import { AdminPage, PortalKpi, PortalSurface } from './ui/PageLayout'
import { schemaMissing } from '../lib/fulfillment'
import { hqRows, statementTotals } from '../lib/payrollCore'

const STAFF_ROLES = ['gerente', 'caixa', 'bar_staff', 'funcionario']

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
  const [bars, setBars] = useState([])
  const [people, setPeople] = useState([])

  // Pick bars and people by name; the board still filters by id.
  useEffect(() => {
    supabase.from('bars').select('id,nome').order('nome').then(({ data }) => setBars(data || []))
    supabase.from('perfis').select('id,nome,email,bar_id,role').in('role', STAFF_ROLES).order('nome')
      .then(({ data }) => setPeople(data || []))
  }, [])

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
  const nameOf = id => people.find(p => p.id === id)?.nome || lines.find(l => l.employee_id === id)?.nome || t('payroll.unknownPerson')
  const pickPeople = barId ? people.filter(p => p.bar_id === barId) : people
  const statusText = periodStatus ? t(`employee.status_${periodStatus}`) : ''

  return (
    <AdminPage title={t('payroll.title')} subtitle={t('payroll.subtitle')}>
      {missing && <PortalSurface><Empty text={t('employee.schemaMissing')} /></PortalSurface>}
      {err && <div className="ui-error" role="alert">{err}</div>}
      <PortalSurface>
        <div className="bar-add-row">
          <label className="payroll-filter">{t('payroll.month')}<input type="month" value={competence} onChange={e => setCompetence(e.target.value)} /></label>
          <label className="payroll-filter">{t('payroll.bar')}<select value={barId} onChange={e => { setBarId(e.target.value); setEmployeeId('') }}>
            <option value="">{t('payroll.allBars')}</option>
            {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select></label>
          <label className="payroll-filter">{t('payroll.employee')}<select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">{t('payroll.allPeople')}</option>
            {pickPeople.map(p => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
          </select></label>
          <label className="payroll-filter">{t('payroll.status')}<select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t('payroll.anyStatus')}</option>
            {['draft', 'calculated', 'approved', 'paid', 'cancelled'].map(id => (
              <option key={id} value={id}>{t(`employee.status_${id}`)}</option>
            ))}
          </select></label>
        </div>
        {board?.period?.id && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
            <span className="ui-muted">{t('payroll.periodStatus', { status: statusText })}</span>
            <button type="button" onClick={() => act('payroll_transition', { p_period: board.period.id, p_status: 'approved', p_paid_on: null })}>{t('payroll.approve')}</button>
            <button type="button" onClick={() => act('payroll_transition', { p_period: board.period.id, p_status: 'paid', p_paid_on: new Date().toISOString().slice(0, 10) })}>{t('payroll.markPaid')}</button>
          </div>
        )}
        {!board?.period && !missing && (
          <button type="button" style={{ marginTop: 12 }} onClick={() => act('payroll_open_period', { p_competence: competence })}>{t('payroll.open')}</button>
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
        {rows.length > 0 && (
          <div className="table-scroll">
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th>{t('payroll.person')}</th>
                  <th style={{ textAlign: 'right' }}>{t('payroll.hours')}</th>
                  <th style={{ textAlign: 'right' }}>{t('employee.base')}</th>
                  <th style={{ textAlign: 'right' }}>{t('employee.gross')}</th>
                  <th style={{ textAlign: 'right' }}>{t('employee.net')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.employeeId}>
                    <td>{nameOf(row.employeeId)}</td>
                    <td style={{ textAlign: 'right' }}>{row.hours}h</td>
                    <td style={{ textAlign: 'right' }}>{fmtYen(row.base)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtYen(row.gross)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtYen(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PortalSurface>
      <PortalSurface title={t('payroll.adjust')}>
        <div className="bar-add-row">
          <label className="payroll-filter">{t('payroll.employee')}<select value={adjust.employee_id} onChange={e => setAdjust({ ...adjust, employee_id: e.target.value })}>
            <option value="">{t('payroll.pickPerson')}</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
          </select></label>
          <label className="payroll-filter">{t('payroll.bar')}<select value={adjust.bar_id} onChange={e => setAdjust({ ...adjust, bar_id: e.target.value })}>
            <option value="">{t('payroll.noBar')}</option>
            {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select></label>
          <label className="payroll-filter">{t('payroll.amount')}<input type="number" inputMode="numeric" placeholder="¥" value={adjust.amount} onChange={e => setAdjust({ ...adjust, amount: e.target.value })} /></label>
          <label className="payroll-filter">{t('payroll.reason')}<input placeholder={t('payroll.reason')} value={adjust.description} onChange={e => setAdjust({ ...adjust, description: e.target.value })} /></label>
        </div>
        {!board?.period?.id && <p className="ui-muted" style={{ marginTop: 8 }}>{t('payroll.openFirst')}</p>}
        <button
          type="button"
          className="btn-primary"
          style={{ marginTop: 12 }}
          disabled={!board?.period?.id || !adjust.employee_id || !Math.round(+adjust.amount || 0)}
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
