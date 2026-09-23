import { useEffect, useState } from 'react'
import { fmtYen, Spinner, SectionTitle } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { readGps } from '../lib/tabletDevice'
import { useI18n } from '../lib/i18n'

export default function BarTeamTab({ bar }) {
  const { t } = useI18n()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ nome: '', email: '', password: '', role: 'bar_staff', cargo: '', salario_hora: '1200', pin: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [tabletCode, setTabletCode] = useState('')

  async function load() {
    setLoading(true)
    const json = await staffFetch('/api/bar-staff').then(r => r.json())
    setData(json)
    setLoading(false)
  }

  useEffect(() => { load() }, [bar.id])

  async function createStaff() {
    setErr(''); setMsg(''); setSaving(true)
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createStaff', ...form, salario_hora: +form.salario_hora }),
    })
    const json = await res.json()
    if (!res.ok) setErr(json.error || 'Error')
    else {
      setMsg(t('team.created'))
      setForm({ nome: '', email: '', password: '', role: 'bar_staff', cargo: '', salario_hora: '1200', pin: '' })
      load()
    }
    setSaving(false)
  }

  async function pairTablet() {
    setErr(''); setSaving(true)
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pairTablet' }),
    })
    const json = await res.json()
    if (!res.ok) setErr(json.error || 'Error')
    else {
      setTabletCode(json.tabletToken)
      setMsg(t('team.tabletReady'))
      load()
    }
    setSaving(false)
  }

  async function saveHere() {
    setErr(''); setSaving(true)
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
      load()
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  async function savePin(id, pin) {
    if (!pin || pin.length < 4) return
    await staffFetch('/api/bar-staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pin }),
    })
    setMsg(t('team.pinSaved'))
  }

  if (loading) return <Spinner />

  return (
    <div className="fade-in">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{t('team.title')}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>{t('team.subtitle')}</div>

      {msg && <div style={{ color: 'var(--green)', fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <div className="fluid-2">
        <div className="card">
          <SectionTitle>{t('team.localTablet')}</SectionTitle>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
            GPS: {data?.bar?.lat != null ? `${Number(data.bar.lat).toFixed(5)}, ${Number(data.bar.lng).toFixed(5)}` : t('team.gpsMissing')}
            {' · '}{data?.bar?.geofence_m || 150}m
          </div>
          <button className="btn-primary" onClick={saveHere} disabled={saving} style={{ marginBottom: 10 }}>{t('team.saveGpsHere')}</button>
          <button onClick={pairTablet} disabled={saving} style={{ marginLeft: 8, padding: '8px 14px', borderRadius: 10 }}>{t('team.newTabletCode')}</button>
          {tabletCode && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg3)', borderRadius: 10, fontSize: 22, fontWeight: 800, letterSpacing: 4 }}>
              {tabletCode}
              <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: 0, color: 'var(--text2)', marginTop: 6 }}>{t('team.codeOnce')}</div>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>{data?.bar?.tabletPaired ? t('team.tabletPaired') : t('team.tabletNotPaired')}</div>
          <div className="stock-from-hint" style={{ marginTop: 12 }}>{t('auth.posBookmark')}</div>
          <div className="stock-from-hint">{t('auth.clockBookmark')}</div>
        </div>

        <div className="card">
          <SectionTitle>{t('team.newLogin')}</SectionTitle>
          <input placeholder={t('auth.name')} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
          <input placeholder="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
          <input type="password" placeholder={t('auth.password')} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={{ width: '100%', marginBottom: 8 }}>
            <option value="bar_staff">{t('shell.roles.bar_staff')}</option>
            <option value="caixa">{t('shell.roles.caixa')}</option>
          </select>
          <input placeholder={t('team.roleJob')} value={form.cargo} onChange={e => setForm({ ...form, cargo: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
          <input type="number" placeholder={t('team.hourly')} value={form.salario_hora} onChange={e => setForm({ ...form, salario_hora: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
          <input inputMode="numeric" placeholder={t('clock.pin')} value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value })} style={{ width: '100%', marginBottom: 10 }} />
          <button className="btn-primary" onClick={createStaff} disabled={saving} style={{ width: '100%', padding: 12 }}>{t('team.createLogin')}</button>
        </div>
      </div>

      <div className="card">
        <SectionTitle>{t('team.roster')}</SectionTitle>
        {(data?.staff || []).map(s => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13, flexWrap: 'wrap' }}>
            <div>
              <strong>{s.nome}</strong>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>{s.role} · {s.cargo || '—'} · {fmtYen(s.salario_hora)}/h</div>
            </div>
            <input placeholder="PIN" inputMode="numeric" onBlur={e => savePin(s.id, e.target.value)} style={{ width: 90 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
