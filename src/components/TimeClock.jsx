import { useEffect, useState } from 'react'
import { useAuth } from './Auth'
import { fmtYen, Spinner, SectionTitle } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { getTabletToken, setTabletToken, readGps } from '../lib/tabletDevice'
import { payrollFromPunches, monthRange, hoursBetween } from '../lib/timeClock'
import { canManageBarTeam } from '../lib/access'
import { useI18n } from '../lib/i18n'

function PunchKiosk({ bar, staffIdLocked, onPunched }) {
  const { t } = useI18n()
  const [roster, setRoster] = useState([])
  const [staffId, setStaffId] = useState(staffIdLocked || '')
  const [pin, setPin] = useState('')
  const [tipo, setTipo] = useState('in')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [token, setToken] = useState(() => getTabletToken(bar.id))
  const [tokenInput, setTokenInput] = useState('')

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
        <p className="clock-not-tablet">{t('clock.notThisDevice')}</p>
        <input value={tokenInput} onChange={e => setTokenInput(e.target.value.toUpperCase())} placeholder="XXXXXXXX" style={{ width: '100%', marginBottom: 10, letterSpacing: 2, fontWeight: 800 }} />
        <button className="btn-primary" onClick={pair} style={{ width: '100%', padding: 12 }}>{t('clock.pairSave')}</button>
      </div>
    )
  }

  return (
    <div className="card clock-kiosk">
      <SectionTitle>{t('clock.title')}</SectionTitle>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>{t('clock.localOnly')}</div>
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['in', 'out'].map(x => (
          <button key={x} onClick={() => setTipo(x)} style={{
            flex: 1, padding: 10, borderRadius: 10, fontWeight: 700, cursor: 'pointer',
            background: tipo === x ? 'var(--navy)' : 'var(--bg3)',
            color: tipo === x ? '#fff' : 'var(--text2)', border: 'none',
          }}>{x === 'in' ? t('clock.in') : t('clock.out')}</button>
        ))}
      </div>
      <button className="btn-primary" disabled={busy || !(staffIdLocked || staffId) || pin.length < 4} onClick={punch} style={{ width: '100%', padding: 14, fontSize: 16 }}>
        {busy ? t('common.wait') : t('clock.confirm')}
      </button>
      {msg && <div style={{ marginTop: 12, color: 'var(--green)', fontSize: 13, fontWeight: 700 }}>{msg}</div>}
      {err && <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{err}</div>}
    </div>
  )
}

function PayrollTable({ rows }) {
  const { t } = useI18n()
  if (!rows.length) return <div style={{ color: 'var(--text3)', fontSize: 13 }}>{t('clock.noHours')}</div>
  return (
    <div className="table-scroll">
    <table style={{ width: '100%', fontSize: 13 }}>
      <thead>
        <tr>
          {[t('clock.colName'), t('clock.colHours'), t('clock.colPay'), t('clock.colStatus')].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: 8 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.staff_id} style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: 8, fontWeight: 700 }}>{r.nome}<div style={{ fontSize: 11, color: 'var(--text2)' }}>{r.cargo}</div></td>
            <td>{r.hours.toFixed(2)}h</td>
            <td style={{ fontWeight: 800 }}>{fmtYen(r.pay)}</td>
            <td>{r.open ? t('clock.openShift') : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

export default function TimeClockPanel({ bar }) {
  const { perfil } = useAuth()
  const { t } = useI18n()
  const [punches, setPunches] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const range = monthRange()

  async function load() {
    setLoading(true)
    const fallbackStaff = canManageBarTeam(perfil?.role)
      ? []
      : [{ id: perfil?.id, nome: perfil?.nome, cargo: perfil?.cargo, salario_hora: perfil?.salario_hora || 0 }]
    const work = Promise.all([
      staffFetch(`/api/time-clock?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`).then(r => r.json()).catch(() => ({ punches: [] })),
      canManageBarTeam(perfil?.role)
        ? staffFetch('/api/bar-staff').then(r => r.json()).catch(() => ({ staff: [] }))
        : Promise.resolve({ staff: fallbackStaff }),
    ])
    try {
      const timed = await Promise.race([
        work,
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), 8000)),
      ])
      setPunches(timed[0].punches || [])
      setStaff(timed[1].staff || fallbackStaff)
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

  return (
    <div className="fade-in">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{t('clock.title')}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>{t('clock.subtitle')}</div>
      <div className="fluid-2 clock-layout">
        <PunchKiosk bar={bar} staffIdLocked={perfil?.role === 'bar_staff' ? perfil.id : ''} onPunched={load} />
        <div className="card">
          <SectionTitle>{t('clock.monthPay')}</SectionTitle>
          {loading ? <Spinner /> : (
            <>
              <div className="clock-not-tablet">{t('clock.notThisDevice')}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.5 }}>
                {canManageBarTeam(perfil?.role) ? t('clock.staffCostHint') : t('clock.ownPayHint')}
              </div>
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
              <PayrollTable rows={canManageBarTeam(perfil?.role) ? rows : mine} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
