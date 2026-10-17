import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './Auth'
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
import { canLinkLogin, linkCandidates, matchPerson, suggestLoginId } from '../lib/staffLink'
import { initials } from '../lib/employeeFile'
import { staffFileUrls } from '../lib/employeeFileApi'

const LOGIN_ROLES = ['caixa', 'bar_staff', 'gerente']
const SWITCH_ROLES = ['bar_staff', 'caixa']
const STEPS = ['person', 'access', 'signin']
const PRESET_ICON = { staffOnly: 'hoje', till: 'pos', tillFloor: 'comandas', floorClock: 'floor', manager: 'userCheck', full: 'ok', custom: 'settings' }

function newPassword() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const buf = new Uint32Array(10)
  try { crypto.getRandomValues(buf) } catch { for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 1e9) }
  return Array.from(buf, n => abc[n % abc.length]).join('')
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

const phoneOf = p => p?.contato || p?.telefone || ''
const signInOf = row => row?.login_email || row?.email || ''

function cargoLabel(t, cargo) {
  if (!cargo) return ''
  const key = `house.cargo.${cargo}`
  const label = t(key)
  return label === key ? cargo : label
}

function Avatar({ person, urls, size = 'md' }) {
  const src = person?.foto && urls?.[person.foto]
  return <span className={`bu-avatar is-${size}`}>{src ? <img src={src} alt="" /> : initials(person?.nome || person?.email)}</span>
}

function accessChips(row, t) {
  if (row.role === 'cliente') return [t('barUsers.ownerFull')]
  const p = presetFor(row.acessos)
  if (p !== 'custom') return [t(`barUsers.presets.${p}`)]
  const list = cleanAcessos(row.acessos) || []
  return list.length ? list.map(a => t(`barUsers.areas.${a}`)) : [t('barUsers.nothing')]
}

/** Which kind of login a row is, for the small line under the name. */
function linkState(row) {
  if (row.role === 'cliente') return 'owner'
  if (row.lane) return 'tablet'
  if (row.person_id) return 'linked'
  return row.role === 'caixa' ? 'shared' : 'unlinked'
}

/** Searchable list of employees from the Staff page: avatar, name, role, phone. */
function PersonPicker({ people, urls, value, onPick, onStaff, t }) {
  const [q, setQ] = useState('')
  const list = people.filter(p => matchPerson(p, q))
  if (!people.length) {
    return (
      <div className="bu-empty">
        <Icon name="people" size={22} />
        <strong>{t('barUsers.noEmployees')}</strong>
        <span>{t('barUsers.noEmployeesBody')}</span>
        {onStaff && <button type="button" className="ui-btn" onClick={onStaff}><Icon name="staff" size={16} /> {t('barUsers.openStaff')}</button>}
      </div>
    )
  }
  return (
    <div className="bu-picker">
      {people.length > 4 && (
        <label className="bu-search">
          <Icon name="search" size={16} />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('barUsers.searchEmployee')} aria-label={t('barUsers.searchEmployee')} />
        </label>
      )}
      <div className="bu-people" role="radiogroup" aria-label={t('barUsers.pickEmployee')}>
        {list.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={value === p.id} className={`bu-person${value === p.id ? ' is-on' : ''}`} onClick={() => onPick(p)}>
            <Avatar person={p} urls={urls} />
            <span className="bu-person-text">
              <strong>{p.nome}</strong>
              <small>{[cargoLabel(t, p.cargo), phoneOf(p)].filter(Boolean).join(' · ') || t('barUsers.noDetails')}</small>
            </span>
            <span className="bu-radio" aria-hidden="true">{value === p.id && <Icon name="check" size={14} />}</span>
          </button>
        ))}
        {!list.length && <p className="bu-muted">{t('barUsers.noMatch')}</p>}
      </div>
      {onStaff && <button type="button" className="bu-link" onClick={onStaff}>{t('barUsers.notListed')}</button>}
    </div>
  )
}

