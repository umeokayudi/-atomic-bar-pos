import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { crmTableMissing, formatVisitDuration, withTimeout } from '../lib/barCrm'
import { summarizeVipRooms, vipRentals } from '../lib/vipRooms'
import { DEFAULT_POS_SETTINGS } from '../lib/nightTicket'
import { peekBarTeam } from '../lib/barTeam'
import { tokyoMonthKey, tokyoNightKey } from '../lib/tokyo'
import { addDays } from '../lib/barClose'
import { monthBounds } from '../lib/barCalendar'
import { tokyoClock } from '../lib/staffDayReport'
import RangeCalendar from './RangeCalendar'
import { PageHeader, PortalKpi } from './ui/PageLayout'
import { Spinner, fmtYen } from './utils'
import Icon from './ui/Icon'

function fmtWhen(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const day = new Intl.DateTimeFormat(undefined, { timeZone: 'Asia/Tokyo', month: 'short', day: 'numeric', weekday: 'short' }).format(d)
  return `${day} ${tokyoClock(d.toISOString())}`
}

/**
 * VIP rooms in one place: which room is in use now, every use in the period with who, how long,
 * how many people, what they spent and the room minimum on the ticket, plus occupancy per room.
 * Read-only: seating guests stays on the Floor screen, charging stays on the till.
 */
