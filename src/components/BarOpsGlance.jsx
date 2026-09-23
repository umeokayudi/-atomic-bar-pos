import { fmtYen } from './utils'
import { useI18n } from '../lib/i18n'
import { opsGlanceItems, OPS_KPI_ROWS } from '../lib/barOpsGlance'

export default function BarOpsGlance({ glance, onTab }) {
  const { t } = useI18n()
  if (!glance) return null
  if (glance.ready === false) {
    return (
      <div className="ops-kpis is-loading" aria-busy="true" aria-label={t('portal.home.opsTitle')}>
        <div className="ops-kpis-title">{t('portal.hq.loadingGlance')}</div>
        {OPS_KPI_ROWS.map((row, i) => (
          <div key={i} className="ops-kpis-grid" style={{ '--ops-cols': row.length }}>
            {row.map(id => (
              <div key={id} className="ops-kpi is-skel">
                <span className="ops-kpi-kicker">—</span>
                <span className="ops-kpi-value">—</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }
  const items = opsGlanceItems(glance, t, fmtYen)
  const byId = Object.fromEntries(items.map(it => [it.id, it]))
  return (
    <div className="ops-kpis" aria-label={t('portal.home.opsTitle')}>
      <div className="ops-kpis-title">{t('portal.home.opsTitle')}</div>
      {OPS_KPI_ROWS.map((row, i) => (
        <div key={i} className="ops-kpis-grid" style={{ '--ops-cols': row.length }}>
          {row.map(id => {
            const it = byId[id]
            if (!it) return null
            return (
              <button
                key={it.id}
                type="button"
                className={`ops-kpi${it.warn ? ' is-warn' : ''}`}
                onClick={() => onTab?.(it.tab)}
              >
                <span className="ops-kpi-kicker">{it.kicker}</span>
                <span className="ops-kpi-value">{it.value}</span>
                {it.hint && <span className="ops-kpi-hint">{it.hint}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
