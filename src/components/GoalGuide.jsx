import { useI18n } from '../lib/i18n'
import { goalGuide, goalHours } from '../lib/goalDefinitions'
import { fmtYen } from './utils'
import Icon from './ui/Icon'

/**
 * "What each goal means": target, where it stands now and how it is measured.
 * With `progress` (owner) it shows numbers; without it (staff) only the definitions.
 */
export default function GoalGuide({ progress = null, goals = {}, title, lead }) {
  const { t } = useI18n()
  const hours = goalHours(goals)
  const rows = goalGuide(progress, goals)
  return (
    <section className="ggd" aria-label={title || t('goalDef.title')}>
      <div className="ggd-head">
        <h2><Icon name="help" size={17} /> {title || t('goalDef.title')}</h2>
        <p>{lead || t('goalDef.lead')}</p>
      </div>
      <div className="ggd-list">
        {rows.map(r => {
          const width = r.pct == null ? 0 : Math.max(0, Math.min(100, r.pct))
          return (
            <article key={r.id} className={`ggd-item${r.pct != null && r.pct >= 100 ? ' is-hit' : ''}`}>
              <span className="ggd-icon" aria-hidden="true"><Icon name={r.icon} size={18} /></span>
              <div className="ggd-body">
                <div className="ggd-top">
                  <strong>{t(`goalDef.${r.id}.name`)}</strong>
                  {progress && r.id !== 'pessoa' && (
                    <span className="ggd-nums num">
                      {r.current != null ? fmtYen(r.current) : '—'}
                      {r.target ? <> / {fmtYen(r.target)}</> : <em> · {t('goalDef.noTarget')}</em>}
                    </span>
                  )}
                  {!progress && r.target > 0 && <span className="ggd-nums num">{fmtYen(r.target)}</span>}
                </div>
                {progress && r.target > 0 && r.pct != null && (
                  <div className="ggd-bar" role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100} aria-label={t(`goalDef.${r.id}.name`)}>
                    <i style={{ width: `${width}%` }} /><b>{r.pct}%</b>
                  </div>
                )}
                <p className="ggd-how">{t(`goalDef.${r.id}.how`, hours)}</p>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