export default function BarVipTab({ bar, onTab }) {
  const { t } = useI18n()
  const month = monthBounds(tokyoMonthKey())
  const [from, setFrom] = useState(month.from)
  const [to, setTo] = useState(month.to)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)
  const [room, setRoom] = useState('all')
  const [, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    async function load() {
      setErr('')
      try {
        const since = addDays(tokyoNightKey(), -120)
        const [sR, vR, salesR, setR] = await withTimeout(Promise.all([
          supabase.from('bar_spaces').select('*').eq('bar_id', bar.id).order('ordem'),
          supabase.from('bar_visits').select('id,space_id,status,party_size,inicio,fim,guest_id,pos_venda_id,host_nome,bar_guests(nome)').eq('bar_id', bar.id).order('inicio', { ascending: false }).limit(800),
          supabase.from('pos_vendas').select('id,total,space_id,visit_id,criado_em,data,obs').eq('bar_id', bar.id).gte('data', since).order('criado_em', { ascending: false }).limit(2000),
          supabase.from('pos_settings').select('room_min').eq('bar_id', bar.id).maybeSingle(),
        ]))
        if (!alive) return
        const fatal = sR.error || vR.error
        if (fatal && crmTableMissing(fatal)) { setMissing(true); setData({ spaces: [], visits: [], sales: [], roomMin: 0 }); return }
        if (fatal) setErr(errText(fatal))
        setData({
          spaces: sR.data || [],
          visits: vR.data || [],
          sales: salesR.error ? [] : (salesR.data || []),
          roomMin: +setR.data?.room_min || DEFAULT_POS_SETTINGS.room_min,
        })
      } catch (e) {
        if (alive) { setErr(errText(e)); setData({ spaces: [], visits: [], sales: [], roomMin: 0 }) }
      }
    }
    load()
    const id = setInterval(() => { setTick(n => n + 1) }, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [bar.id])

  const rooms = useMemo(() => (data?.spaces || []).filter(s => s.ativo !== false && (s.tipo === 'vip_room' || s.zona === 'vip')), [data])
  const goals = peekBarTeam()?.goals || {}
  const occupancy = data ? summarizeVipRooms({ rooms, visits: data.visits, sales: data.sales, from, to, abre: goals.abre ?? 20, fecha: goals.fecha ?? 5 }) : null
  const uses = data ? vipRentals({ rooms, visits: data.visits, sales: data.sales, from, to }) : null
  const liveByRoom = new Map((data?.visits || []).filter(v => !v.fim && (v.status === 'seated' || v.status === 'reserved')).map(v => [v.space_id, v]))

  if (!data) return <Spinner />

  const shown = (uses?.rows || []).filter(r => room === 'all' || r.roomId === room)
  const tot = uses.totals

  function download() {
    const head = [t('vip.colRoom'), t('vip.colWhen'), t('vip.colGuest'), t('vip.colHost'), t('vip.colPeople'), t('vip.colTime'), t('vip.colSpend'), t('vip.colMin')]
    const lines = shown.map(r => [r.room, fmtWhen(r.start), r.guest, r.host, r.party || '', r.minutes ? formatVisitDuration(r.minutes) : '', r.spend, r.minimum || ''])
    const csv = [head, ...lines].map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `vip-rooms-${from}-${to}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="fade-in vipx">
      <PageHeader
        title={t('vip.title')}
        subtitle={t('vip.lead')}
        actions={onTab ? <button type="button" className="ui-btn" onClick={() => onTab('espacos')}><Icon name="espacos" size={15} /> {t('vip.toFloor')}</button> : null}
      />
      {err && <div className="ui-error" role="alert"><Icon name="warning" size={16} /> {err}</div>}
      {missing && <div className="ui-card desk-note">{t('vip.missing')}</div>}

      <section className="vipx-now" aria-label={t('vip.now')}>
        <h2 className="vipx-h"><Icon name="vip" size={17} /> {t('vip.now')}</h2>
        {!rooms.length ? (
          <div className="ui-empty-state"><span className="ui-empty-icon"><Icon name="vip" size={22} /></span><p>{t('vip.noRooms')}</p></div>
        ) : (
          <div className="vipx-rooms">
            {rooms.map(r => {
              const v = liveByRoom.get(r.id)
              const mins = v && v.status === 'seated' ? Math.max(0, Math.round((Date.now() - Date.parse(v.inicio)) / 60000)) : 0
              const state = !v ? 'free' : v.status === 'reserved' ? 'reserved' : 'busy'
              return (
                <article key={r.id} className={`vipx-room is-${state}`}>
                  <header>
                    <strong>{r.nome}</strong>
                    <span className={`vipx-pill is-${state}`}>{t(`vip.state.${state}`)}</span>
                  </header>
                  <p>{t('vip.seats', { n: r.capacidade || 1 })}</p>
                  {v ? (
                    <p className="vipx-who">
                      {v.bar_guests?.nome || t('vip.walkIn')}{v.party_size ? ` · ${t('vip.people', { n: v.party_size })}` : ''}
                      {state === 'busy' && <b>{formatVisitDuration(mins)}</b>}
                      {v.host_nome && <small>{t('vip.hostBy', { name: v.host_nome })}</small>}
                    </p>
                  ) : <p className="vipx-who is-muted">{t('vip.freeNow')}</p>}
                  <footer>{t('vip.minimum')}: <b>{fmtYen(data.roomMin)}</b></footer>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <RangeCalendar from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />

      <div className="admin-kpi-grid vipx-kpis">
        <PortalKpi icon="vip" label={t('vip.kUses')} value={String(tot.uses)} sub={t('vip.kPeople', { n: tot.people })} />
        <PortalKpi icon="clock" label={t('vip.kHours')} value={formatVisitDuration(tot.minutes)} sub={t('vip.kOcc', { pct: occupancy?.totals.capacityPct ?? 0 })} />
        <PortalKpi icon="coins" label={t('vip.kSpend')} value={fmtYen(tot.spend)} sub={t('vip.kAvg', { amount: fmtYen(tot.avgSpend) })} />
        <PortalKpi icon="timer" label={t('vip.kPerHour')} value={fmtYen(tot.perHour)} sub={tot.belowMin ? t('vip.kBelow', { n: tot.belowMin }) : t('vip.kAllMin')} />
      </div>

      {occupancy?.rows.length > 0 && (
        <section className="vipx-cards" aria-label={t('vip.byRoom')}>
          {occupancy.rows.map(row => (
            <article key={row.id} className="vipx-card">
              <h3>{row.nome}</h3>
              <div className="vipx-meter" role="img" aria-label={t('vip.kOcc', { pct: row.capacityPct })}>
                <i style={{ width: `${Math.min(100, row.capacityPct)}%` }} />
              </div>
              <dl>
                <div><dt>{t('vip.kUses')}</dt><dd>{row.times}</dd></div>
                <div><dt>{t('vip.hoursOpen')}</dt><dd>{formatVisitDuration(row.minutes)}</dd></div>
                <div><dt>{t('vip.occupancy')}</dt><dd>{row.capacityPct}%</dd></div>
                <div><dt>{t('vip.kSpend')}</dt><dd>{fmtYen(row.revenue)}</dd></div>
                
              </dl>
            </article>
          ))}
        </section>
      )}

      <section className="ui-card vipx-list">
        <div className="ui-card-head">
          <div className="ui-card-title">{t('vip.uses')}</div>
          <div className="ui-row">
            {rooms.length > 1 && (
              <select value={room} onChange={e => setRoom(e.target.value)} aria-label={t('vip.colRoom')}>
                <option value="all">{t('vip.allRooms')}</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
              </select>
            )}
            <button type="button" className="ui-btn is-sm" onClick={download} disabled={!shown.length}><Icon name="download" size={15} /> CSV</button>
          </div>
        </div>
        {!shown.length ? <p className="desk-note">{t('vip.noUses')}</p> : (
          <div className="table-scroll">
            <table className="ui-table is-stack">
              <thead>
                <tr><th>{t('vip.colRoom')}</th><th>{t('vip.colWhen')}</th><th>{t('vip.colGuest')}</th><th>{t('vip.colPeople')}</th><th>{t('vip.colTime')}</th><th>{t('vip.colSpend')}</th><th>{t('vip.colMin')}</th></tr>
              </thead>
              <tbody>
                {shown.map(r => {
                  const below = r.minimum > 0 && r.spend < r.minimum
                  return (
                    <tr key={r.id}>
                      <td data-label={t('vip.colRoom')}><strong>{r.room}</strong>{r.open && <span className="vipx-pill is-busy">{t('vip.state.busy')}</span>}</td>
                      <td data-label={t('vip.colWhen')}>{fmtWhen(r.start)}{r.end && r.kind === 'visit' && !r.open ? ` – ${tokyoClock(new Date(r.end).toISOString())}` : ''}</td>
                      <td data-label={t('vip.colGuest')}>{r.guest || (r.kind === 'ticket' ? t('vip.ticketOnly') : t('vip.walkIn'))}{r.host && <small className="vipx-sub">{t('vip.hostBy', { name: r.host })}</small>}</td>
                      <td data-label={t('vip.colPeople')}>{r.party || '—'}</td>
                      <td data-label={t('vip.colTime')}>{r.minutes ? formatVisitDuration(r.minutes) : '—'}</td>
                      <td data-label={t('vip.colSpend')} className="num">{fmtYen(r.spend)}{r.perHour ? <small className="vipx-sub">{t('vip.perHourShort', { amount: fmtYen(r.perHour) })}</small> : null}</td>
                      <td data-label={t('vip.colMin')}>
                        {r.minimum > 0
                          ? <span className={`vipx-pill ${below ? 'is-warn' : 'is-ok'}`}><Icon name={below ? 'warning' : 'ok'} size={12} /> {fmtYen(r.minimum)}</span>
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="desk-note">{t('vip.howCharged', { amount: fmtYen(data.roomMin) })}</p>
      </section>
    </div>
  )
}
