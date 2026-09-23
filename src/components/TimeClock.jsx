import { useEffect, useState } from 'react'
import { useAuth } from './Auth'
import { fmtYen, Spinner, SectionTitle } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { getTabletToken, setTabletToken, readGps } from '../lib/tabletDevice'
import { payrollFromPunches, monthRange, hoursBetween } from '../lib/timeClock'
import { canManageBarTeam } from '../lib/access'
import { useI18n } from '../lib/i18n'

function PunchKiosk({ bar, staffIdLocked, lastTipo, onPunched }) {
  const { t } = useI18n()
  const [roster, setRoster] = useState([])
  const [staffId, setStaffId] = useState(staffIdLocked || '')
  const [pin, setPin] = useState('')
  const suggested = lastTipo === 'in' ? 'out' : 'in'
  const [tipo, setTipo] = useState(suggested)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [token, setToken] = useState(() => getTabletToken(bar.id))
  const [tokenInput, setTokenInput] = useState('')

  useEffect(() => { setTipo(lastTipo === 'in' ? 'out' : 'in') }, [lastTipo])

  useEffect(() => {
    if (!token) return
    fetch(`/api/time-clock?roster=1&bar_id=${encodeURIComponent(bar.id)}&tabletToken=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(j => { if (j.staff) setRoster(j.staff); if (j.error) setErr(j.error) })
      .catch(e => setErr(e.message))
  }, [bar.id, token])

  function pair() {
    const code = tokenInput.trim().toUpperCase()
    if (code.length < 6) return
    setTabletToken(bar.id, code)
    setToken(code)
    setTokenInput('')
    setErr('')
  }

  async function punch() {
    setErr(''); setMsg(''); setBusy(true)
    try {
      const gps = await readGps()
      const res = await staffFetch('/api/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          bar_id: bar.id,
          staff_id: staffIdLocked || staffId,
          pin,
          tabletToken: token,
          lat: gps.lat,
          lng: gps.lng,
          accuracy: gps.accuracy,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Punch failed')
      setPin('')
      setMsg(tipo === 'in'
        ? t('clock.punchedIn', { name: json.staff?.nome || '' })
        : t('clock.punchedOut', { name: json.staff?.nome || '' }))
      onPunched?.()
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  if (!token) {
    return (
      <div className="card" style={{ maxWidth: 420 }}>
        <SectionTitle>{t('clock.pairTablet')}</SectionTitle>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{t('clock.pairHint')}</p>
        <input value={tokenInput} onChange={e => setTokenInput(e.target.value.toUpperCase())} placeholder="XXXXXXXX" style={{ width: '100%', marginBottom: 10, letterSpacing: 2, fontWeight: 800 }} />
        <button className="btn-primary" onClick={pair} style={{ width: '100%', padding: 12 }}>{t('clock.pairSave')}</button>
      </div>
    )
  }

  return (
    <div className="card clock-kiosk">
      <SectionTitle>{t('clock.title')}</SectionTitle>
      {!staffIdLocked && (
        <select value={staffId} onChange={e => setStaffId(e.target.value)} style={{ width: '100%', marginBottom: 10 }}>
          <option value="">{t('clock.selectStaff')}</option>
          {roster.map(s => <option key={s.id} value={s.id}>{s.nome}{s.cargo ? ` · ${s.cargo}` : ''}</option>)}
        </select>
      )}
      <input type="password" inputMode="numeric" readOnly placeholder={t('clock.pin')} value={pin} className="pin-display" />
      <div className="pin-pad">
        {['1','2','3','4','5','6','7','8','9','←','0','C'].map(k => (
          <button
            key={k}
            type="button"
            className="pin-key"
            onClick={() => {
              if (k === 'C') setPin('')
              else if (k === '←') setPin(p => p.slice(0, -1))
              else if (pin.length < 8) setPin(p => p + k)
            }}
          >{k}</button>
        ))}
      </div>
      <button
        className="btn-primary"
        disabled={busy || !(staffIdLocked || staffId) || pin.length < 4}
        onClick={punch}
        style={{ width: '100%', padding: 16, fontSize: 18, background: tipo === 'out' ? 'var(--navy)' : undefined }}
      >
        {busy ? t('common.wait') : (tipo === 'in' ? t('clock.bigIn') : t('clock.bigOut'))}
      </button>
      <button
        type="button"
        onClick={() => setTipo(tipo === 'in' ? 'out' : 'in')}
        style={{ width: '100%', marginTop: 8, padding: 8, border: 'none', background: 'transparent', color: 'var(--text3)', fontSize: 12, cursor: 'pointer' }}
      >
        {tipo === 'in' ? t('clock.switchOut') : t('clock.switchIn')}
      </button>
      {msg && <div style={{ marginTop: 12, color: 'var(--green)', fontSize: 13, fontWeight: 700 }}>{msg}</div>}
      {err && <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{err}</div>}
    </div>
  )
}

function PeopleFloor({ bar, staff, rows, busyId, onMark, onAdd, saving }) {
  const { t } = useI18n()
  const [nome, setNome] = useState('')
  const [rate, setRate] = useState('1200')
  const [pin, setPin] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [more, setMore] = useState(false)
  const [devices, setDevices] = useState(false)
  const [data, setData] = useState(null)
  const [tabletCode, setTabletCode] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    staffFetch('/api/bar-staff').then(r => r.json()).then(setData).catch(() => {})
  }, [bar.id])

  const working = rows.filter(r => r.open)
  const byId = Object.fromEntries(rows.map(r => [r.staff_id, r]))

  return (
    <div className="people-floor">
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>{t('clock.peopleHint')}</div>
      {working.length > 0 && (
        <div className="people-live">
          {working.map(r => (
            <span key={r.staff_id} className="people-live-chip">{r.nome} · {t('clock.openShift')}</span>
          ))}
        </div>
      )}
      <div className="card" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
        {staff.map(s => {
          const row = byId[s.id] || { hours: 0, pay: 0, open: false }
          const open = !!row.open
          return (
            <div key={s.id} className="people-row">
              <div className="people-who">
                <div className="people-avatar">{(s.nome || '?')[0]}</div>
                <div>
                  <div style={{ fontWeight: 800 }}>{s.nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>{s.cargo || s.role} · {fmtYen(s.salario_hora || 0)}/h</div>
                </div>
              </div>
              <div className="people-meta">
                <span>{(row.hours || 0).toFixed(1)}h</span>
                <span>{fmtYen(row.pay || 0)}</span>
                <span className={open ? 'people-on' : 'people-off'}>{open ? t('clock.openShift') : t('clock.offShift')}</span>
              </div>
              <button
                type="button"
                className={open ? 'people-out' : 'people-in'}
                disabled={busyId === s.id}
                onClick={() => onMark(s.id, open ? 'out' : 'in')}
              >
                {busyId === s.id ? t('common.wait') : (open ? t('clock.bigOut') : t('clock.bigIn'))}
              </button>
            </div>
          )
        })}
        {!staff.length && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 13 }}>{t('clock.noStaff')}</div>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <SectionTitle>{t('team.addPerson')}</SectionTitle>
        <div className="people-add">
          <input placeholder={t('auth.name')} value={nome} onChange={e => setNome(e.target.value)} />
          <input type="number" placeholder={t('team.hourly')} value={rate} onChange={e => setRate(e.target.value)} />
          <input inputMode="numeric" placeholder={t('clock.pin')} value={pin} onChange={e => setPin(e.target.value)} />
        </div>
        <button
          type="button"
          className="stock-from-hint"
          onClick={() => setMore(m => !m)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', margin: '8px 0' }}
        >
          {more ? t('team.hideLogin') : t('team.optionalLogin')}
        </button>
        {more && (
          <div className="people-add" style={{ marginBottom: 8 }}>
            <input placeholder="email" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" placeholder={t('auth.password')} value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        )}
        <button
          className="btn-primary"
          disabled={saving || !nome.trim()}
          onClick={() => onAdd({ nome: nome.trim(), salario_hora: +rate || 0, pin, email, password })}
          style={{ width: '100%', padding: 10 }}
        >
          {t('team.addPerson')}
        </button>
        <div className="stock-from-hint" style={{ marginTop: 8 }}>{t('team.addHint')}</div>
      </div>

      <button type="button" className="ui-prefs-toggle" style={{ maxWidth: 280, color: 'var(--text2)', borderColor: 'var(--border)' }} onClick={() => setDevices(d => !d)}>
        {t('team.localTablet')}
      </button>
      {devices && (
        <div className="card" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
            GPS: {data?.bar?.lat != null ? `${Number(data.bar.lat).toFixed(5)}, ${Number(data.bar.lng).toFixed(5)}` : t('team.gpsMissing')}
            {' · '}{data?.bar?.geofence_m || 150}m
          </div>
          {msg && <div style={{ color: 'var(--green)', fontSize: 13, marginBottom: 8 }}>{msg}</div>}
          {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{err}</div>}
          <button className="btn-primary" onClick={async () => {
            setErr(''); setMsg('')
            try {
              const gps = await readGps()
              const res = await staffFetch('/api/bar-staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'saveLocation', lat: gps.lat, lng: gps.lng, geofence_m: data?.bar?.geofence_m || 150 }),
              })
              const json = await res.json()
              if (!res.ok) throw new Error(json.error)
              setMsg(t('team.gpsSaved'))
            } catch (e) { setErr(e.message) }
          }} style={{ marginRight: 8 }}>{t('team.saveGpsHere')}</button>
          <button onClick={async () => {
            setErr('')
            const res = await staffFetch('/api/bar-staff', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'pairTablet' }),
            })
            const json = await res.json()
            if (!res.ok) setErr(json.error || 'Error')
            else { setTabletCode(json.tabletToken); setMsg(t('team.tabletReady')) }
          }} style={{ padding: '8px 14px', borderRadius: 10 }}>{t('team.newTabletCode')}</button>
          {tabletCode && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg3)', borderRadius: 10, fontSize: 22, fontWeight: 800, letterSpacing: 4 }}>
              {tabletCode}
              <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: 0, color: 'var(--text2)', marginTop: 6 }}>{t('team.codeOnce')}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TimeClockPanel({ bar }) {
  const { perfil } = useAuth()
  const { t } = useI18n()
  const [punches, setPunches] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const range = monthRange()
  const manager = canManageBarTeam(perfil?.role)

  async function load() {
    setLoading(true)
    const fallbackStaff = manager
      ? []
      : [{ id: perfil?.id, nome: perfil?.nome, cargo: perfil?.cargo, salario_hora: perfil?.salario_hora || 0 }]
    const work = Promise.all([
      staffFetch(`/api/time-clock?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`).then(r => r.json()).catch(() => ({ punches: [] })),
      manager
        ? staffFetch('/api/bar-staff').then(r => r.json()).catch(() => ({ staff: [] }))
        : Promise.resolve({ staff: fallbackStaff }),
    ])
    try {
      const timed = await Promise.race([
        work,
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), 8000)),
      ])
      const list = timed[1].staff || fallbackStaff
      setPunches(timed[0].punches || [])
      setStaff(list.length ? list : [{ id: perfil?.id, nome: perfil?.nome, cargo: perfil?.cargo, salario_hora: perfil?.salario_hora || 0, role: perfil?.role }])
    } catch {
      setPunches([])
      setStaff(fallbackStaff)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [bar.id])

  const rows = payrollFromPunches(punches, staff, range)
  const mine = rows.filter(r => r.staff_id === perfil?.id)
  const last = [...punches].filter(p => p.staff_id === perfil?.id)[0]
  const liveHours = last?.tipo === 'in' ? hoursBetween(last.punched_at, new Date().toISOString()) : 0

  async function mark(staffId, tipo) {
    setErr(''); setBusyId(staffId)
    try {
      const res = await staffFetch('/api/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, staff_id: staffId, managerMark: true, bar_id: bar.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Punch failed')
      await load()
    } catch (e) {
      setErr(e.message)
    }
    setBusyId('')
  }

  async function addPerson(form) {
    setErr(''); setSaving(true)
    const slug = String(form.nome || 'staff').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'staff'
    const email = String(form.email || '').trim() || `${slug}.${Date.now().toString(36)}@staff.atomic.bar`
    const password = form.password || `Bar#${form.pin || '2468'}${Date.now().toString(36)}`
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createStaff', role: 'bar_staff', cargo: '', ...form, email, password }),
    })
    const json = await res.json()
    if (!res.ok) setErr(json.error || 'Error')
    else await load()
    setSaving(false)
  }

  return (
    <div className="fade-in">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{manager ? t('clock.peopleTitle') : t('clock.title')}</div>
      {err && <div className="pos-sale-err" style={{ marginBottom: 12 }}>{err}</div>}
      {loading ? <Spinner /> : manager ? (
        <PeopleFloor bar={bar} staff={staff} rows={rows} busyId={busyId} onMark={mark} onAdd={addPerson} saving={saving} />
      ) : (
        <div className="fluid-2 clock-layout">
          <PunchKiosk bar={bar} staffIdLocked={perfil?.role === 'bar_staff' ? perfil.id : ''} lastTipo={last?.tipo} onPunched={load} />
          <div className="card">
            <SectionTitle>{t('clock.monthPay')}</SectionTitle>
            {perfil?.role === 'bar_staff' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('clock.hoursMonth')}</div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{(mine[0]?.hours || 0).toFixed(2)}h</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('clock.payMonth')}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>{fmtYen(mine[0]?.pay || 0)}</div>
                </div>
              </div>
            )}
            {last?.tipo === 'in' && <div style={{ fontSize: 12, color: 'var(--navy)', marginBottom: 10 }}>{t('clock.workingNow', { hours: liveHours.toFixed(2) })}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
