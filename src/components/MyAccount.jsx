import { useState } from 'react'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { meAccount, meName } from '../lib/staffSelfApi'
import { PageHeader } from './ui/PageLayout'
import Icon from './ui/Icon'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Bar → My account: the owner (or manager) changes their own name, sign-in e-mail and password.
 * Same server calls as the staff app profile (meName / meAccount on /api/bar-staff); e-mail and password need the current password.
 */
export default function MyAccount() {
  const { t } = useI18n()
  const { user, perfil, patchPerfil } = useAuth()
  const email = perfil?.email || user?.email || ''
  const [open, setOpen] = useState('')
  const [form, setForm] = useState({ nome: '', email: '', password: '', confirm: '', current: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = patch => setForm(f => ({ ...f, ...patch }))

  const start = what => {
    setOpen(o => (o === what ? '' : what))
    setMsg(null)
    setForm({ nome: what === 'nome' ? perfil?.nome || '' : '', email: what === 'email' ? email : '', password: '', confirm: '', current: '' })
  }

  if (perfil?.lane) {
    return (
      <div className="fade-in vault-settings">
        <PageHeader title={t('myAccount.title')} subtitle={t('myAccount.lead')} />
        <p className="ui-card desk-note">{t('myAccount.laneOnly')}</p>
      </div>
    )
  }

  const nome = form.nome.trim()
  const okName = nome.length > 0 && nome.length <= 80 && nome !== (perfil?.nome || '')
  const okEmail = EMAIL_RE.test(form.email.trim()) && form.email.trim().toLowerCase() !== email.toLowerCase()
  const okPass = form.password.length >= 8 && form.password === form.confirm
  const ready = open === 'nome' ? okName : !!form.current && (open === 'email' ? okEmail : okPass)

  async function save(e) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setMsg(null)
    try {
      if (open === 'nome') {
        const j = await meName(nome)
        patchPerfil?.({ nome: j.nome || nome })
        setMsg({ tone: 'success', text: t('myAccount.nameSaved') })
      } else {
        const j = await meAccount(open === 'email' ? { current: form.current, email: form.email.trim() } : { current: form.current, password: form.password })
        if (j.email) patchPerfil?.({ email: j.email })
        setMsg({ tone: 'success', text: t(open === 'email' ? 'myAccount.emailSaved' : 'myAccount.passwordSaved') })
      }
      setOpen('')
    } catch (x) {
      setMsg({ tone: 'danger', text: errText(x) })
    } finally {
      setBusy(false)
    }
  }

  const line = (what, label, value) => (
    <div className="my-account-line">
      <span className="my-account-main"><small>{label}</small><strong>{value || '—'}</strong></span>
      <button type="button" className="ui-btn is-ghost is-sm" onClick={() => start(what)}>{open === what ? t('common.cancel') : t('myAccount.change')}</button>
    </div>
  )

  return (
    <div className="fade-in vault-settings">
      <PageHeader title={t('myAccount.title')} subtitle={t('myAccount.lead')} />
      <div className="ui-card vault-form">
        {line('nome', t('myAccount.name'), perfil?.nome)}
        {line('email', t('myAccount.email'), email)}
        {line('password', t('myAccount.password'), '••••••••')}

        {open && (
          <form className="my-account-form" onSubmit={save}>
            {open === 'nome' && (
              <label className="ui-field"><span>{t('myAccount.name')}</span>
                <input type="text" autoComplete="name" maxLength={80} value={form.nome} onChange={e => set({ nome: e.target.value })} autoFocus />
              </label>
            )}
            {open === 'email' && (
              <label className="ui-field"><span>{t('myAccount.newEmail')}</span>
                <input type="email" autoComplete="email" autoCapitalize="none" value={form.email} onChange={e => set({ email: e.target.value })} autoFocus />
                <small className="desk-note">{t('myAccount.emailHint')}</small>
              </label>
            )}
            {open === 'password' && (
              <div className="vault-pins">
                <label className="ui-field"><span>{t('myAccount.newPassword')}</span>
                  <input type="password" autoComplete="new-password" value={form.password} onChange={e => set({ password: e.target.value })} autoFocus />
                  <small className="desk-note">{t('myAccount.passwordHint')}</small>
                </label>
                <label className="ui-field"><span>{t('myAccount.confirm')}</span>
                  <input type="password" autoComplete="new-password" value={form.confirm} onChange={e => set({ confirm: e.target.value })} />
                </label>
              </div>
            )}
            {open !== 'nome' && (
              <label className="ui-field"><span>{t('myAccount.current')}</span>
                <input type="password" autoComplete="current-password" value={form.current} onChange={e => set({ current: e.target.value })} />
                <small className="desk-note">{t('myAccount.currentHint')}</small>
              </label>
            )}
            {open === 'password' && form.confirm && form.password !== form.confirm && <div className="ui-error" role="alert">{t('myAccount.noMatch')}</div>}
            <div className="vault-actions">
              <button type="submit" className="ui-btn is-primary" disabled={busy || !ready}>
                <Icon name="check" size={15} /> {busy ? t('common.saving') : t('myAccount.save')}
              </button>
            </div>
          </form>
        )}
        {msg && <div className={msg.tone === 'success' ? 'ui-badge is-success' : 'ui-error'} role={msg.tone === 'success' ? 'status' : 'alert'}>{msg.text}</div>}
      </div>
    </div>
  )
}
