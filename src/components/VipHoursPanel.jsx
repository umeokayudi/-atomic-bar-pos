import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { formatVisitDuration } from '../lib/barCrm'
import { tokyoNightKey } from '../lib/tokyo'
import { readRoomMeta, roomCost, vipDaily, vipDailyTotals, vipSettings, visitBilling, writeRoomMeta } from '../lib/vipBilling'
import { savePosSettings } from '../lib/posSettingsStore'
import { PortalKpi } from './ui/PageLayout'
import FlexChart from './ui/FlexChart'
import Icon from './ui/Icon'
import { fmtYen } from './utils'

const HOUR_CHIPS = [1, 2, 3, 4, 6]
const hrs = m => Math.round((m / 60) * 10) / 10
const fmtH = v => `${Math.round(v * 10) / 10}h`

function shortDay(key) {
  const [, m, d] = String(key).split('-')
  return `${+m}/${+d}`
}

/**
 * VIP room hours: price per hour per room, a quick cost calculator, the charge blocks the till asks about,
 * and charts of bar open hours vs. VIP hours used vs. what was paid.
 */
export default function VipHoursPanel({ bar, rooms = [], visits = [], sales = [], settings = {}, from, to, abre = 20, fecha = 5, onSaved }) {
  const { t } = useI18n()
  const cfg = vipSettings(settings)
  const [prices, setPrices] = useState(() => Object.fromEntries(rooms.map(r => [r.id, String(readRoomMeta(r.notas).hourPrice || '')])))
  const [calc, setCalc] = useState(() => Object.fromEntries(rooms.map(r => [r.id, 2])))
  const [block, setBlock] = useState(String(cfg.blockMin))
  const [warn, setWarn] = useState(String(cfg.warnMin))
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)

  const days = useMemo(() => vipDaily({ rooms, visits, sales, from, to, abre, fecha }), [rooms, visits, sales, from, to, abre, fecha])
  const tot = vipDailyTotals(days, rooms.length)
  const byRoom = rooms.map(r => {
    let usedMin = 0
    let billedMin = 0
    let fee = 0
    for (const v of visits) {
      if (v.space_id !== r.id || (v.status !== 'seated' && v.status !== 'done')) continue
      const start = new Date(v.inicio || v.criado_em || 0).getTime()
      const key = start ? tokyoNightKey(new Date(start)) : ''
      if (!key || key < from || key > to) continue
      const end = v.fim ? new Date(v.fim).getTime() : Date.now()
      usedMin += Math.max(0, Math.round((end - start) / 60000))
      const b = visitBilling(v)
      billedMin += b.billedMin
      fee += b.billedYen
    }
    return { key: r.id, label: r.nome, used: hrs(usedMin), billed: hrs(billedMin), fee }
  })

  async function savePrice(room) {
    setBusy(room.id)
    setMsg(null)
    try {
      const notas = writeRoomMeta(room.notas, { hourPrice: +prices[room.id] || 0 })
      const { error } = await supabase.from('bar_spaces').update({ notas }).eq('id', room.id)
      if (error) throw error
      setMsg({ ok: true, text: t('viph.savedPrice', { name: room.nome }) })
      onSaved?.()
    } catch (e) {
      setMsg({ ok: false, text: errText(e) })
    } finally {
      setBusy('')
    }
  }

  async function saveBlocks(e) {
    e.preventDefault()
    setBusy('blocks')
    setMsg(null)
    try {
      const row = await savePosSettings(supabase, bar.id, { vip_block_min: Math.round(+block || 120), vip_warn_min: Math.round(+warn || 15) })
      if (row?.vip_block_min == null) throw new Error(t('viph.notStored'))
      setMsg({ ok: true, text: t('viph.savedBlocks') })
      onSaved?.()
    } catch (e2) {
      setMsg({ ok: false, text: errText(e2) })
    } finally {
      setBusy('')
    }
  }

  const nightRows = days.map(d => ({
    key: d.night,
    label: shortDay(d.night),
    open: hrs(d.openMin),
    used: hrs(d.usedMin),
    billed: hrs(d.billedMin),
    waived: hrs(d.waivedMin),
    fee: d.roomFee,
    spend: d.spend,
  }))

  return (
    <section className="viph" aria-label={t('viph.title')}>
      <h2 className="vipx-h"><Icon name="clock" size={17} /> {t('viph.title')}</h2>
      <p className="desk-note">{t('viph.lead', { block: formatVisitDuration(cfg.blockMin), warn: cfg.warnMin })}</p>
      {msg && <div className={msg.ok ? 'ui-badge is-success' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}><Icon name={msg.ok ? 'ok' : 'warning'} size={15} /> {msg.text}</div>}

      <div className="viph-grid">
        {rooms.map(r => {
          const price = +prices[r.id] || 0
          const h = +calc[r.id] || 0
          return (
            <article key={r.id} className="ui-card viph-room">
              <h3>{r.nome}</h3>
              <div className="viph-row">
                <label className="ui-field"><span>{t('viph.perHour')}</span>
                  <input type="number" inputMode="numeric" min="0" step="500" value={prices[r.id] ?? ''} placeholder="0"
                    onChange={e => setPrices(p => ({ ...p, [r.id]: e.target.value }))} />
                </label>
                <button type="button" className="ui-btn" disabled={busy === r.id || String(readRoomMeta(r.notas).hourPrice || '') === String(prices[r.id] || '')} onClick={() => savePrice(r)}>
                  <Icon name="save" size={15} /> {t('common.save')}
                </button>
              </div>
              <div className="ui-field"><span>{t('viph.calcHours')}</span>
                <div className="viph-hours" role="radiogroup" aria-label={t('viph.calcHours')}>
                  {HOUR_CHIPS.map(n => (
                    <button key={n} type="button" role="radio" aria-checked={h === n} className={h === n ? 'is-on' : ''} onClick={() => setCalc(c => ({ ...c, [r.id]: n }))}>{n}h</button>
                  ))}
                  <input type="number" inputMode="decimal" min="0.5" step="0.5" style={{ width: 80 }} value={HOUR_CHIPS.includes(h) ? '' : (calc[r.id] || '')}
                    placeholder={t('viph.other')} aria-label={t('viph.other')} onChange={e => setCalc(c => ({ ...c, [r.id]: e.target.value }))} />
                </div>
              </div>
              <div className="viph-cost">
                <span>{t('viph.costFor', { hours: h || 0 })}</span>
                <strong>{price ? fmtYen(roomCost(price, h * 60)) : '—'}</strong>
              </div>
              {!price && <p className="desk-note">{t('viph.noPrice')}</p>}
            </article>
          )
        })}
        <form className="ui-card viph-room" onSubmit={saveBlocks}>
          <h3>{t('viph.blocksTitle')}</h3>
          <p className="desk-note">{t('viph.blocksHelp')}</p>
          <div className="viph-row">
            <label className="ui-field"><span>{t('viph.blockMin')}</span>
              <input type="number" inputMode="numeric" min="15" max="720" step="15" value={block} onChange={e => setBlock(e.target.value)} />
            </label>
            <label className="ui-field"><span>{t('viph.warnMin')}</span>
              <input type="number" inputMode="numeric" min="1" max="60" value={warn} onChange={e => setWarn(e.target.value)} />
            </label>
          </div>
          <button type="submit" className="ui-btn is-primary" disabled={busy === 'blocks'}><Icon name="save" size={15} /> {t('common.save')}</button>
        </form>
      </div>

      <div className="admin-kpi-grid vipx-kpis">
        <PortalKpi icon="clock" label={t('viph.kOpen')} value={formatVisitDuration(tot.openMin)} sub={t('viph.kOpenSub', { h: abre, c: fecha })} />
        <PortalKpi icon="vip" label={t('viph.kUsed')} value={`${tot.usedPct}%`} sub={t('viph.kUsedSub', { time: formatVisitDuration(tot.usedMin) })} />
        <PortalKpi icon="timer" label={t('viph.kBilled')} value={formatVisitDuration(tot.billedMin)} sub={t('viph.kWaived', { time: formatVisitDuration(tot.waivedMin) })} />
        <PortalKpi icon="coins" label={t('viph.kFee')} value={fmtYen(tot.roomFee)} sub={t('viph.kSpend', { amount: fmtYen(tot.spend) })} />
      </div>

      <div className="viph-grid">
        <section className="ui-card">
          <div className="ui-card-title">{t('viph.chartHours')}</div>
          <FlexChart
            id="vip-hours-night" neutral title={t('viph.night')} rows={nightRows} format={fmtH}
            series={[{ key: 'used', label: t('viph.sUsed') }, { key: 'open', label: t('viph.sOpen') }, { key: 'billed', label: t('viph.sBilled') }, { key: 'waived', label: t('viph.sWaived') }]}
            kinds={['columns', 'pair', 'line', 'table']} empty={t('dash.noData')}
          />
        </section>
        <section className="ui-card">
          <div className="ui-card-title">{t('viph.chartMoney')}</div>
          <FlexChart
            id="vip-money-night" title={t('viph.night')} rows={nightRows} format={fmtYen}
            series={[{ key: 'spend', label: t('viph.sSpend') }, { key: 'fee', label: t('viph.sFee') }]}
            kinds={['columns', 'line', 'pair', 'table']} empty={t('dash.noData')}
          />
        </section>
        <section className="ui-card">
          <div className="ui-card-title">{t('viph.chartRooms')}</div>
          <FlexChart
            id="vip-rooms" title={t('vip.colRoom')} rows={byRoom} format={fmtH}
            series={[{ key: 'used', label: t('viph.sUsed') }, { key: 'billed', label: t('viph.sBilled') }, { key: 'fee', label: t('viph.sFee'), format: fmtYen }]}
            kinds={['bars', 'donut', 'columns', 'table']} empty={t('dash.noData')}
          />
        </section>
      </div>
    </section>
  )
}

