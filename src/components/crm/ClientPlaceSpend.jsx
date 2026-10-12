import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtYen } from '../utils'
import { useI18n } from '../../lib/i18n'
import { filterClients, placeRevenue } from '../../lib/vipRooms'
import { tokyoMonthKey, tokyoNightKey } from '../../lib/tokyo'
import { addDays } from '../../lib/barClose'
import { monthBounds } from '../../lib/barCalendar'
import RangeCalendar from '../RangeCalendar'

/** CRM: what each client spent in a period, split between VIP rooms and the floor (moved here from Seating). */
export default function ClientPlaceSpend({ bar }) {
  const { t } = useI18n()
  const month = monthBounds(tokyoMonthKey())
  const [from, setFrom] = useState(month.from)
  const [to, setTo] = useState(month.to)
  const [query, setQuery] = useState('')
  const [data, setData] = useState({ spaces: [], visits: [], sales: [], guests: [], members: [] })

  useEffect(() => {
    let alive = true
    const since = addDays(tokyoNightKey(), -120)
    Promise.all([
      supabase.from('bar_spaces').select('*').eq('bar_id', bar.id),
      supabase.from('bar_visits').select('id,space_id,status,party_size,inicio,fim,guest_id,pos_venda_id,host_nome,bar_guests(nome)').eq('bar_id', bar.id).order('inicio', { ascending: false }).limit(800),
      supabase.from('pos_vendas').select('id,total,space_id,visit_id,guest_id,vip_member_id,criado_em,data').eq('bar_id', bar.id).gte('data', since).order('criado_em', { ascending: false }).limit(2000),
      supabase.from('bar_guests').select('id,nome').eq('bar_id', bar.id),
      supabase.from('vip_members').select('id,nome').eq('bar_id', bar.id).eq('ativo', true),
    ]).then(async ([sR, vR, salesR, gR, mR]) => {
      let sales = salesR.data || []
      if (salesR.error) {
        const again = await supabase.from('pos_vendas').select('id,total,space_id,visit_id,guest_id,criado_em,data').eq('bar_id', bar.id).gte('data', since).limit(2000)
        sales = again.data || []
      }
      if (alive) setData({ spaces: sR.data || [], visits: vR.data || [], sales, guests: gR.data || [], members: mR.data || [] })
    }).catch(() => {})
    return () => { alive = false }
  }, [bar.id])

  const money = placeRevenue({ ...data, sales: data.sales, from, to })
  const rows = filterClients(money.clients, query).slice(0, 12)

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{t('spaces.vip.clientTitle')}</div>
      <RangeCalendar from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('spaces.vip.clientLabel')}
        style={{ width: '100%', margin: '8px 0 6px' }}
      />
      <p className="desk-note">{t('spaces.vip.clientHint')}</p>
      {!rows.length && <div className="house-empty">{t('spaces.vip.clientEmpty')}</div>}
      {!!rows.length && (
        <ul className="vip-client-list">
          {rows.map(row => (
            <li key={row.key}>
              <span>{row.nome}</span>
              <b>{fmtYen(row.total)}</b>
              <em>{t('spaces.vip.clientSplit', { vip: fmtYen(row.vip), floor: fmtYen(row.floor) })}</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
