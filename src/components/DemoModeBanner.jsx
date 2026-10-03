import { useState } from 'react'
import { isLocalDemo } from '../lib/supabase'
import { writeDemoRole } from '../lib/localDemoClient'

const PORTALS = [
  { role: 'gerente', hash: '#/hq', label: 'Bar' },
  { role: 'caixa', hash: '#/pos', label: 'POS' },
  { role: 'funcionario', hash: '#/jbm', label: 'Employee' },
  { role: 'fornecedor', hash: '#/supplier', label: 'Supplier' },
  { role: 'admin', hash: '#/jbm', label: 'HQ' },
]

function storedRole() {
  try {
    const raw = JSON.parse(localStorage.getItem('atomic-bar-local-demo') || '{}')
    return raw.perfis?.[0]?.role || 'gerente'
  } catch {
    return 'gerente'
  }
}

export default function DemoModeBanner() {
  const [role, setRole] = useState(() => (typeof localStorage === 'undefined' ? 'gerente' : storedRole()))
  if (!isLocalDemo) return null
  return (
    <div className="demo-mode-banner" role="status">
      <span>DEMO — fictional Atomic Bar books in this browser only. Not connected to a database. Not live sales, cash, stock, payroll, or supplier orders.</span>
      <label className="demo-portal-switch">
        DEMO portal
        <select
          aria-label="DEMO portal"
          value={PORTALS.some(item => item.role === role) ? role : 'gerente'}
          onChange={event => {
            const next = event.target.value
            if (!writeDemoRole(next)) return
            setRole(next)
            const portal = PORTALS.find(item => item.role === next)
            if (portal && location.hash !== portal.hash) location.hash = portal.hash
            location.reload()
          }}
        >
          {PORTALS.map(item => (
            <option key={item.role} value={item.role}>{item.label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
