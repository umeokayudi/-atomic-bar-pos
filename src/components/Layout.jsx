import { NavLink, Outlet } from 'react-router-dom'
import { useState, useEffect } from 'react'

const NAV = [
  { to: '/pos',       icon: '🧾', label: 'POS / Caixa' },
  { to: '/estoque',   icon: '📦', label: 'Estoque' },
  { to: '/equipe',    icon: '👥', label: 'Pessoal' },
  { to: '/relatorio', icon: '📊', label: 'Relatório' },
]

export default function Layout() {
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('ja-JP', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo'
    }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: 200, flexShrink: 0,
        background: 'var(--navy2)',
        borderRight: '0.5px solid var(--gold-border)',
        display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '20px 16px 16px', borderBottom: '0.5px solid var(--gold-border)' }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--gold)', letterSpacing: 3 }}>ATOMIC</div>
          <div style={{ fontSize: 10, color: 'var(--white30)', letterSpacing: 1.5, marginTop: 2 }}>BAR SYSTEM</div>
        </div>
        <nav style={{ padding: '12px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 7, fontSize: 13,
              textDecoration: 'none', transition: 'all 0.15s',
              background: isActive ? 'var(--gold-dim)' : 'none',
              color: isActive ? 'var(--gold)' : 'var(--white60)',
              border: isActive ? '0.5px solid var(--gold-border)' : '0.5px solid transparent',
            })}>
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--gold-border)', fontSize: 11, color: 'var(--white30)' }}>
          Atomic Bar · Shinjuku
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div style={{
          height: 52, flexShrink: 0,
          background: 'var(--navy2)',
          borderBottom: '0.5px solid var(--gold-border)',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 20px'
        }}>
          <div style={{ fontSize: 14, color: 'var(--white60)' }}>
            <span style={{ color: 'var(--gold)' }}>●</span>&nbsp; Sistema Ativo
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 12, color: 'var(--white30)', fontVariantNumeric: 'tabular-nums' }}>{time} JST</span>
          </div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
