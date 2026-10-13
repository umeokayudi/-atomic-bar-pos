import { useEffect, useState } from 'react'
import { useAuth } from './Auth'
import { Spinner, SectionTitle } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { invalidateBarTeam } from '../lib/barTeam'
import { PageHeader } from './ui/PageLayout'
import Icon from './ui/Icon'
import { useMyBarAccess } from '../lib/myBarAccess'
import {
  ACCESS_PRESETS, BAR_AREAS, canAccess, canEditAccessOf, canManageLogin, cleanAcessos, loginEmailFor, presetAreas, presetFor,
} from '../lib/barAccess'

const LOGIN_ROLES = ['caixa', 'bar_staff', 'gerente']

function newPassword() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const buf = new Uint32Array(10)
  try { crypto.getRandomValues(buf) } catch { for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 1e9) }
  return Array.from(buf, n => abc[n % abc.length]).join('')
}

/** Male / Female as a two-button switch; tapping the chosen one again clears it. */
function SexPicker({ value, onChange, t }) {
  return (
    <div className="bar-users-seg" role="radiogroup" aria-label={t('barUsers.sex')}>
      {['m', 'f'].map(v => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} onClick={() => onChange(value === v ? '' : v)}>
          {t(`barUsers.sexes.${v}`)}
        </button>
      ))}
    </div>
  )
}

/** Name, phone and sex: the same fields on a new login and when editing one. */
function PersonFields({ value, onChange, t }) {
  return (
    <>
      <input placeholder={t('barUsers.name')} autoComplete="off" value={value.nome} onChange={e => onChange({ ...value, nome: e.target.value })} />
      <input type="tel" inputMode="tel" autoComplete="off" placeholder={t('barUsers.phone')} value={value.telefone} onChange={e => onChange({ ...value, telefone: e.target.value })} />
      <SexPicker value={value.sexo} onChange={sexo => onChange({ ...value, sexo })} t={t} />
    </>
  )
}

/**
 * Preset buttons + one checkbox per area. `value` null = no limit (the role decides).
 * onChange(acessos, presetId): presetId is set when a preset button was pressed ("Staff only" also sets the role).
 */
