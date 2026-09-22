import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { ROLE_HOME, canOpenPath, roleFromUser } from '../lib/roles'

const AREAS = [
  { icon: '🧾', label: 'POS / Caixa' },
  { icon: '📦', label: 'Estoque' },
  { icon: '👥', label: 'Cast' },
  { icon: '📊', label: 'Relatório' },
]

function authErrorMessage(error) {
  const msg = (error?.message || '').toLowerCase()
  if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
    return 'E-mail ou senha incorretos.'
  }
  if (msg.includes('email not confirmed')) {
    return 'Confirme o e-mail antes de entrar.'
  }
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed')) {
    return 'Sem conexão com o servidor. Tente de novo.'
  }
  return 'Não foi possível entrar. Verifique os dados e tente de novo.'
}

const fieldStyle = {
  width: '100%',
  background: 'var(--white05)',
  border: '0.5px solid var(--gold-border)',
  borderRadius: 8,
  color: 'var(--white90)',
  padding: '11px 12px',
  fontSize: 14,
  outline: 'none',
}

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const requested = location.state?.from

  function pathAfterLogin(user) {
    const role = roleFromUser(user)
    const home = ROLE_HOME[role] || '/pos'
    if (requested && requested !== '/login' && canOpenPath(role, requested)) return requested
    return home
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--gold)' }}>
        Carregando...
      </div>
    )
  }

  if (session) return <Navigate to={pathAfterLogin(session.user)} replace />

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Informe e-mail e senha.')
      return
    }
    setSubmitting(true)
    try {
      const data = await signIn(email, password)
      navigate(pathAfterLogin(data.user), { replace: true })
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'radial-gradient(ellipse at top, #002255 0%, var(--navy) 55%)',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--gold)', letterSpacing: 4 }}>JBM POS</div>
          <div style={{ fontSize: 11, color: 'var(--white30)', letterSpacing: 2, marginTop: 4 }}>BAR</div>
        </div>

        <form onSubmit={handleSubmit} style={{
          background: 'var(--navy2)',
          border: '0.5px solid var(--gold-border)',
          borderRadius: 14,
          padding: 28,
        }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, marginBottom: 6 }}>Entrar no sistema</h1>
          <p style={{ fontSize: 13, color: 'var(--white60)', marginBottom: 18 }}>
            POS do bar. Cada local entra com a conta dele. JBM Supply é outro site.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
            {AREAS.map(area => (
              <span key={area.label} className="tag tag-gold">
                {area.icon} {area.label}
              </span>
            ))}
          </div>

          <label style={{ display: 'block', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--white60)', marginBottom: 6 }}>E-mail</div>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="equipe@atomic.bar"
              style={fieldStyle}
              required
            />
          </label>

          <label style={{ display: 'block', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--white60)', marginBottom: 6 }}>Senha</div>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Sua senha"
                style={{ ...fieldStyle, paddingRight: 84 }}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--gold)', fontSize: 12, padding: '4px 6px',
                }}
              >
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </label>

          {error && (
            <div style={{
              marginBottom: 14,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--danger-dim)',
              color: 'var(--danger)',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--gold)',
              color: 'var(--navy)',
              fontWeight: 600,
              fontSize: 14,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>

          <p style={{ fontSize: 12, color: 'var(--white30)', marginTop: 16, lineHeight: 1.5 }}>
            Cada bar tem conta e dados separados. Fornecimento JBM: bebidas-control.vercel.app
          </p>
        </form>
      </div>
    </div>
  )
}
