import { useEffect, useState } from 'react'
import { useAuth } from './Auth'
import { fmtYen, Spinner, SectionTitle } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { payrollFromPunches, monthRange } from '../lib/timeClock'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { postClockMark } from './TimeClock'

export default function BarTeamTab({ bar }) {
  const { perfil } = useAuth()
  const { t } = useI18n()
  const [staff, setStaff] = useState([])
  const [punches, setPunches] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [err, setErr] = useState('')
  const [created, setCreated] = useState(null)
  const [form, setForm] = useState({ nome: '', email: '', password: '', salario_hora: '1200' })
  const range = monthRange()

  async function load() {
    setLoading(true)
    try {
      const [team, clock] = await Promise.all([
        staffFetch('/api/bar-staff').then(r => r.json()),
        staffFetch(`/api/time-clock?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`).then(r => r.json()),
      ])
      if (team.error) setErr(errText(team.error))
      setStaff(team.staff || [])
      setPunches(clock.punches || [])
    } catch (e) {
      setErr(errText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [bar.id])

  const rows = payrollFromPunches(punches, staff, range)
  const byId = Object.fromEntries(rows.map(r => [r.staff_id, r]))

  async function createLogin() {
    setErr(''); setCreated(null); setSaving(true)
    const email = String(form.email || '').trim().toLowerCase()
    const password = String(form.password || '')
    if (!form.nome.trim() || !email || password.length < 6) {
      setErr(t('team.loginRequired'))
      setSaving(false)
      return
    }
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createStaff',
        role: 'bar_staff',
        nome: form.nome.trim(),
        email,
        password,
        salario_hora: +form.salario_hora || 0,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error, t('team.createFailed')))
    else {
      setCreated({ email: json.email || email, password: json.password || password, nome: json.nome || form.nome })
      setForm({ nome: '', email: '', password: '', salario_hora: '1200' })
      await load()
    }
    setSaving(false)
  }

  async function mark(staffId, tipo) {
    setErr(''); setBusyId(staffId)
    try {
      await postClockMark({ barId: bar.id, staffId, tipo, managerMark: true })
      await load()
    } catch (e) {
      setErr(errText(e))
    }
    setBusyId('')
  }

  return (
    <div className="fade-in">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{t('team.title')}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, maxWidth: 560 }}>{t('team.subtitle')}</div>
      {err && <div className="pos-sale-err" style={{ marginBottom: 12 }}>{asReactText(err)}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <SectionTitle>{t('team.newLogin')}</SectionTitle>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{t('team.addHint')}</p>
        <div className="people-add" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <input placeholder={t('auth.name')} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
          <input type="number" placeholder={t('team.hourly')} value={form.salario_hora} onChange={e => setForm({ ...form, salario_hora: e.target.value })} />
          <input type="email" placeholder={t('auth.email')} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input type="text" autoComplete="new-password" placeholder={t('auth.password')} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        </div>
        <button className="btn-primary" disabled={saving} onClick={createLogin} style={{ marginTop: 8, padding: '10px 16px' }}>
          {saving ? t('common.wait') : t('team.createLogin')}
        </button>
        {created && (
          <div className="created-login">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>{t('team.createdOnce')}</div>
            <div>{t('auth.email')}: <strong>{created.email}</strong></div>
            <div>{t('auth.password')}: <strong>{created.password}</strong></div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>{t('team.staffCanDo')}</div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0' }}>
          <SectionTitle>{t('team.manualClock')}</SectionTitle>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>{t('team.manualHint')}</p>
        </div>
        {loading ? <div style={{ padding: 16 }}><Spinner /></div> : (
          <>
            {staff.filter(s => s.id !== perfil?.id).map(s => {
              const row = byId[s.id] || { hours: 0, pay: 0, open: false }
              const open = !!row.open
              return (
                <div key={s.id} className="people-row">
                  <div className="people-who">
                    <div className="people-avatar">{(s.nome || '?')[0]}</div>
                    <div>
                      <div style={{ fontWeight: 800 }}>{s.nome}</div>
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>{s.email || s.cargo || s.role} · {fmtYen(s.salario_hora || 0)}/h</div>
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
                    onClick={() => mark(s.id, open ? 'out' : 'in')}
                  >
                    {busyId === s.id ? t('common.wait') : (open ? t('clock.bigOut') : t('clock.bigIn'))}
                  </button>
                </div>
              )
            })}
            {!staff.filter(s => s.id !== perfil?.id).length && (
              <div style={{ padding: 16, color: 'var(--text3)', fontSize: 13 }}>{t('clock.noStaff')}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
