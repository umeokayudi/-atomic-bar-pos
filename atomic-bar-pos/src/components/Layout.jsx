import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../lib/useAuth'
import { ROLE_LABEL, ROLE_NAV } from '../lib/roles'
import { BarProvider } from '../lib/BarContext'
import { useBar } from '../lib/useBar'

function Shell() {
  const [time, setTime] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const { user, role, signOut } = useAuth()
  const { bars, bar, setBarId, canSwitch, loading } = useBar()
  const NAV = ROLE_NAV[role] || ROLE_NAV.staff
  const navigate = useNavigate()

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('ja-JP', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo'
    }))
    tick()
    const id = setInterval(tick, 15000)
    return () => clearInterval(id)
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch {
      setSigningOut(false)
    }
  }

  const email = user?.email || 'Equipe'
  const barName = bar?.nome || 'Bar'

  return (
    <div className="shell">
      <aside className="shell-nav">
        <div className="shell-brand">
          <strong>JBM POS</strong>
          <span>{barName}</span>
        </div>
        <nav className="shell-links">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => 'shell-link' + (isActive ? ' is-on' : '')}>
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="shell-foot">
          {canSwitch && bars.length > 1 && (
            <select value={bar?.id || ''} onChange={e => setBarId(e.target.value)} disabled={loading}>
              {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          )}
          {!canSwitch && (
            <div style={{ fontSize: 12, color: 'var(--gold)', marginBottom: 8 }}>{barName}</div>
          )}
          <div style={{ fontSize: 11, color: 'var(--white60)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={email}>
            {email}
          </div>
          <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 4 }}>{ROLE_LABEL[role] || role}</div>
        </div>
      </aside>

      <div className="shell-main">
        <div className="shell-top">
          <div style={{ fontSize: 14, color: 'var(--white90)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {barName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {canSwitch && bars.length > 1 && (
              <select value={bar?.id || ''} onChange={e => setBarId(e.target.value)} style={{
                background: 'var(--white05)', border: '0.5px solid var(--gold-border)',
                borderRadius: 8, color: 'var(--white90)', padding: '6px 8px', fontSize: 12, maxWidth: 180
              }}>
                {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            )}
            <span style={{ fontSize: 12, color: 'var(--white30)', fontVariantNumeric: 'tabular-nums' }}>{time} JST</span>
            <button type="button" onClick={handleSignOut} disabled={signingOut} className="btn" style={{ padding: '5px 10px', fontSize: 12, color: 'var(--gold)' }}>
              {signingOut ? 'Saindo...' : 'Sair'}
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  return (
    <BarProvider>
      <Shell />
    </BarProvider>
  )
}