function AccessEditor({ value, onChange, actor, t }) {
  const preset = presetFor(value)
  const list = value == null ? BAR_AREAS : value
  const allowedToGive = area => canAccess(actor, area)
  return (
    <div className="bar-users-access">
      <div className="bar-users-presets" role="radiogroup" aria-label={t('barUsers.preset')}>
        {ACCESS_PRESETS.map(p => {
          const areas = p.areas
          const ok = areas == null ? canEditAccessOf(actor, { role: 'bar_staff' }, null) : areas.every(allowedToGive)
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              className={`bar-users-chip${preset === p.id ? ' is-on' : ''}`}
              disabled={!ok}
              onClick={() => onChange(presetAreas(p.id), p.id)}
            >
              {t(`barUsers.presets.${p.id}`)}
            </button>
          )
        })}
        <span className={`bar-users-chip is-static${preset === 'custom' ? ' is-on' : ''}`}>{t('barUsers.presets.custom')}</span>
      </div>
      {preset === 'staffOnly' && <p className="bar-users-note">{t('barUsers.staffOnlyHint')}</p>}
      <div className="bar-users-areas">
        {BAR_AREAS.map(area => (
          <label key={area} className={`bar-users-area${!allowedToGive(area) ? ' is-off' : ''}`}>
            <input
              type="checkbox"
              checked={list.includes(area)}
              disabled={!allowedToGive(area)}
              onChange={e => {
                const next = new Set(list)
                if (e.target.checked) next.add(area)
                else next.delete(area)
                onChange(cleanAcessos([...next]))
              }}
            />
            <span>
              <strong>{t(`barUsers.areas.${area}`)}</strong>
              <small>{t(`barUsers.areaHints.${area}`)}</small>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

function accessSummary(row, t) {
  if (row.role === 'cliente') return t('barUsers.ownerFull')
  const p = presetFor(row.acessos)
  if (p !== 'custom') return t(`barUsers.presets.${p}`)
  const list = cleanAcessos(row.acessos) || []
  return list.length ? list.map(a => t(`barUsers.areas.${a}`)).join(' · ') : t('barUsers.nothing')
}

export default function BarUsersTab({ bar }) {
  const { perfil } = useAuth()
  const { t } = useI18n()
  const mine = useMyBarAccess(perfil)
  const actor = { id: perfil?.id, role: perfil?.role, acessos: mine.acessos }
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [created, setCreated] = useState(null)
  // New logins start as "Staff only": most people at the bar only need their own staff app.
  const blankForm = (role = 'bar_staff', acessos = presetAreas('staffOnly')) => ({ nome: '', telefone: '', sexo: '', login: '', password: newPassword(), role, acessos })
  const [form, setForm] = useState(() => blankForm())
  const [editId, setEditId] = useState('')
  const [edit, setEdit] = useState({ role: '', acessos: null, nome: '', telefone: '', sexo: '' })

  async function load() {
    setLoading(true)
    try {
      const r = await staffFetch('/api/bar-staff')
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) setErr(errText(j.error, t('barUsers.loadFailed')))
      setRows((j.staff || []).filter(s => s.role === 'cliente' || LOGIN_ROLES.includes(s.role)))
    } catch (e) {
      setErr(errText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [bar?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    setErr(''); setCreated(null)
    const email = loginEmailFor(form.login, bar?.id)
    if (!form.nome.trim() || !email || String(form.password).length < 8) {
      setErr(t('barUsers.createNeeds'))
      return
    }
    setBusy('new')
    const payload = { action: 'createStaff', role: form.role, nome: form.nome.trim(), email, password: form.password }
    if (form.telefone.trim()) payload.telefone = form.telefone.trim()
    if (form.sexo) payload.sexo = form.sexo
    if (form.acessos != null) payload.acessos = form.acessos
    const r = await staffFetch('/api/bar-staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) setErr(errText(j.error, t('barUsers.createFailed')))
    else {
      setCreated({ nome: j.nome || form.nome, email: j.email || email, password: form.password })
      setForm(blankForm(form.role, form.acessos))
      invalidateBarTeam()
      await load()
    }
    setBusy('')
  }

  async function patch(row, body) {
    setErr(''); setBusy(row.id)
    const r = await staffFetch('/api/bar-staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, ...body }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) setErr(errText(j.error, t('barUsers.saveFailed')))
    else {
      invalidateBarTeam()
      setEditId('')
      await load()
    }
    setBusy('')
  }

  function openEdit(row) {
    setEditId(row.id)
    setEdit({ role: row.role, acessos: cleanAcessos(row.acessos), nome: row.nome || '', telefone: row.telefone || '', sexo: row.sexo || '' })
  }

  function saveEdit(row) {
    const body = { acessos: edit.acessos, telefone: edit.telefone.trim(), sexo: edit.sexo }
    if (edit.nome.trim() && edit.nome.trim() !== row.nome) body.nome = edit.nome.trim()
    if (edit.role !== row.role && ['caixa', 'bar_staff'].includes(row.role) && ['caixa', 'bar_staff'].includes(edit.role)) body.role = edit.role
    patch(row, body)
  }

  const createRoles = ['bar_staff', 'caixa']
  // "Staff only" is a floor-staff login: picking it switches the role so the login lands in the staff app.
  const withPreset = (cur, acessos, presetId) => ({ ...cur, acessos, ...(presetId === 'staffOnly' ? { role: 'bar_staff' } : {}) })

  return (
    <div className="fade-in bar-users">
      <PageHeader title={t('barUsers.title')} subtitle={t('barUsers.subtitle')} />
      {err && <div className="pos-sale-err" style={{ marginBottom: 12 }}>{asReactText(err)}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <SectionTitle>{t('barUsers.newTitle')}</SectionTitle>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{t('barUsers.newHint')}</p>
        <div className="bar-users-form">
          <PersonFields value={form} onChange={setForm} t={t} />
          <input placeholder={t('barUsers.loginField')} autoCapitalize="none" autoCorrect="off" value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} />
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" autoComplete="new-password" placeholder={t('barUsers.password')} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
            <button type="button" className="people-in" onClick={() => setForm({ ...form, password: newPassword() })}>{t('barUsers.newPassword')}</button>
          </div>
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} aria-label={t('barUsers.role')}>
            {createRoles.map(r => <option key={r} value={r}>{t(`barUsers.roles.${r}`)}</option>)}
          </select>
        </div>
        {form.login && !form.login.includes('@') && loginEmailFor(form.login, bar?.id) && (
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{t('barUsers.signsInAs', { email: loginEmailFor(form.login, bar?.id) })}</div>
        )}
        <div style={{ marginTop: 12, fontWeight: 700, fontSize: 13 }}>{t('barUsers.accessTitle')}</div>
        <p style={{ fontSize: 12, color: 'var(--text2)', margin: '2px 0 8px' }}>{t('barUsers.accessHint')}</p>
        <AccessEditor value={form.acessos} onChange={(acessos, presetId) => setForm(withPreset(form, acessos, presetId))} actor={actor} t={t} />
        <button className="btn-primary" disabled={busy === 'new'} onClick={create} style={{ marginTop: 12, padding: '10px 16px' }}>
          {busy === 'new' ? t('common.wait') : t('barUsers.create')}
        </button>
        {created && (
          <div className="created-login">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>{t('barUsers.shownOnce')}</div>
            <div>{t('barUsers.name')}: <strong>{created.nome}</strong></div>
            <div>{t('barUsers.loginEmail')}: <strong>{created.email}</strong></div>
            <div>{t('barUsers.password')}: <strong>{created.password}</strong></div>
            <button type="button" className="people-in" style={{ marginTop: 8 }} onClick={() => setCreated(null)}>{t('barUsers.done')}</button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0' }}>
          <SectionTitle>{t('barUsers.listTitle')}</SectionTitle>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>{t('barUsers.passwordHint')}</p>
        </div>
        {loading ? <div style={{ padding: 16 }}><Spinner /></div> : rows.map(row => {
          const can = canManageLogin(actor, row)
          const off = row.ativo === false
          return (
            <div key={row.id} className="people-row bar-users-row" style={{ alignItems: 'flex-start', opacity: off ? 0.6 : 1 }}>
              <div className="people-who" style={{ minWidth: 0 }}>
                <div className="people-avatar">{(row.nome || '?')[0]}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800 }}>{row.nome || row.email}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', overflowWrap: 'anywhere' }}>
                    {row.email}{row.lane ? ` · ${t('barUsers.laneLogin')}` : ''}
                  </div>
                  {(row.telefone || row.sexo) && (
                    <div className="bar-users-contact">
                      {row.telefone && <a href={`tel:${row.telefone.replace(/[^\d+]/g, '')}`}><Icon name="phone" size={13} />{row.telefone}</a>}
                      {row.sexo && <span>{t(`barUsers.sexes.${row.sexo}`)}</span>}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    <span className="staff-badge">{t(`barUsers.roles.${row.role}`)}</span>
                    <span className={`staff-badge${off ? ' is-bad' : ''}`}>{off ? t('barUsers.off') : t('barUsers.on')}</span>
                    <span className="staff-badge is-muted">{accessSummary(row, t)}</span>
                  </div>
                  {editId === row.id && (
                    <div style={{ marginTop: 10 }}>
                      <div className="bar-users-form" style={{ marginBottom: 8 }}>
                        <PersonFields value={edit} onChange={setEdit} t={t} />
                      </div>
                      {['caixa', 'bar_staff'].includes(row.role) && (
                        <select value={edit.role} onChange={e => setEdit({ ...edit, role: e.target.value })} aria-label={t('barUsers.role')} style={{ marginBottom: 8, maxWidth: 220 }}>
                          {createRoles.map(r => <option key={r} value={r}>{t(`barUsers.roles.${r}`)}</option>)}
                        </select>
                      )}
                      <AccessEditor value={edit.acessos} onChange={(acessos, presetId) => setEdit(withPreset(edit, acessos, ['caixa', 'bar_staff'].includes(row.role) ? presetId : null))} actor={actor} t={t} />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button type="button" className="btn-primary" disabled={busy === row.id} onClick={() => saveEdit(row)}>{busy === row.id ? t('common.wait') : t('barUsers.saveAccess')}</button>
                        <button type="button" className="people-in" onClick={() => setEditId('')}>{t('common.cancel')}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {can && editId !== row.id && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button type="button" className="people-in" onClick={() => openEdit(row)}>{t('barUsers.editAccess')}</button>
                  <button type="button" className={off ? 'people-in' : 'people-out'} disabled={busy === row.id} onClick={() => patch(row, { ativo: off })}>
                    {off ? t('barUsers.turnOn') : t('barUsers.turnOff')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
        {!loading && !rows.length && <div style={{ padding: 16, color: 'var(--text3)', fontSize: 13 }}>{t('barUsers.empty')}</div>}
      </div>
    </div>
  )
}