/** Preset cards (icon + one line); the per-area grid only opens under "Custom". */
function AccessEditor({ value, onChange, actor, custom, setCustom, t }) {
  const preset = custom ? 'custom' : presetFor(value)
  const list = value == null ? BAR_AREAS : value
  const allowedToGive = area => canAccess(actor, area)
  return (
    <div className="bu-access">
      <div className="bu-presets" role="radiogroup" aria-label={t('barUsers.preset')}>
        {[...ACCESS_PRESETS, { id: 'custom', areas: [] }].map(p => {
          const ok = p.id === 'custom' ? true : p.areas == null ? canEditAccessOf(actor, { role: 'bar_staff' }, null) : p.areas.every(allowedToGive)
          const on = preset === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`bu-preset${on ? ' is-on' : ''}`}
              disabled={!ok}
              onClick={() => {
                if (p.id === 'custom') { setCustom(true); return }
                setCustom(false)
                onChange(presetAreas(p.id), p.id)
              }}
            >
              <span className="bu-preset-icon"><Icon name={PRESET_ICON[p.id]} size={18} /></span>
              <span className="bu-preset-text">
                <strong>{t(`barUsers.presets.${p.id}`)}</strong>
                <small>{t(`barUsers.presetHints.${p.id}`)}</small>
              </span>
            </button>
          )
        })}
      </div>
      {preset === 'custom' && (
        <div className="bu-areas">
          {BAR_AREAS.map(area => (
            <label key={area} className={`bu-area${!allowedToGive(area) ? ' is-off' : ''}`}>
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
      )}
    </div>
  )
}

function Seg({ options, value, onChange, label }) {
  return (
    <div className="bu-seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'is-on' : ''} disabled={o.disabled} onClick={() => onChange(o.id)}>
          {o.icon && <Icon name={o.icon} size={16} />}{o.label}
        </button>
      ))}
    </div>
  )
}

function blankForm() {
  return { kind: 'person', person_id: '', nome: '', login: '', loginAuto: true, password: newPassword(), role: 'bar_staff', acessos: presetAreas('staffOnly'), accessTouched: false, ativo: true }
}

