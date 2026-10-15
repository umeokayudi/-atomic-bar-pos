import { useEffect, useState } from 'react'
import { useAuth } from './Auth'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { payrollFromPunches, monthRange, hoursBetween, clockStaff } from '../lib/timeClock'
import { canManageBarTeam } from '../lib/access'
import { loadBarTeam } from '../lib/barTeam'
import StaffDayReport from './StaffDayReport'
import { PageHeader } from './ui/PageLayout'
import StaffPayCards from './StaffPayCards'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { supabase } from '../lib/supabase'
import { canAccess } from '../lib/barAccess'
import { prevTokyoDateKey } from '../lib/nightClose'
import { meDay } from '../lib/staffSelfApi'
import { useClockPunch } from './staff/ClockPunch'
import { OwnerDayReports, OwnerLocation } from './staff/OwnerStaffTools'
import OwnerSchedule from './staff/OwnerSchedule'

const SALE_COLS = 'id,total,refunded,criado_em,data,obs,metodo_pagamento,drink_back_agent_id,criado_por'
const SALE_COLS_SLIM = 'id,total,criado_em,data,obs,metodo_pagamento,drink_back_agent_id,criado_por'

/** Till tickets of the month (with who rang them up) and the drink-back agents, for the day report's sales credit. */
async function loadReportSales(barId, fromDay) {
  try {
    const from = prevTokyoDateKey(fromDay)
    let r = await supabase.from('pos_vendas').select(SALE_COLS).eq('bar_id', barId).gte('data', from).order('criado_em')
    if (r.error && /refunded/.test(r.error.message || '')) {
      r = await supabase.from('pos_vendas').select(SALE_COLS_SLIM).eq('bar_id', barId).gte('data', from).order('criado_em')
    }
    const a = await supabase.from('drink_back_agents').select('*').eq('bar_id', barId)
    return { tickets: r.error ? [] : (r.data || []), agents: a.error ? [] : (a.data || []) }
  } catch {
    return { tickets: [], agents: [] }
  }
}

export async function postClockMark({ barId, staffId, tipo, managerMark, position, geoError, justification, extra }) {
  const res = await staffFetch('/api/time-clock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tipo,
      staff_id: staffId,
      managerMark: !!managerMark,
      bar_id: barId,
      ...(position ? { lat: position.lat, lng: position.lng, accuracy: position.accuracy } : {}),
      ...(geoError ? { geo_error: geoError } : {}),
      ...(justification ? { justification } : {}),
      ...(extra || {}),
    }),
  })
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { error: text.slice(0, 160) } }
  if (!res.ok) {
    const err = new Error(errText(json.error, json.message || `Clock failed (${res.status})`))
    err.code = json.code || ''
    err.geoStatus = json.geo_status || ''
    err.distance = json.distance_m ?? null
    throw err
  }
  return json
}

