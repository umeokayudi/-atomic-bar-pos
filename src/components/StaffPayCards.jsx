import { fmtYen } from './utils'
import { hoursBetween } from '../lib/timeClock'
import { tokyoParts } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'
import { PunchGeoBadge } from './staff/ClockPunch'

function pad(n) {
  return String(n).padStart(2, '0')
}

function when(iso) {
  if (!iso) return '—'
  const p = tokyoParts(iso)
  return `${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
}

export default function StaffPayCards({ rows = [], showPay = false, nightPremium = true, onMarkPaid, onUnmarkPaid, busyId = '' }) {
  const { t } = useI18n()
  const ordered = [...rows].sort((a, b) => (b.open - a.open) || (b.pay - a.pay) || (b.hours - a.hours))
  if (!ordered.length) return <div className="desk-empty">{t('clock.noHours')}</div>
  return (
    <div className="timecards">
      <p className="desk-note">{t(nightPremium ? 'clock.nightPremiumOn' : 'clock.nightPremiumOff')}</p>
      {ordered.map(row => {
        const shifts = [...(row.shifts || [])].sort((a, b) => String(b.clockIn?.punched_at || '').localeCompare(String(a.clockIn?.punched_at || '')))
        return (
          <article key={row.id || row.staff_id || row.nome} className={`timecard${row.open ? ' is-open' : ''}`}>
            <header>
              <div>
                <strong>{row.nome}</strong>
                <em>{row.cargo || t('clock.offShift')}</em>
              </div>
              {row.open && <span className="timecard-live">{t('clock.openShift')}</span>}
            </header>
            <div className="timecard-stats">
              <div><span>{t('clock.hoursMonth')}</span><b>{row.hours}h</b></div>
              <div><span>{t('clock.lateHours')}</span><b>{row.lateHours || 0}h</b></div>
              <div><span>{t('clock.rate')}</span><b>{fmtYen(row.perHour || row.salario_hora || 0)}</b></div>
              <div><span>{t('clock.payMonth')}</span><b>{fmtYen(row.pay || 0)}</b></div>
              {row.salario_mes > 0 && <div><span>{t('clock.monthSalary')}</span><b>{fmtYen(row.salario_mes)}</b></div>}
            </div>
            {row.net != null && (
              <div className="timecard-pay">
                <div className="timecard-pay-lines">
                  <span><em>{t('payBoard.gross')}</em><b>{fmtYen(row.gross)}</b></span>
                  <span className={row.fines ? 'is-bad' : ''}><em>{t('payBoard.fines')}</em><b>{row.fines ? `−${fmtYen(row.fines)}` : fmtYen(0)}</b></span>
                  {row.advances > 0 && <span className="is-bad"><em>{t('payBoard.advances')}</em><b>−{fmtYen(row.advances)}</b></span>}
                  <span className="is-net"><em>{t('payBoard.net')}</em><b>{row.net < 0 ? `−${fmtYen(-row.net)}` : fmtYen(row.net)}</b></span>
                </div>
                {row.paid ? (
                  <div className="timecard-paid">
                    <span className="sa-chip is-ok">{t('payBoard.paidOn', { date: when(row.paid.paid_at), amount: fmtYen(row.paid.net) })}</span>
                    {onUnmarkPaid && <button type="button" className="ui-btn" disabled={busyId === row.id} onClick={() => onUnmarkPaid(row)}>{t('payBoard.undo')}</button>}
                  </div>
                ) : onMarkPaid && row.gross > 0 ? (
                  <button type="button" className="btn-primary timecard-paybtn" disabled={busyId === row.id} onClick={() => onMarkPaid(row)}>
                    {busyId === row.id ? t('common.wait') : t('payBoard.markPaid', { amount: fmtYen(row.net) })}
                  </button>
                ) : null}
              </div>
            )}
            {showPay && (
              <p className={`salary-hint is-${row.hint || 'watch'}`}>
                {t('portal.salary.sales')} {fmtYen(row.sales || 0)}
                {row.comm ? ` · ${t('portal.desk.commission')} ${fmtYen(row.comm)}` : ''}
                {' · '}
                {t(`portal.salary.hint.${row.hint || 'watch'}`, { cover: row.cover ? row.cover.toFixed(1) : '0' })}
              </p>
            )}
            {!shifts.length && <p className="desk-note">{t('clock.noShifts')}</p>}
            {!!shifts.length && (
              <table className="timecard-shifts">
                <thead>
                  <tr>
                    <th>{t('clock.in')}</th>
                    <th>{t('clock.out')}</th>
                    <th>{t('clock.hoursMonth')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((sh, i) => {
                    const start = sh.clockIn?.punched_at
                    const end = sh.clockOut?.punched_at
                    const hours = sh.open && start ? hoursBetween(start, new Date().toISOString()) : sh.hours
                    return (
                      <tr key={`${start || i}-${i}`}>
                        <td>{when(start)}<PunchGeoBadge punch={sh.clockIn} /></td>
                        <td>{sh.open ? t('clock.openShift') : when(end)}<PunchGeoBadge punch={sh.clockOut} /></td>
                        <td>{hours}h{sh.lateHours ? ` · ${t('clock.lateShort', { hours: sh.lateHours })}` : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </article>
        )
      })}
    </div>
  )
}