export default function BarUsersTab({ bar, onTab }) {
  const { perfil } = useAuth()
  const { t } = useI18n()
  const mine = useMyBarAccess(perfil)
  const actor = { id: perfil?.id, role: perfil?.role, acessos: mine.acessos }
  const [rows, setRows] = useState([])
  const [people, setPeople] = useState([])
  const [urls, setUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  // sheet: { mode: 'new' | 'edit', step, row?, form, custom, created?, copied? }
  const [sheet, setSheet] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const r = await staffFetch('/api/bar-staff')
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) setErr(errText(j.error, t('barUsers.loadFailed')))
      setRows((j.staff || []).filter(s => s.role === 'cliente' || LOGIN_ROLES.includes(s.role)))
      setPeople(j.people || [])
    } catch (e) {
      setErr(errText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [bar?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const photoKey = [...rows, ...people].map(p => p.foto).filter(Boolean).join('|')
  useEffect(() => {
    let alive = true
    if (!photoKey) return undefined
    staffFileUrls(photoKey.split('|')).then(u => { if (alive) setUrls(prev => ({ ...prev, ...u })) }).catch(() => {})
    return () => { alive = false }
  }, [photoKey])

  const candidates = useMemo(() => linkCandidates(people), [people])
  const unlinked = rows.filter(r => linkState(r) === 'unlinked' && canManageLogin(actor, r)).length
  const shown = rows.filter(r => matchPerson({ nome: r.nome || r.email, cargo: signInOf(r), contato: phoneOf(r) }, q))
  const goStaff = onTab ? () => onTab('staff') : null

  function openNew() {
    setErr('')
    setSheet({ mode: 'new', step: 0, form: blankForm(), custom: false })
  }

  function openEdit(row) {
    setErr('')
    const acessos = cleanAcessos(row.acessos)
    setSheet({
      mode: 'edit',
      step: 0,
      row,
      custom: presetFor(acessos) === 'custom',
      form: { kind: row.person_id ? 'person' : 'device', person_id: row.person_id || '', nome: row.nome || '', role: row.role, acessos, accessTouched: true, ativo: row.ativo !== false },
    })
  }

  const setForm = patch => setSheet(s => ({ ...s, form: { ...s.form, ...(typeof patch === 'function' ? patch(s.form) : patch) } }))
  const setStep = step => setSheet(s => ({ ...s, step }))

  function pickPerson(p) {
    setForm(f => ({
      person_id: p.id,
      nome: p.nome,
      ...(f.loginAuto !== false ? { login: suggestLoginId(p.nome), loginAuto: true } : {}),
    }))
  }

  function setKind(kind) {
    setForm(f => {
      const next = { kind }
      if (kind === 'device') {
        next.person_id = ''
        if (sheet?.mode === 'new' && f.kind !== 'device') next.nome = ''
      }
      if (sheet?.mode === 'new' && !f.accessTouched) {
        next.acessos = presetAreas(kind === 'device' ? 'till' : 'staffOnly')
        next.role = kind === 'device' ? 'caixa' : 'bar_staff'
      }
      return next
    })
  }

  // "Staff only" is a floor-staff login: picking it switches the role so the login lands in the staff app.
  function setAccess(acessos, presetId) {
    setForm(f => ({
      acessos,
      accessTouched: true,
      ...(presetId === 'staffOnly' && SWITCH_ROLES.includes(f.role) ? { role: 'bar_staff' } : {}),
      ...(presetId === 'till' && SWITCH_ROLES.includes(f.role) && f.kind === 'device' ? { role: 'caixa' } : {}),
    }))
  }

  const form = sheet?.form
  const email = sheet?.mode === 'new' ? loginEmailFor(form?.login, bar?.id) : ''
  const personOk = !!form && (form.kind === 'person' ? !!form.person_id : !!String(form.nome || '').trim())
  const signInOk = !!email && String(form?.password || '').length >= 8
  const canNext = sheet?.step === 0 ? personOk : true

  async function create() {
    if (!personOk || !signInOk) { setErr(t('barUsers.createNeeds')); return }
    setErr(''); setBusy(true)
    const payload = { action: 'createStaff', role: form.role, nome: String(form.nome || '').trim(), email, password: form.password }
    if (form.kind === 'person' && form.person_id) payload.person_id = form.person_id
    if (form.acessos != null) payload.acessos = form.acessos
    try {
      const r = await staffFetch('/api/bar-staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) setErr(errText(j.error, t('barUsers.createFailed')))
      else {
        setSheet(s => ({ ...s, created: { nome: j.nome || form.nome, email: j.email || email, password: form.password, linked: !!payload.person_id } }))
        invalidateBarTeam()
        load()
      }
    } catch (e) {
      setErr(errText(e, t('barUsers.createFailed')))
    }
    setBusy(false)
  }

  async function saveEdit() {
    const row = sheet.row
    setErr(''); setBusy(true)
    try {
      const nextPerson = form.kind === 'person' ? form.person_id : ''
      if (canLinkLogin(row) && !row.lane && nextPerson !== (row.person_id || '')) {
        const r = await staffFetch('/api/bar-staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'linkPerson', id: row.id, person_id: nextPerson }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || j.error) throw new Error(errText(j.error, t('barUsers.saveFailed')))
      }
      const body = { id: row.id, acessos: form.acessos }
      if (!nextPerson && String(form.nome || '').trim() && form.nome.trim() !== row.nome) body.nome = form.nome.trim()
      if (form.role !== row.role && SWITCH_ROLES.includes(row.role) && SWITCH_ROLES.includes(form.role)) body.role = form.role
      if (form.ativo !== (row.ativo !== false)) body.ativo = form.ativo
      const r = await staffFetch('/api/bar-staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) throw new Error(errText(j.error, t('barUsers.saveFailed')))
      invalidateBarTeam()
      setSheet(null)
      await load()
    } catch (e) {
      setErr(errText(e, t('barUsers.saveFailed')))
    }
    setBusy(false)
  }

  async function copy(key, text) {
    if (await copyText(text)) setSheet(s => (s ? { ...s, copied: key } : s))
  }

  function renderPersonStep() {
    const row = sheet.row
    const editing = sheet.mode === 'edit'
    const linkable = !editing || canLinkLogin(row)
    const linkedHere = editing && row.person_id && form.person_id === row.person_id
    return (
      <div className="bu-step">
        <p className="bu-lead">{editing ? t('barUsers.personEditLead') : t('barUsers.personLead')}</p>
        {linkable && (
          <Seg
            label={t('barUsers.whoFor')}
            value={form.kind}
            onChange={setKind}
            options={[
              { id: 'person', icon: 'staff', label: t('barUsers.kindPerson') },
              { id: 'device', icon: 'pos', label: t('barUsers.kindDevice') },
            ]}
          />
        )}
        {form.kind === 'person' && linkedHere ? (
          <div className="bu-linked">
            <Avatar person={row} urls={urls} size="lg" />
            <div className="bu-linked-text">
              <strong>{row.nome}</strong>
              <span className="ui-badge is-success"><Icon name="ok" size={12} /> {t('barUsers.linkedFile')}</span>
              {phoneOf(row) && <small><Icon name="phone" size={13} /> {phoneOf(row)}</small>}
              {row.sexo && <small>{t(`staffFile.sexes.${row.sexo}`)}</small>}
            </div>
            <div className="bu-linked-actions">
              {goStaff && <button type="button" className="ui-btn is-sm" onClick={goStaff}>{t('barUsers.editFile')}</button>}
              <button type="button" className="ui-btn is-sm is-ghost" onClick={() => setForm({ person_id: '' })}>{t('barUsers.unlink')}</button>
            </div>
          </div>
        ) : form.kind === 'person' ? (
          <>
            {editing && row.person_id && !form.person_id && <p className="bu-note is-warn">{t('barUsers.unlinkNote')}</p>}
            <PersonPicker people={candidates} urls={urls} value={form.person_id} onPick={pickPerson} onStaff={goStaff} t={t} />
            <p className="bu-note"><Icon name="info" size={14} /> {t('barUsers.linkWhy')}</p>
          </>
        ) : (
          <>
            <label className="ui-field bu-field">
              <span>{t('barUsers.deviceName')}</span>
              <input value={form.nome} onChange={e => setForm({ nome: e.target.value })} placeholder={t('barUsers.devicePlaceholder')} autoComplete="off" />
            </label>
            <p className="bu-note"><Icon name="info" size={14} /> {t('barUsers.deviceHint')}</p>
          </>
        )}
      </div>
    )
  }

  function renderAccessStep() {
    const row = sheet.row
    const roleSwitch = sheet.mode === 'new' || SWITCH_ROLES.includes(row?.role)
    const preset = sheet.custom ? 'custom' : presetFor(form.acessos)
    return (
      <div className="bu-step">
        <p className="bu-lead">{t('barUsers.accessHint')}</p>
        <AccessEditor value={form.acessos} onChange={setAccess} actor={actor} custom={sheet.custom} setCustom={c => setSheet(s => ({ ...s, custom: c }))} t={t} />
        {roleSwitch && (
          <div className="bu-row">
            <div className="bu-row-text">
              <strong>{t('barUsers.role')}</strong>
              <small>{t('barUsers.roleHint')}</small>
            </div>
            <Seg
              label={t('barUsers.role')}
              value={form.role}
              onChange={role => setForm({ role })}
              options={SWITCH_ROLES.map(r => ({ id: r, label: t(`barUsers.roles.${r}`), disabled: preset === 'staffOnly' && r === 'caixa' }))}
            />
          </div>
        )}
        {sheet.mode === 'edit' && (
          <label className="bu-row bu-switch-row">
            <div className="bu-row-text">
              <strong>{t('barUsers.activeLabel')}</strong>
              <small>{t('barUsers.activeHint')}</small>
            </div>
            <input type="checkbox" role="switch" className="bu-switch" checked={form.ativo} onChange={e => setForm({ ativo: e.target.checked })} />
          </label>
        )}
      </div>
    )
  }

  function renderSignInStep() {
    if (sheet.mode === 'edit') {
      return (
        <div className="bu-step">
          <div className="bu-kv">
            <span>{t('barUsers.loginEmail')}</span>
            <strong>{signInOf(sheet.row)}</strong>
          </div>
          <p className="bu-note"><Icon name="lock" size={14} /> {t('barUsers.passwordHint')}</p>
        </div>
      )
    }
    return (
      <div className="bu-step">
        <p className="bu-lead">{t('barUsers.signInLead')}</p>
        <label className="ui-field bu-field">
          <span>{t('barUsers.loginField')}</span>
          <input autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={form.login} onChange={e => setForm({ login: e.target.value, loginAuto: false })} placeholder="maria" />
        </label>
        {form.login && (email
          ? !form.login.includes('@') && <p className="bu-hint">{t('barUsers.signsInAs', { email })}</p>
          : <p className="bu-hint is-bad">{t('barUsers.loginInvalid')}</p>)}
        <label className="ui-field bu-field">
          <span>{t('barUsers.password')}</span>
          <span className="bu-pass">
            <input type="text" autoComplete="new-password" spellCheck={false} value={form.password} onChange={e => setForm({ password: e.target.value })} />
            <button type="button" className="ui-btn is-icon" onClick={() => setForm({ password: newPassword() })} aria-label={t('barUsers.newPassword')} title={t('barUsers.newPassword')}><Icon name="refresh" size={16} /></button>
            <button type="button" className="ui-btn is-icon" onClick={() => copy('pw', form.password)} aria-label={t('barUsers.copy')} title={t('barUsers.copy')}><Icon name={sheet.copied === 'pw' ? 'check' : 'copy'} size={16} /></button>
          </span>
        </label>
        {String(form.password || '').length < 8 && <p className="bu-hint is-bad">{t('barUsers.passwordShort')}</p>}
        <div className="bu-summary">
          <div><span>{t('barUsers.summaryWho')}</span><strong>{form.nome || '—'}</strong>{form.kind === 'person' && form.person_id && <em className="ui-badge is-success">{t('barUsers.linkedFile')}</em>}</div>
          <div><span>{t('barUsers.summaryAccess')}</span><strong>{accessChips({ role: form.role, acessos: form.acessos }, t).join(' · ')}</strong></div>
          <div><span>{t('barUsers.role')}</span><strong>{t(`barUsers.roles.${form.role}`)}</strong></div>
        </div>
      </div>
    )
  }

  function renderCreated() {
    const c = sheet.created
    const both = `${c.email}\n${c.password}`
    return (
      <div className="bu-step bu-created">
        <span className="bu-created-icon"><Icon name="ok" size={28} /></span>
        <h3>{t('barUsers.readyTitle', { name: c.nome })}</h3>
        <p className="bu-note is-warn"><Icon name="warning" size={14} /> {t('barUsers.shownOnce')}</p>
        <div className="bu-cred">
          <div><span>{t('barUsers.loginEmail')}</span><strong>{c.email}</strong>
            <button type="button" className="ui-btn is-icon is-sm" onClick={() => copy('email', c.email)} aria-label={t('barUsers.copy')}><Icon name={sheet.copied === 'email' ? 'check' : 'copy'} size={14} /></button></div>
          <div><span>{t('barUsers.password')}</span><strong className="num">{c.password}</strong>
            <button type="button" className="ui-btn is-icon is-sm" onClick={() => copy('pw', c.password)} aria-label={t('barUsers.copy')}><Icon name={sheet.copied === 'pw' ? 'check' : 'copy'} size={14} /></button></div>
        </div>
        <button type="button" className="ui-btn" onClick={() => copy('both', both)}><Icon name={sheet.copied === 'both' ? 'check' : 'copy'} size={16} /> {t('barUsers.copyBoth')}</button>
        {c.linked && <p className="bu-muted">{t('barUsers.createdLinked')}</p>}
      </div>
    )
  }

  function renderSheet() {
    const editing = sheet.mode === 'edit'
    const title = sheet.created ? t('barUsers.readyHead') : editing ? (sheet.row.nome || signInOf(sheet.row)) : t('barUsers.newTitle')
    const last = sheet.step === STEPS.length - 1
    return (
      <>
        <div className="ui-drawer-scrim" onClick={() => !busy && setSheet(null)} />
        <aside className="ui-drawer bu-sheet" role="dialog" aria-modal="true" aria-label={title}>
          <div className="ui-drawer-head">
            {editing && !sheet.created ? <Avatar person={sheet.row} urls={urls} size="sm" /> : <span className="ui-kpi-icon"><Icon name="users" size={18} /></span>}
            <div className="ui-drawer-title">{title}{editing && <div className="ui-card-sub">{signInOf(sheet.row)}</div>}</div>
            <button type="button" className="ui-btn is-ghost is-icon" onClick={() => setSheet(null)} aria-label={t('common.close')}><Icon name="close" /></button>
          </div>
          {!sheet.created && (
            <ol className={`bu-steps${editing ? ' is-tabs' : ''}`}>
              {STEPS.map((s, i) => {
                const reachable = editing || i <= sheet.step || (i === sheet.step + 1 && canNext)
                return (
                  <li key={s} className={`${i === sheet.step ? 'is-on' : ''}${!editing && i < sheet.step ? ' is-done' : ''}`}>
                    <button type="button" disabled={!reachable} onClick={() => setStep(i)} aria-current={i === sheet.step ? 'step' : undefined}>
                      <span className="bu-step-n">{!editing && i < sheet.step ? <Icon name="check" size={12} /> : i + 1}</span>
                      {t(`barUsers.step.${s}`)}
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
          <div className="ui-drawer-body">
            {err && <div className="bu-err">{asReactText(err)}</div>}
            {sheet.created ? renderCreated() : sheet.step === 0 ? renderPersonStep() : sheet.step === 1 ? renderAccessStep() : renderSignInStep()}
          </div>
          <div className="ui-drawer-foot bu-foot">
            {sheet.created ? (
              <>
                <button type="button" className="ui-btn" onClick={openNew}>{t('barUsers.another')}</button>
                <button type="button" className="ui-btn is-primary" onClick={() => setSheet(null)}>{t('barUsers.done')}</button>
              </>
            ) : editing ? (
              <>
                <button type="button" className="ui-btn" onClick={() => setSheet(null)}>{t('common.cancel')}</button>
                <button type="button" className="ui-btn is-primary" disabled={busy || (form.kind === 'device' && !String(form.nome || '').trim())} onClick={saveEdit}>{busy ? t('common.wait') : t('barUsers.saveAccess')}</button>
              </>
            ) : (
              <>
                {sheet.step > 0
                  ? <button type="button" className="ui-btn" onClick={() => setStep(sheet.step - 1)}><Icon name="back" size={16} /> {t('barUsers.back')}</button>
                  : <button type="button" className="ui-btn" onClick={() => setSheet(null)}>{t('common.cancel')}</button>}
                {last
                  ? <button type="button" className="ui-btn is-primary" disabled={busy || !signInOk || !personOk} onClick={create}>{busy ? t('common.wait') : t('barUsers.create')}</button>
                  : <button type="button" className="ui-btn is-primary" disabled={!canNext} onClick={() => setStep(sheet.step + 1)}>{t('barUsers.next')} <Icon name="next" size={16} /></button>}
              </>
            )}
          </div>
        </aside>
      </>
    )
  }

  return (
    <div className="fade-in bu-page">
      <PageHeader
        title={t('barUsers.title')}
        subtitle={t('barUsers.subtitle')}
        actions={<button type="button" className="ui-btn is-primary" onClick={openNew}><Icon name="plus" size={16} /> {t('barUsers.newTitle')}</button>}
      />
      {err && !sheet && <div className="bu-err">{asReactText(err)}</div>}

      {unlinked > 0 && (
        <div className="bu-banner">
          <Icon name="info" size={18} />
          <span>{unlinked === 1 ? t('barUsers.unlinkedBannerOne') : t('barUsers.unlinkedBanner', { count: unlinked })}</span>
        </div>
      )}

      <section className="bu-list-wrap">
        <div className="bu-list-head">
          <h2>{t('barUsers.listTitle')} <span className="bu-count">{rows.length}</span></h2>
          {rows.length > 5 && (
            <label className="bu-search is-compact">
              <Icon name="search" size={16} />
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('barUsers.search')} aria-label={t('barUsers.search')} />
            </label>
          )}
        </div>

        {loading && !rows.length ? (
          <div className="bu-list">{[0, 1, 2].map(i => <div key={i} className="bu-card ui-skel" style={{ height: 92 }} />)}</div>
        ) : !rows.length ? (
          <div className="bu-empty"><Icon name="users" size={22} /><strong>{t('barUsers.empty')}</strong><span>{t('barUsers.emptyBody')}</span></div>
        ) : (
          <div className="bu-list">
            {shown.map(row => {
              const can = canManageLogin(actor, row)
              const off = row.ativo === false
              const state = linkState(row)
              return (
                <article key={row.id} className={`bu-card${off ? ' is-off' : ''}`}>
                  <Avatar person={row} urls={urls} />
                  <div className="bu-card-main">
                    <div className="bu-card-top">
                      <strong className="bu-name">{row.nome || signInOf(row)}</strong>
                      <span className={`ui-badge${row.role === 'cliente' ? ' is-accent' : ''}`}>{t(`barUsers.roles.${row.role}`)}</span>
                      {off && <span className="ui-badge is-danger">{t('barUsers.off')}</span>}
                    </div>
                    <div className="bu-card-sub">
                      <span className="bu-email">{signInOf(row)}</span>
                      {phoneOf(row) && <a href={`tel:${phoneOf(row).replace(/[^\d+]/g, '')}`} className="bu-phone"><Icon name="phone" size={12} />{phoneOf(row)}</a>}
                    </div>
                    <div className="bu-card-chips">
                      {state !== 'owner' && <span className={`bu-link-state is-${state}`}>
                        <Icon name={state === 'linked' ? 'userCheck' : state === 'unlinked' ? 'warning' : state === 'tablet' ? 'phone' : 'pos'} size={12} />
                        {t(`barUsers.linkState.${state}`)}
                      </span>}
                      {accessChips(row, t).map(c => <span key={c} className="bu-chip">{c}</span>)}
                    </div>
                  </div>
                  {can && (
                    <button type="button" className="ui-btn is-sm bu-edit" onClick={() => openEdit(row)}>
                      <Icon name="edit" size={14} /> <span>{t('barUsers.editAccess')}</span>
                    </button>
                  )}
                </article>
              )
            })}
            {!shown.length && <p className="bu-muted">{t('barUsers.noMatch')}</p>}
          </div>
        )}
        <p className="bu-foot-note"><Icon name="lock" size={13} /> {t('barUsers.passwordHint')}</p>
      </section>

      {sheet && renderSheet()}
    </div>
  )
}
