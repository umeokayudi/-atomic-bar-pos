import { LogoLogin } from './Logo'
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, drinksAuth } from '../lib/supabase'
import { useI18n, LANGS } from '../lib/i18n'
import { clearLaneSession } from '../lib/barLanes'
import { barMatches, loginBlockedReason, sessionMatchesProfile } from '../lib/authGate'
import { setHashForRole } from '../lib/barDoors'
import { asReactText } from '../lib/errText'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

function authLinkKind() {
  if (typeof location === 'undefined') return ''
  const blob = `${location.hash || ''}&${location.search || ''}`
  if (/type=recovery/.test(blob)) return 'recovery'
  if (/type=invite/.test(blob)) return 'invite'
  return ''
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [perfil,  setPerfil]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [passwordGate, setPasswordGate] = useState(() => authLinkKind())

  useEffect(() => {
    clearLaneSession()
    drinksAuth.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        loadPerfil(session.user.id)
        return
      }
      setLoading(false)
    })
    const { data: { subscription } } = drinksAuth.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordGate('recovery')
      else if (authLinkKind() === 'invite') setPasswordGate('invite')
      if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user)
        return
      }
      if (session?.user) {
        clearLaneSession()
        setUser(session.user)
        loadPerfil(session.user.id)
        return
      }
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setPerfil(null)
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function rejectSession(reason) {
    try { await drinksAuth.auth.signOut({ scope: 'local' }) } catch { /* already cleared */ }
    clearLaneSession()
    setUser(null)
    setPerfil(null)
    setLoading(false)
    return { error: { message: reason }, perfil: null }
  }

  async function acceptProfile(uid, perfil) {
    if (!sessionMatchesProfile(uid, perfil)) return rejectSession('profile-mismatch')
    let status = null
    let employeeBar = null
    if (['cliente', 'gerente', 'caixa', 'bar_staff'].includes(perfil.role)) {
      const emp = await supabase.from('bar_employees').select('status,bar_id').eq('id', uid).maybeSingle()
      if (!emp.error && emp.data) {
        status = emp.data.status || null
        employeeBar = emp.data.bar_id || null
      }
    }
    if (!barMatches(perfil.bar_id, employeeBar)) return rejectSession('other-bar')
    const blocked = loginBlockedReason(perfil.role, status)
    if (blocked) return rejectSession(blocked)
    if (status === 'invited') {
      await supabase.rpc('bar_accept_invitation').catch(() => {})
    }
    setPerfil(perfil)
    setLoading(false)
    return { error: null, perfil }
  }

  async function loadPerfil(uid) {
    const loaded = await supabase.from('perfis').select('*').eq('id', uid).maybeSingle()
    if (loaded.error || !loaded.data) {
      await rejectSession('profile-mismatch')
      return
    }
    await acceptProfile(uid, loaded.data)
  }

  async function signIn(email, password) {
    const e = String(email || '').trim().toLowerCase()
    const p = String(password || '')
    clearLaneSession()
    const result = await drinksAuth.auth.signInWithPassword({ email: e, password: p })
    if (result.error) return result
    const uid = result.data?.user?.id
    if (!uid) return { error: { message: 'profile-mismatch' }, perfil: null }
    setUser(result.data.user)
    const loaded = await supabase.from('perfis').select('*').eq('id', uid).maybeSingle()
    if (loaded.error || !loaded.data) return rejectSession('profile-mismatch')
    return acceptProfile(uid, loaded.data)
  }

  async function signOut() {
    clearLaneSession()
    setPasswordGate('')
    setUser(null)
    setPerfil(null)
    try { await drinksAuth.auth.signOut({ scope: 'local' }) } catch { /* already cleared */ }
  }

  async function requestPasswordReset(email) {
    const address = String(email || '').trim().toLowerCase()
    const redirectTo = typeof location !== 'undefined' ? `${location.origin}/` : undefined
    const result = await drinksAuth.auth.resetPasswordForEmail(address, { redirectTo })
    supabase.rpc('bar_note_password_recovery', { p_email: address }).catch(() => {})
    return result
  }

  async function completePassword(password) {
    const next = String(password || '')
    if (next.length < 6) return { error: { message: 'short' } }
    const updated = await drinksAuth.auth.updateUser({ password: next })
    if (updated.error) return updated
    if (passwordGate === 'invite') {
      await supabase.rpc('bar_accept_invitation').catch(() => {})
    }
    setPasswordGate('')
    if (typeof location !== 'undefined' && /type=/.test(location.hash || '')) location.hash = '#/'
    return { error: null }
  }

  async function changePassword(currentPassword, nextPassword) {
    const email = user?.email || perfil?.email
    if (!email) return { error: { message: 'no-email' } }
    const check = await drinksAuth.auth.signInWithPassword({
      email: String(email).trim().toLowerCase(),
      password: String(currentPassword || ''),
    })
    if (check.error) return check
    return drinksAuth.auth.updateUser({ password: String(nextPassword || '') })
  }

  return (
    <AuthContext.Provider value={{
      user, perfil, loading, passwordGate,
      signIn,
      signUp: (e, p, n) => supabase.auth.signUp({ email: e, password: p, options: { data: { nome: n } } }),
      signOut,
      requestPasswordReset,
      completePassword,
      changePassword,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

function LoginLanguagePicker() {
  const { lang, setLang, t } = useI18n()
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 22 }}>
      {Object.values(LANGS).map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => setLang(opt.id)}
          style={{
            padding: '5px 12px',
            borderRadius: 20,
            border: lang === opt.id ? '1px solid var(--gold)' : '1px solid rgba(193,156,86,0.25)',
            background: lang === opt.id ? 'rgba(193,156,86,0.15)' : 'transparent',
            color: lang === opt.id ? 'var(--gold)' : 'rgba(255,255,255,0.45)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function LoginPage() {
  const { signIn, requestPasswordReset } = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [pass,  setPass]  = useState('')
  const [err,   setErr]   = useState('')
  const [busy,  setBusy]  = useState(false)
  const [mode, setMode] = useState('signin')
  const [notice, setNotice] = useState('')

  const submit = async () => {
    setErr('')
    if (!email.trim() || !pass) {
      setErr(t('auth.enterEmailPassword'))
      return
    }
    setBusy(true)
    try {
      const { error, perfil } = await signIn(email, pass)
      if (error) {
        const msg = String(error.message || '').toLowerCase()
        if (msg === 'suspended') setErr(t('auth.suspended'))
        else if (msg === 'profile-mismatch') setErr(t('auth.profileMissing'))
        else if (msg === 'other-bar') setErr(t('auth.otherBar'))
        else if (msg.includes('api key') || msg.includes('jwt') || msg.includes('not configured')) {
          setErr(t('auth.badProject'))
        } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed')) {
          setErr(t('auth.network'))
        } else {
          setErr(t('auth.wrongCredentials'))
        }
      } else {
        setHashForRole(perfil?.role)
      }
    } finally { setBusy(false) }
  }

  const field = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(193,156,86,0.22)',
    color: 'white',
    width: '100%',
    padding: '14px 16px',
    borderRadius: 12,
    fontSize: 16,
  }

  return (
    <div className="login-wrap" style={{
      minHeight: '100vh', display: 'flex', background: 'var(--navy)',
      alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        position: 'fixed', inset: 0, opacity: 0.03, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(45deg,#c19c56 0,#c19c56 1px,transparent 0,transparent 50%)',
        backgroundSize: '20px 20px',
      }} />

      <div style={{ width: '100%', maxWidth: 400, position: 'relative' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <LogoLogin />
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(193,156,86,0.2)',
          borderRadius: 20,
          padding: '32px 28px',
          backdropFilter: 'blur(10px)',
        }}>
          <LoginLanguagePicker />
          {mode === 'forgot' ? (
            <form onSubmit={async e => {
              e.preventDefault()
              setErr('')
              setNotice('')
              if (!email.trim()) { setErr(t('auth.enterEmail')); return }
              setBusy(true)
              try {
                const { error } = await requestPasswordReset(email)
                if (error) setErr(t('auth.resetFailed'))
                else setNotice(t('auth.resetSent'))
              } finally { setBusy(false) }
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: 8, textAlign: 'center', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('auth.forgotPassword')}</div>
              <div style={{ marginBottom: 14, marginTop: 18 }}>
                <label className="form-label" style={{ color: 'rgba(193,156,86,0.7)' }}>{t('auth.email')}</label>
                <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} style={field} />
              </div>
              {err && <div style={{ fontSize: 13, marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(160,41,28,0.2)', color: '#fca5a5' }}>{asReactText(err)}</div>}
              {notice && <div style={{ fontSize: 13, marginBottom: 16, color: 'var(--gold)' }}>{notice}</div>}
              <button type="submit" className="btn-gold" disabled={busy} style={{ width: '100%', padding: 13, fontSize: 14, borderRadius: 10 }}>{busy ? t('common.wait') : t('auth.resetPassword')}</button>
              <button type="button" onClick={() => { setMode('signin'); setErr(''); setNotice('') }} style={{ marginTop: 12, width: '100%', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer' }}>{t('auth.backToLogin')}</button>
            </form>
          ) : (
          <form onSubmit={e => { e.preventDefault(); submit() }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)',
            marginBottom: 8, textAlign: 'center', letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            {t('auth.enter')}
          </div>
          <div className="login-door-hint">
            {t('auth.oneLoginHint')}
          </div>

          <div style={{ marginBottom: 14, marginTop: 18 }}>
            <label className="form-label" style={{ color: 'rgba(193,156,86,0.7)' }}>{t('auth.email')}</label>
            <input
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder') || 'email'}
              style={field}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label className="form-label" style={{ color: 'rgba(193,156,86,0.7)' }}>{t('auth.password')}</label>
            <input
              type="password"
              autoComplete="current-password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="••••••••"
              style={field}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </div>
          {err && (
            <div style={{
              fontSize: 13, marginBottom: 16, padding: '10px 14px', borderRadius: 8,
              background: 'rgba(160,41,28,0.2)',
              color: '#fca5a5',
              border: '1px solid rgba(160,41,28,0.3)',
            }}>{asReactText(err)}</div>
          )}

          <button type="submit" className="btn-gold" disabled={busy}
            style={{ width: '100%', padding: 13, fontSize: 14, borderRadius: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {busy
              ? <><span className="spinner" />{t('common.wait')}</>
              : t('auth.enter')}
          </button>
          <button type="button" onClick={() => { setMode('forgot'); setErr('') }} style={{ marginTop: 14, width: '100%', background: 'transparent', border: 'none', color: 'rgba(193,156,86,0.85)', cursor: 'pointer', fontSize: 13 }}>{t('auth.forgotPassword')}</button>
          </form>
          )}
        </div>
      </div>
    </div>
  )
}

export function SetPasswordPage() {
  const { passwordGate, completePassword } = useAuth()
  const { t } = useI18n()
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const field = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(193,156,86,0.22)',
    color: 'white',
    width: '100%',
    padding: '14px 16px',
    borderRadius: 12,
    fontSize: 16,
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (pass.length < 6) { setErr(t('auth.passwordShort')); return }
    if (pass !== again) { setErr(t('auth.passwordMismatch')); return }
    setBusy(true)
    try {
      const { error } = await completePassword(pass)
      if (error) setErr(error.message === 'short' ? t('auth.passwordShort') : t('auth.resetFailed'))
    } finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy)', padding: 20 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 400, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(193,156,86,0.2)', borderRadius: 20, padding: 28 }}>
        <div style={{ color: 'white', fontWeight: 800, marginBottom: 8 }}>{passwordGate === 'invite' ? t('auth.createPassword') : t('auth.resetPassword')}</div>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginBottom: 16 }}>{t('auth.newPasswordHint')}</p>
        <input type="password" autoComplete="new-password" value={pass} onChange={e => setPass(e.target.value)} placeholder={t('auth.newPassword')} style={{ ...field, marginBottom: 12 }} />
        <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} placeholder={t('auth.confirmPassword')} style={{ ...field, marginBottom: 12 }} />
        {err && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{asReactText(err)}</div>}
        <button type="submit" className="btn-gold" disabled={busy} style={{ width: '100%', padding: 12 }}>{busy ? t('common.wait') : t('auth.savePassword')}</button>
      </form>
    </div>
  )
}

export function AccountSecurity() {
  const { changePassword } = useAuth()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setOk('')
    if (next.length < 6) { setErr(t('auth.passwordShort')); return }
    setBusy(true)
    try {
      const { error } = await changePassword(current, next)
      if (error) setErr(t('auth.changeFailed'))
      else {
        setOk(t('auth.passwordChanged'))
        setCurrent('')
        setNext('')
      }
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="sidebar-signout" style={{ marginBottom: 8 }}>{t('auth.changePassword')}</button>
    )
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'rgba(193,156,86,0.8)', marginBottom: 6 }}>{t('auth.changePassword')}</div>
      <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} placeholder={t('auth.currentPassword')} style={{ width: '100%', marginBottom: 6, padding: 8, borderRadius: 8 }} />
      <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} placeholder={t('auth.newPassword')} style={{ width: '100%', marginBottom: 6, padding: 8, borderRadius: 8 }} />
      {err && <div style={{ color: '#fca5a5', fontSize: 11, marginBottom: 6 }}>{err}</div>}
      {ok && <div style={{ color: 'var(--gold)', fontSize: 11, marginBottom: 6 }}>{ok}</div>}
      <button type="submit" className="sidebar-signout" disabled={busy}>{busy ? t('common.wait') : t('auth.savePassword')}</button>
    </form>
  )
}
