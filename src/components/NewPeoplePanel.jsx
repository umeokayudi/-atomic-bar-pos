import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { tokyoNightKey } from '../lib/tokyo'
import { addDays } from '../lib/barClose'
import { nextTokyoDateKey } from '../lib/nightClose'
import { newPeopleByNight } from '../lib/walkIn'
import { PortalKpi } from './ui/PageLayout'
import FlexChart from './ui/FlexChart'
import { fmtYen } from './utils'

const RANGES = [7, 30, 90]

function nightsBack(days) {
  const to = tokyoNightKey()
  const out = []
  let cur = addDays(to, -(days - 1))
  for (let i = 0; i < days && cur <= to; i += 1) {
    out.push(cur)
    cur = nextTokyoDateKey(cur)
  }
  return out
}

/**
 * New people per night: pay-as-you-go guests (sold drink by drink at the counter, no tab) plus
 * customers added to the book that night. Also how many drinks each pay-as-you-go guest bought.
 */
export default function NewPeoplePanel({ bar }) {
  const { t } = useI18n()
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    const since = addDays(tokyoNightKey(), -(days + 1))
    Promise.all([
      supabase.from('pos_vendas').select('id,total,refunded,obs,criado_em,data').eq('bar_id', bar.id).gte('data', since).order('criado_em', { ascending: false }).limit(5000),
      supabase.from('bar_guests').select('id,criado_em').eq('bar_id', bar.id),
    ]).then(([s, g]) => {
      if (!alive) return
      if (s.error) setErr(errText(s.error))
      setData({ sales: s.data || [], guests: g.error ? [] : (g.data || []) })
    }).catch(e => { if (alive) { setErr(errText(e)); setData({ sales: [], guests: [] }) } })
    return () => { alive = false }
  }, [bar.id, days])

  if (!data) return null
  const nights = nightsBack(days)
  const { rows, totals } = newPeopleByNight({ sales: data.sales, guests: data.guests, nights, nightOf: tokyoNightKey })
  const chartRows = rows.map(r => {
    const [, m, d] = r.night.split('-')
    return { key: r.night, label: `${+m}/${+d}`, total: r.total, walk: r.walk, crm: r.crm, drinks: r.drinks }
  })

  return (
    <section className="ui-card" style={{ marginBottom: 16, display: 'grid', gap: 12 }} aria-label={t('walk.peopleTitle')}>
      <div className="np-head">
        <div>
          <div className="ui-card-title">{t('walk.peopleTitle')}</div>
          <div className="ui-card-sub">{t('walk.peopleLead')}</div>
        </div>
        <div className="fc-series" role="radiogroup" aria-label={t('walk.range')}>
          {RANGES.map(n => (
            <button key={n} type="button" role="radio" aria-checked={days === n} className={days === n ? 'is-on' : ''} onClick={() => setDays(n)}>{t('walk.days', { n })}</button>
          ))}
        </div>
      </div>
      {err && <div className="ui-error" role="alert">{err}</div>}
      <div className="admin-kpi-grid">
        <PortalKpi icon="people" label={t('walk.kNew')} value={String(totals.total)} sub={t('walk.kNewSub', { walk: totals.walk, crm: totals.crm })} />
        <PortalKpi icon="walkIn" label={t('walk.kWalk')} value={String(totals.walk)} sub={t('walk.kAvg', { n: totals.avgDrinks })} />
        <PortalKpi icon="catCocktail" label={t('walk.kDrinks')} value={String(totals.drinks)} sub={fmtYen(totals.spend)} />
      </div>
      <FlexChart
        id="new-people-night" title={t('viph.night')} rows={chartRows}
        series={[{ key: 'total', label: t('walk.sNew') }, { key: 'walk', label: t('walk.sWalk') }, { key: 'crm', label: t('walk.sCrm') }, { key: 'drinks', label: t('walk.sDrinks') }]}
        kinds={['columns', 'line', 'pair', 'table']} empty={t('dash.noData')}
      />
    </section>
  )
}
