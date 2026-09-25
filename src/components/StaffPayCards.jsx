import { fmtYen } from './utils'
import { hoursBetween } from '../lib/timeClock'
import { tokyoParts } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'

function pad(n) {
  return String(n).padStart(2, '0')
}

function when(iso) {
  if (!iso) return '—'
  const p = tokyoParts(iso)
  return `${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
}

export default function StaffPayCards({ rows = [], showPay = false }) {
  const { t } = useI18n()
  const ordered = [...rows].sort((a, b) => (b.open - a.open) || (b.pay - a.pay) || (b.hours - a.hours))
  if (!ordered.length) return <div className="desk-empty">{t('clock.noHours')}</div>
  return (
    <div className="timecards">
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
                        <td>{when(start)}</td>
                        <td>{sh.open ? t('clock.openShift') : when(end)}</td>
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
