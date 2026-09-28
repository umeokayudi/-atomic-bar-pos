import { useState } from 'react'
import { staffFetch } from '../lib/apiAuth'
import { useI18n } from '../lib/i18n'
import { JOB_ROLES } from '../lib/employeeAccess'
import { errText } from '../lib/errText'

const EMPTY = {
  nome: '',
  email: '',
  phone: '',
  employee_code: '',
  job_role: 'staff',
  start_date: '',
  notes: '',
}

export default function StaffAccess({ people, onChanged }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')

  const logins = (people || []).filter(p => p.source === 'staff')

  async function invite() {
    setBusy(true)
    setErr('')
    setNotice('')
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'inviteEmployee', ...form, full_name: form.nome }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error, t('staffMgmt.inviteFailed')))
    else {
      setNotice(t('staffMgmt.invited', { email: form.email }))
      setForm(EMPTY)
      setOpen(false)
      await onChanged?.()
    }
    setBusy(false)
  }

  async function saveEdit() {
    if (!edit?.id) return
    setBusy(true)
    setErr('')
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateEmployee',
        id: edit.id,
        nome: edit.nome,
        phone: edit.phone,
        employee_code: edit.employee_code,
        job_role: edit.job_role,
        start_date: edit.start_date,
        notes: edit.notes,
        status: edit.employment_status,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error, t('staffMgmt.saveFailed')))
    else {
      setEdit(null)
      await onChanged?.()
    }
    setBusy(false)
  }

  async function setStatus(person, status) {
    setBusy(true)
    setErr('')
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateEmployee', id: person.id, status }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error, t('staffMgmt.saveFailed')))
    else await onChanged?.()
    setBusy(false)
  }

  return (
    <section className="house-block" style={{ marginBottom: 18 }}>
      <h1>{t('nav.portalTeam')}</h1>
      <p className="house-lead">{t('staffMgmt.lead')}</p>
      {err && <div className="pos-sale-err" style={{ marginBottom: 10 }}>{err}</div>}
      {notice && <div style={{ marginBottom: 10, color: 'var(--green)' }}>{notice}</div>}
      {logins.map(person => (
        <div key={person.id} className="house-card">
          <div>
            <strong>{person.nome}</strong>
            <div className="house-meta">
              {person.email || '—'}
              {' · '}
              {t(`staffMgmt.jobs.${person.job_role || person.role}`)}
              {' · '}
              {t(`staffMgmt.status.${person.employment_status || 'active'}`)}
            </div>
          </div>
          {person.role !== 'cliente' && (
            <div className="house-actions">
              <button type="button" className="house-text" onClick={() => setEdit({
                id: person.id,
                nome: person.nome || '',
                phone: person.phone || person.contato || '',
                employee_code: person.employee_code || '',
                job_role: JOB_ROLES.includes(person.job_role) ? person.job_role : 'staff',
                start_date: String(person.start_date || '').slice(0, 10),
                notes: person.notes || person.notas || '',
                employment_status: person.employment_status || 'active',
              })}>{t('staffMgmt.edit')}</button>
              {person.employment_status === 'suspended' || person.employment_status === 'inactive' ? (
                <button type="button" className="house-text" disabled={busy} onClick={() => setStatus(person, 'active')}>{t('staffMgmt.reactivate')}</button>
              ) : (
                <button type="button" className="house-text" disabled={busy} onClick={() => setStatus(person, 'suspended')}>{t('staffMgmt.suspend')}</button>
              )}
            </div>
          )}
        </div>
      ))}
      {edit && (
        <div className="house-editor">
          <label>{t('staffMgmt.fullName')}<input value={edit.nome} onChange={e => setEdit({ ...edit, nome: e.target.value })} /></label>
          <label>{t('staffMgmt.phone')}<input value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></label>
          <label>{t('staffMgmt.employeeId')}<input value={edit.employee_code} onChange={e => setEdit({ ...edit, employee_code: e.target.value })} /></label>
          <label>{t('staffMgmt.role')}
            <select value={edit.job_role} onChange={e => setEdit({ ...edit, job_role: e.target.value })}>
              {JOB_ROLES.map(job => <option key={job} value={job}>{t(`staffMgmt.jobs.${job}`)}</option>)}
            </select>
          </label>
          <label>{t('staffMgmt.startDate')}<input type="date" value={edit.start_date} onChange={e => setEdit({ ...edit, start_date: e.target.value })} /></label>
          <label className="house-span">{t('staffMgmt.notes')}<input value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></label>
          <div className="house-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={saveEdit}>{t('house.save')}</button>
            <button type="button" className="house-text" onClick={() => setEdit(null)}>{t('house.cancel')}</button>
          </div>
        </div>
      )}
      {open ? (
        <div className="house-editor">
          <label>{t('staffMgmt.fullName')}<input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
          <label>{t('staffMgmt.email')}<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label>{t('staffMgmt.phone')}<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
          <label>{t('staffMgmt.employeeId')}<input value={form.employee_code} onChange={e => setForm({ ...form, employee_code: e.target.value })} /></label>
          <label>{t('staffMgmt.role')}
            <select value={form.job_role} onChange={e => setForm({ ...form, job_role: e.target.value })}>
              {JOB_ROLES.map(job => <option key={job} value={job}>{t(`staffMgmt.jobs.${job}`)}</option>)}
            </select>
          </label>
          <label>{t('staffMgmt.startDate')}<input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></label>
          <label className="house-span">{t('staffMgmt.notes')}<input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="house-actions">
            <button type="button" className="btn-primary" disabled={busy || !form.nome.trim() || !form.email.trim()} onClick={invite}>{busy ? t('common.wait') : t('staffMgmt.invite')}</button>
            <button type="button" className="house-text" onClick={() => setOpen(false)}>{t('house.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary house-add" onClick={() => setOpen(true)}>{t('staffMgmt.add')}</button>
      )}
    </section>
  )
}