export default function TimeClockPanel({ bar, onOpenStaff }) {
  const { perfil } = useAuth()
  const { t } = useI18n()
  const [punches, setPunches] = useState([])
  const [staff, setStaff] = useState([])
  const [nightPremium, setNightPremium] = useState(true)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [venue, setVenue] = useState(null)
  const [teamBar, setTeamBar] = useState(null)
  const [day, setDay] = useState(null)
  const [sales, setSales] = useState({ tickets: [], agents: [] })
  const range = monthRange()
  const manager = canManageBarTeam(perfil?.role)

  async function load() {
    setLoading(true)
    try {
      const [j, team] = await Promise.all([
        staffFetch(`/api/time-clock?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`).then(r => r.json()),
        manager ? loadBarTeam().catch(() => null) : Promise.resolve(null),
      ])
      setPunches(j.punches || [])
      setVenue(j.venue || null)
      setTeamBar(team?.bar || null)
      setStaff(clockStaff(team?.staff))
      const fromTeam = team?.goals?.adicional_noturno
      const flag = fromTeam == null ? j.adicional_noturno : fromTeam
      setNightPremium(flag !== false)
    } catch {
      setPunches([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [bar.id])
  useEffect(() => {
    let live = true
    loadReportSales(bar.id, range.from.slice(0, 10)).then(r => { if (live) setSales(r) })
    if (perfil?.role !== 'cliente') meDay().then(d => { if (live) setDay(d) }).catch(() => {})
    return () => { live = false }
  }, [bar.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const meId = perfil?.id
  const rows = payrollFromPunches(punches, [{ id: meId, nome: perfil?.nome, salario_hora: perfil?.salario_hora || 0 }], range, { nightPremium })
  const meRow = rows.find(r => r.staff_id === meId) || { hours: 0, pay: 0, open: false }
  const last = [...punches].filter(p => p.staff_id === meId)[0]
  const liveHours = last?.tipo === 'in' ? hoursBetween(last.punched_at, new Date().toISOString()) : 0

  // Same check-in / check-out flow as the staff app: GPS (reason when outside), read-and-agree, day summary.
  // The owner's own marks are not geo-checked by the server, so the owner skips the GPS step.
  const punch = useClockPunch({
    barId: bar.id,
    meId,
    venue: perfil?.role === 'cliente' ? null : venue,
    day,
    openIn: last?.tipo === 'in' ? { at: last.punched_at, id: last.id } : null,
    onDone: () => load(),
  })

  return (
    <div className="fade-in">
      <PageHeader title={t('clock.title')} subtitle={t('clock.selfHint')} />
      {(err || punch.err) && <div className="pos-sale-err" style={{ marginBottom: 12 }}>{asReactText(err || punch.err)}</div>}
      {punch.sheet}
      {loading ? <Spinner /> : clockStaff([perfil]).length > 0 && (
        <div className="card people-me">
          <div>
            <div className="people-me-kicker">{t('clock.you')}</div>
            <div className="people-me-name">{perfil?.nome}</div>
            <div className="people-me-sub">
              {meRow.open ? t('clock.openShift') : t('clock.offShift')}
              {' · '}{(meRow.hours || 0).toFixed(1)}h · {fmtYen(meRow.pay || 0)}
              {meRow.open && liveHours > 0 ? ` · ${t('clock.workingNow', { hours: liveHours.toFixed(1) })}` : ''}
            </div>
          </div>
          <button
            type="button"
            className={meRow.open ? 'people-out people-me-btn' : 'people-in people-me-btn'}
            disabled={!meId || punch.busy}
            onClick={() => { setErr(''); punch.start(meRow.open ? 'out' : 'in') }}
          >
            {punch.busy ? t('common.wait') : (meRow.open ? t('clock.bigOut') : t('clock.bigIn'))}
          </button>
        </div>
      )}
      {manager && !loading && (
        <div style={{ marginTop: 16 }}>
          <OwnerSchedule />
        </div>
      )}
      {manager && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{t('clock.teamTitle')}</div>
          <StaffPayCards rows={payrollFromPunches(punches, staff, range, { nightPremium })} nightPremium={nightPremium} />
        </div>
      )}
      {!loading && (
        <div style={{ marginTop: 16 }}>
          <StaffDayReport
            onlyId={manager ? undefined : meId}
            staff={manager ? staff : [{ id: meId, nome: perfil?.nome, salario_hora: perfil?.salario_hora || 0 }]}
            punches={punches}
            tickets={sales.tickets}
            agents={sales.agents}
            nightPremium={nightPremium}
          />
        </div>
      )}
      {manager && !loading && (
        <div className="own-tools">
          <OwnerLocation bar={teamBar || venue && { lat: venue.lat, lng: venue.lng, geofence_m: venue.radius_m }} canEdit={canAccess(perfil, 'users')} onSaved={load} />
          <OwnerDayReports />
        </div>
      )}
      {manager && onOpenStaff && (
        <button type="button" className="people-add-link" onClick={() => onOpenStaff()}>
          {t('clock.openStaffLogins')}
        </button>
      )}
    </div>
  )
}
