import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { Spinner, SectionTitle, fmtYen } from './utils'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import {
  SPACE_TYPES,
  tokyoFloorPreset,
  decorateSpaces,
  spacesByZone,
  zoneLabelKey,
  visitMinutes,
  formatVisitDuration,
  isStaleOpenVisit,
  staleOpenVisits,
  crmTableMissing,
  withTimeout,
} from '../lib/barCrm'
import { filterClients, placeRevenue, summarizeVipRooms } from '../lib/vipRooms'
import { peekBarTeam } from '../lib/barTeam'
import { tokyoMonthKey, tokyoNightKey } from '../lib/tokyo'
import { addDays } from '../lib/barClose'
import { monthBounds } from '../lib/barCalendar'
import RangeCalendar from './RangeCalendar'

function typeLabel(t, tipo) {
  const row = SPACE_TYPES.find(x => x.id === tipo)
  return row ? t(row.labelKey) : tipo
}

function zoneTitle(t, zona) {
  const key = zoneLabelKey(zona)
  return key ? t(key) : zona
}

export default function BarSpacesTab({ bar }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [ready, setReady] = useState(null)
  const [spaces, setSpaces] = useState([])
  const [visits, setVisits] = useState([])
  const [roomSales, setRoomSales] = useState([])
  const [members, setMembers] = useState([])
  const month = monthBounds(tokyoMonthKey())
  const [vipFrom, setVipFrom] = useState(month.from)
  const [vipTo, setVipTo] = useState(month.to)
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ nome: '', tipo: 'counter', capacidade: 1, zona: 'counter', notas: '' })
  const [seat, setSeat] = useState(null)
  const [edit, setEdit] = useState(null)
  const [guestId, setGuestId] = useState('')
  const [walkName, setWalkName] = useState('')
  const [clientQuery, setClientQuery] = useState('')
  const [party, setParty] = useState(1)
  const [hostNome, setHostNome] = useState('')
  const [seatMode, setSeatMode] = useState('seated')
  const [, setTick] = useState(0)

  async function load() {
    setLoading(true)
    setLoadErr('')
    try {
      const since = addDays(tokyoNightKey(), -120)
      const [sR, vR, gR, salesR, memberR] = await withTimeout(Promise.all([
        supabase.from('bar_spaces').select('*').eq('bar_id', bar.id).order('ordem'),
        supabase.from('bar_visits').select('id,space_id,status,party_size,inicio,fim,guest_id,pos_venda_id,host_nome,bar_guests(nome)').eq('bar_id', bar.id).order('inicio', { ascending: false }).limit(800),
        supabase.from('bar_guests').select('id,nome,telefone,line_id,preferred_host').eq('bar_id', bar.id).eq('ativo', true).order('nome'),
        supabase.from('pos_vendas').select('id,total,space_id,visit_id,guest_id,vip_member_id,criado_em,data').eq('bar_id', bar.id).gte('data', since).order('criado_em', { ascending: false }).limit(2000),
        supabase.from('vip_members').select('id,nome').eq('bar_id', bar.id).eq('ativo', true),
      ]))
      let salesRows = salesR.data || []
      if (salesR.error && /vip_member_id|guest_id/.test(salesR.error.message || '')) {
        const again = await supabase.from('pos_vendas').select('id,total,space_id,visit_id,guest_id,criado_em,data').eq('bar_id', bar.id).gte('data', since).order('criado_em', { ascending: false }).limit(2000)
        salesRows = again.error ? [] : (again.data || [])
      } else if (salesR.error) salesRows = []
      const err = sR.error || vR.error || gR.error
      if (err && crmTableMissing(err)) {
        setReady({ ready: false, error: errText(err) })
        setSpaces([])
        setVisits([])
        setGuests([])
        setRoomSales([])
        setMembers([])
      } else {
        setReady({ ready: true })
        setSpaces(sR.data || [])
        setVisits(vR.data || [])
        setGuests(gR.data || [])
        setRoomSales(salesRows)
        setMembers(memberR.error ? [] : (memberR.data || []))
        if (err) setLoadErr(errText(err))
      }
    } catch (e) {
      setReady({ ready: false, error: errText(e) })
      setLoadErr(errText(e, t('spaces.loadError')))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [bar.id])
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(id)
  }, [])

  const floor = decorateSpaces(spaces, visits)
  const zones = spacesByZone(floor)
  const seated = floor.filter(s => s.occupied).length
  const reserved = floor.filter(s => s.reserved).length
  const free = floor.filter(s => !s.occupied && !s.reserved).length
  const staleVisits = staleOpenVisits(visits)
  const goals = peekBarTeam()?.goals || {}
  const vipRooms = spaces.filter(s => s.ativo !== false && (s.tipo === 'vip_room' || s.zona === 'vip'))
  const vip = summarizeVipRooms({
    rooms: vipRooms,
    visits,
    sales: roomSales,
    from: vipFrom,
    to: vipTo,
    abre: goals.abre ?? 20,
    fecha: goals.fecha ?? 5,
  })
  const money = placeRevenue({
    spaces,
    visits,
    sales: roomSales,
    guests,
    members,
    from: vipFrom,
    to: vipTo,
  })
  const namedClients = filterClients(money.clients, clientQuery).slice(0, 12)

  async function addSpace() {
    if (!form.nome.trim()) return
    setSaving(true)
    await supabase.from('bar_spaces').insert({
      bar_id: bar.id,
      nome: form.nome.trim(),
      tipo: form.tipo,
      capacidade: +form.capacidade || 1,
      zona: form.zona || form.tipo,
      ordem: spaces.length + 1,
      notas: form.notas || null,
    })
    setForm({ nome: '', tipo: 'counter', capacidade: 1, zona: 'counter', notas: '' })
    setSaving(false)
    load()
  }

  function zonaOf(tipo) {
    if (tipo === 'vip_room') return 'vip'
    if (tipo === 'counter' || tipo === 'table') return tipo
    return tipo
  }

  async function saveEdit() {
    if (!edit?.nome.trim()) return
    setSaving(true)
    const { error } = await supabase.from('bar_spaces').update({
      nome: edit.nome.trim(),
      capacidade: Math.max(1, Math.round(+edit.capacidade || 1)),
      tipo: edit.tipo,
      zona: zonaOf(edit.tipo),
    }).eq('id', edit.id)
    setSaving(false)
    if (error) {
      setLoadErr(errText(error))
      return
    }
    setEdit(null)
    load()
  }

  async function addVipRoom() {
    const used = new Set(spaces.map(s => s.nome))
    let nome = ''
    let ordem = 40
    let capacidade = 6
    for (let i = 1; i <= 3; i++) {
      const candidate = `個室 VIP ${i}`
      if (!used.has(candidate)) {
        nome = candidate
        ordem = 39 + i
        capacidade = i === 2 ? 8 : 6
        break
      }
    }
    if (!nome) {
      const n = vipRooms.length + 1
      nome = `個室 VIP ${n}`
      ordem = 39 + n
    }
    setSaving(true)
    const { error } = await supabase.from('bar_spaces').insert({
      bar_id: bar.id,
      nome,
      tipo: 'vip_room',
      capacidade,
      zona: 'vip',
      ordem,
    })
    setSaving(false)
    if (error) {
      setLoadErr(errText(error))
      return
    }
    load()
  }

  async function seedTokyoFloor() {
    if (spaces.length) {
      setLoadErr(t('spaces.alreadyHasSpaces'))
      return
    }
    setSaving(true)
    setLoadErr('')
    await supabase.from('bar_spaces').insert(
      tokyoFloorPreset().map(s => ({ ...s, bar_id: bar.id }))
    )
    setSaving(false)
    load()
  }

  async function resolveGuestId() {
    if (guestId) return guestId
    const nome = walkName.trim()
    if (!nome) return null
    const hit = guests.find(g => String(g.nome || '').trim().toLowerCase() === nome.toLowerCase())
    if (hit) return hit.id
    const ins = await supabase.from('bar_guests').insert({ bar_id: bar.id, nome }).select('id').single()
    if (ins.error) {
      setLoadErr(errText(ins.error))
      return null
    }
    return ins.data?.id || null
  }

  async function confirmVisit() {
    if (!seat) return
    setSaving(true)
    const linkedGuest = await resolveGuestId()
    if (walkName.trim() && !linkedGuest) {
      setSaving(false)
      return
    }
    await supabase.from('bar_visits').insert({
      bar_id: bar.id,
      space_id: seat.id,
      guest_id: linkedGuest,
      status: seatMode,
      party_size: +party || 1,
      host_nome: hostNome || null,
      criado_por: user?.id,
    })
    setSeat(null)
    setGuestId('')
    setWalkName('')
    setParty(1)
    setHostNome('')
    setSeatMode('seated')
    setSaving(false)
    load()
  }

  async function freeSpace(space) {
    const visit = space.visit
    if (!visit) return
    await supabase.from('bar_visits').update({ status: 'done', fim: new Date().toISOString() }).eq('id', visit.id)
    load()
  }

  async function clearStale() {
    if (!staleVisits.length) return
    setSaving(true)
    const now = new Date().toISOString()
    await Promise.all(staleVisits.map(v =>
      supabase.from('bar_visits').update({ status: 'done', fim: now }).eq('id', v.id)
    ))
    setSaving(false)
    load()
  }

  function openSeat(space, mode) {
    const g = guests.find(x => x.id === guestId)
    setSeat(space)
    setSeatMode(mode)
    setParty(space.capacidade || 1)
    setHostNome(g?.preferred_host || '')
  }

  if (loading) return <Spinner text={t('spaces.loading')} />
  if (!ready?.ready) {
    return (
      <div className="card floor-page" style={{ padding: 20 }}>
        <SectionTitle>{t('spaces.title')}</SectionTitle>
        <p style={{ fontSize: 13, color: 'var(--text2)' }}>{asReactText(loadErr) || t('spaces.setupHint')}</p>
        <button type="button" className="btn-primary" onClick={load} style={{ marginTop: 12 }}>{t('common.retry')}</button>
      </div>
    )
  }

  return (
    <div className="fade-in floor-page">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{t('spaces.title')}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>{t('spaces.subtitle')}</div>
      {loadErr && <div className="pos-sale-err" style={{ marginBottom: 12 }}>{asReactText(loadErr)}</div>}

      {staleVisits.length > 0 && (
        <div className="floor-stale-banner">
          <div>
            <div className="floor-stale-title">{t('spaces.staleVisit')}</div>
            <div className="floor-stale-hint">{t('spaces.staleHint', { count: staleVisits.length })}</div>
          </div>
          <button type="button" className="floor-stale-btn" disabled={saving} onClick={clearStale}>
            {t('spaces.clearStale')}
          </button>
        </div>
      )}

      <RangeCalendar from={vipFrom} to={vipTo} onChange={(a, b) => { setVipFrom(a); setVipTo(b) }} />
      <p className="desk-note">{t('spaces.vip.moneyLead')}</p>
      <div className="floor-money">
        <article>
          <span>{t('spaces.vip.floorMoney')}</span>
          <b>{fmtYen(money.floor.revenue)}</b>
          <em>{money.floor.tickets}</em>
        </article>
        <article>
          <span>{t('spaces.vip.roomMoney')}</span>
          <b>{fmtYen(money.vip.revenue)}</b>
          <em>{money.vip.tickets}</em>
        </article>
        <article>
          <span>{t('spaces.vip.openMoney')}</span>
          <b>{fmtYen(money.open.revenue)}</b>
          <em>{money.open.tickets}</em>
        </article>
      </div>

      <div className="floor-kpis">
        {[
          { label: t('spaces.total'), value: floor.length },
          { label: t('spaces.seated'), value: seated, color: 'var(--navy)' },
          { label: t('spaces.reserved'), value: reserved, color: 'var(--gold, #b8860b)' },
          { label: t('spaces.free'), value: free, color: 'var(--green)' },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase' }}>{k.label}</div>
          </div>
        ))}
      </div>

      <section className="vip-rooms">
        <h2>{t('spaces.vip.title')}</h2>
        <p>{t('spaces.vip.lead', { hours: vip.totals.openLabel })}</p>
        <label className="form-label">{t('spaces.vip.clientLabel')}</label>
        <input
          value={clientQuery}
          onChange={e => setClientQuery(e.target.value)}
          placeholder={t('spaces.vip.clientLabel')}
          style={{ width: '100%', marginBottom: 6 }}
        />
        <p className="desk-note">{t('spaces.vip.clientHint')}</p>
        {!namedClients.length && <div className="house-empty">{t('spaces.vip.clientEmpty')}</div>}
        {!!namedClients.length && (
          <ul className="vip-client-list">
            {namedClients.map(row => (
              <li key={row.key}>
                <span>{row.nome}</span>
                <b>{fmtYen(row.total)}</b>
                <em>{t('spaces.vip.clientSplit', { vip: fmtYen(row.vip), floor: fmtYen(row.floor) })}</em>
              </li>
            ))}
          </ul>
        )}
        <p className="desk-note">{t('spaces.vipHave', { count: vipRooms.length })}</p>
        <button type="button" className="btn-primary" disabled={saving} onClick={addVipRoom} style={{ marginBottom: 12 }}>
          {t('spaces.addVip')}
        </button>
        {!vipRooms.length && <div className="house-empty">{t('spaces.vip.empty')}</div>}
        {!!vipRooms.length && (
          <div className="vip-room-grid">
            <article className="vip-room-card is-total">
              <h3>{t('spaces.vip.allRooms')}</h3>
              <div><span>{t('spaces.vip.times')}</span><b>{vip.totals.times}</b></div>
              <div><span>{t('spaces.vip.hours')}</span><b>{formatVisitDuration(vip.totals.minutes)}</b></div>
              <div><span>{t('spaces.vip.capacity')}</span><b>{t('spaces.vip.capacityLine', { pct: vip.totals.capacityPct, seats: vip.totals.seats })}</b></div>
              <div><span>{t('spaces.vip.revenue')}</span><b>{fmtYen(vip.totals.revenue)}</b></div>
            </article>
            {vip.rows.map(row => (
              <article key={row.id} className="vip-room-card">
                <h3>{row.nome}</h3>
                <div><span>{t('spaces.vip.times')}</span><b>{row.times}</b></div>
                <div><span>{t('spaces.vip.hours')}</span><b>{formatVisitDuration(row.minutes)}</b></div>
                <div>
                  <span>{t('spaces.vip.capacity')}</span>
                  <b>{t('spaces.vip.capacityLine', { pct: row.capacityPct, seats: row.seats })}</b>
                  <em>{t('spaces.vip.capacitySub', { party: row.partyAvg, seats: row.seats })}</em>
                </div>
                <div><span>{t('spaces.vip.revenue')}</span><b>{fmtYen(row.revenue)}</b></div>
              </article>
            ))}
          </div>
        )}
      </section>

      {!spaces.length && (
        <div className="card floor-seed" style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('spaces.seedTitle')}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>{t('spaces.seedHint')}</div>
          <button type="button" className="btn-primary" disabled={saving} onClick={seedTokyoFloor}>{t('spaces.seedBtn')}</button>
        </div>
      )}

      <div className="floor-board">
      {zones.map(z => (
        <div key={z.zona} className="floor-zone" style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {zoneTitle(t, z.zona)}
          </div>
          <div className="floor-grid">
            {z.spaces.map(s => (
              <div key={s.id} className="card floor-card" style={{
                padding: 12,
                borderColor: s.occupied ? 'var(--navy)' : s.reserved ? 'var(--gold, #b8860b)' : 'var(--border)',
                background: s.occupied ? 'rgba(26,78,138,0.06)' : 'var(--bg2)',
              }}>
                <div className="floor-card-head">
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{s.nome}</div>
                  <button type="button" className="floor-edit-btn" onClick={() => setEdit({
                    id: s.id,
                    nome: s.nome || '',
                    capacidade: s.capacidade || 1,
                    tipo: s.tipo || 'counter',
                  })}>
                    {t('spaces.editBtn')}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>
                  {typeLabel(t, s.tipo)} · {t('spaces.seats', { count: s.capacidade })}
                  {' · '}{t('spaces.vip.spaceMoney')} {fmtYen(money.spaceRevenue.get(s.id) || 0)}
                </div>
                {s.visit ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                      {s.visit.bar_guests?.nome || t('spaces.walkIn')}
                    </div>
                    {isStaleOpenVisit(s.visit) && (
                      <div className="floor-stale-badge">{t('spaces.staleVisit')}</div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>
                      {s.visit.status === 'reserved' ? t('spaces.reserved') : t('spaces.duration', { time: formatVisitDuration(visitMinutes(s.visit)) })}
                      {s.visit.party_size ? ` · ${s.visit.party_size}` : ''}
                      {s.visit.host_nome ? ` · ${s.visit.host_nome}` : ''}
                    </div>
                    <button type="button" className="floor-free-btn" onClick={() => freeSpace(s)}>
                      {t('spaces.freeBtn')}
                    </button>
                  </>
                ) : (
                  <div className="floor-card-actions">
                    <button type="button" className="btn-primary" onClick={() => openSeat(s, 'seated')}>
                      {t('spaces.seatBtn')}
                    </button>
                    <button type="button" className="floor-reserve-btn" onClick={() => openSeat(s, 'reserved')}>
                      {t('spaces.reserveBtn')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      </div>

      <div className="card" style={{ maxWidth: 480, marginTop: 8 }}>
        <SectionTitle>{t('spaces.addSpace')}</SectionTitle>
        <input placeholder={t('spaces.namePlaceholder')} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value, zona: e.target.value === 'vip_room' ? 'vip' : e.target.value })}>
            {SPACE_TYPES.map(x => <option key={x.id} value={x.id}>{t(x.labelKey)}</option>)}
          </select>
          <input type="number" min="1" value={form.capacidade} onChange={e => setForm({ ...form, capacidade: e.target.value })} />
        </div>
        <button type="button" className="btn-primary" disabled={saving} onClick={addSpace} style={{ width: '100%', padding: 10 }}>{t('spaces.saveSpace')}</button>
      </div>

      {edit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setEdit(null)}>
          <div className="card" style={{ width: '100%', maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <SectionTitle>{t('spaces.editTitle', { name: edit.nome })}</SectionTitle>
            <label className="form-label">{t('house.name')}</label>
            <input value={edit.nome} onChange={e => setEdit({ ...edit, nome: e.target.value })} style={{ width: '100%', marginBottom: 10 }} />
            <label className="form-label">{t('spaces.seats', { count: edit.capacidade || 1 })}</label>
            <input type="number" min="1" value={edit.capacidade} onChange={e => setEdit({ ...edit, capacidade: e.target.value })} style={{ width: '100%', marginBottom: 10 }} />
            <select value={edit.tipo} onChange={e => setEdit({ ...edit, tipo: e.target.value })} style={{ width: '100%', marginBottom: 12 }}>
              {SPACE_TYPES.map(x => <option key={x.id} value={x.id}>{t(x.labelKey)}</option>)}
            </select>
            <button type="button" className="btn-primary" disabled={saving} onClick={saveEdit} style={{ width: '100%', padding: 12, marginBottom: 8 }}>
              {t('spaces.editSave')}
            </button>
            <button type="button" onClick={() => setEdit(null)} style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'transparent' }}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {seat && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setSeat(null)}>
          <div className="card" style={{ width: '100%', maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <SectionTitle>{seatMode === 'reserved' ? t('spaces.reserveAt', { name: seat.nome }) : t('spaces.seatAt', { name: seat.nome })}</SectionTitle>
            <label className="form-label">{t('spaces.guestName')}</label>
            <input
              value={walkName}
              onChange={e => { setWalkName(e.target.value); setGuestId('') }}
              placeholder={t('spaces.guestName')}
              style={{ width: '100%', marginBottom: 8 }}
            />
            {walkName.trim() && (
              <p className="desk-note">
                {t('spaces.guestSpend', {
                  name: walkName.trim(),
                  amount: fmtYen((money.clients.find(c => c.nome.toLowerCase() === walkName.trim().toLowerCase()) || filterClients(money.clients, walkName)[0])?.total || 0),
                })}
              </p>
            )}
            <label className="form-label">{t('spaces.guestOptional')}</label>
            <select
              value={guestId}
              onChange={e => {
                const id = e.target.value
                setGuestId(id)
                const g = guests.find(x => x.id === id)
                setWalkName(g?.nome || '')
                if (g?.preferred_host) setHostNome(g.preferred_host)
              }}
              style={{ width: '100%', marginBottom: 10 }}
            >
              <option value="">{t('spaces.walkIn')}</option>
              {guests.map(g => <option key={g.id} value={g.id}>{g.nome}{g.line_id ? ` · LINE ${g.line_id}` : ''}</option>)}
            </select>
            <label className="form-label">{t('spaces.hostOptional')}</label>
            <input value={hostNome} onChange={e => setHostNome(e.target.value)} placeholder={t('spaces.hostPlaceholder')} style={{ width: '100%', marginBottom: 10 }} />
            <label className="form-label">{t('spaces.partySize')}</label>
            <input type="number" min="1" value={party} onChange={e => setParty(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
            <button type="button" className="btn-primary" disabled={saving} onClick={confirmVisit} style={{ width: '100%', padding: 12, marginBottom: 8 }}>
              {seatMode === 'reserved' ? t('spaces.confirmReserve') : t('spaces.confirmSeat')}
            </button>
            <button type="button" onClick={() => setSeat(null)} style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'transparent' }}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
