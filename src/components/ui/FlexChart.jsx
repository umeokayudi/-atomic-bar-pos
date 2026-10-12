import { useI18n } from '../../lib/i18n'
import { pickKind, useChartPref } from '../../lib/chartPrefs'
import { ColumnChart, Donut, HBarList, InOutChart, LineChart, RankList } from './Charts'
import Icon from './Icon'

const ICON = { columns: 'chartColumns', line: 'chartLine', bars: 'chartBars', donut: 'chartDonut', rank: 'chartRank', pair: 'chartPair', table: 'chartTable' }
const SINGLE = ['columns', 'line', 'bars', 'donut', 'rank']
const plain = v => String(v ?? '')

/**
 * Any chart, with a small picker so each person chooses how to see it (columns, line, bars, donut,
 * ranking, side by side, table). The choice is remembered per chart and follows the account.
 *
 * rows:   [{ label, tip?, [seriesKey]: number }]
 * series: [{ key, label, format? }] — with two or more, "side by side" compares the first two
 *         and the single-series kinds get a chip to pick which one to draw.
 * kinds:  which kinds this chart offers (first = default unless `defaultKind`).
 */
export default function FlexChart({
  id, rows = [], series = [{ key: 'value', label: '' }], kinds, defaultKind, format = plain, empty = '—',
  height = 180, highlight = 'max', ariaLabel, onPick, title, neutral = false,
}) {
  const { t } = useI18n()
  const offered = kinds || [...(series.length >= 2 ? ['pair'] : []), 'columns', 'line', 'bars', 'donut', 'table']
  const [pref, save] = useChartPref(id, defaultKind || offered[0])
  const kind = pickKind(pref.kind, offered, defaultKind)
  const s = series.find(x => x.key === pref.series) || series[0]
  const fmt = s.format || format
  const data = rows.map(r => ({ label: r.label, value: +r[s.key] || 0, tip: r.tip, key: r.key, sub: r.sub, tone: r.tone }))

  let body
  if (kind === 'pair' && series.length >= 2) {
    const [a, b] = series
    body = <InOutChart data={rows.map(r => ({ label: r.label, in: +r[a.key] || 0, out: +r[b.key] || 0 }))} format={a.format || format} labels={[a.label, b.label]} empty={empty} height={height} />
  } else if (kind === 'line') body = <LineChart data={data} format={fmt} empty={empty} height={height} />
  else if (kind === 'bars') body = <HBarList items={data} format={fmt} empty={empty} max={12} />
  else if (kind === 'donut') body = <Donut segments={data} format={fmt} empty={empty} />
  else if (kind === 'rank') body = <RankList items={data} format={fmt} empty={empty} max={8} onPick={onPick} />
  else if (kind === 'table') {
    body = rows.length ? (
      <div className="table-scroll">
        <table className="ui-table fc-table">
          <thead><tr><th>{title || ''}</th>{series.map(x => <th key={x.key} className="num">{x.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key || i}><td>{r.label}</td>{series.map(x => <td key={x.key} className="num">{(x.format || format)(+r[x.key] || 0)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : <div className="uc-empty">{empty}</div>
  } else body = <ColumnChart data={data} format={fmt} empty={empty} height={height} highlight={highlight} ariaLabel={ariaLabel} />

  const showSeries = series.length >= 2 && SINGLE.includes(kind)
  return (
    <div className={`fc${neutral ? ' is-neutral' : ''}`}>
      {(offered.length > 1 || showSeries) && (
        <div className="fc-bar">
          {showSeries && (
            <div className="fc-series" role="radiogroup" aria-label={t('chart.series')}>
              {series.map(x => (
                <button key={x.key} type="button" role="radio" aria-checked={x.key === s.key} className={x.key === s.key ? 'is-on' : ''} onClick={() => save({ series: x.key })}>{x.label}</button>
              ))}
            </div>
          )}
          <span className="ui-spacer" />
          {offered.length > 1 && (
            <div className="fc-kinds" role="radiogroup" aria-label={t('chart.type')}>
              {offered.map(k => (
                <button key={k} type="button" role="radio" aria-checked={k === kind} className={k === kind ? 'is-on' : ''}
                  title={t(`chart.kind.${k}`)} aria-label={t(`chart.kind.${k}`)} onClick={() => save({ kind: k })}>
                  <Icon name={ICON[k]} size={14} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {body}
    </div>
  )
}
