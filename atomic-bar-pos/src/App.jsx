import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import POS from './pages/POS'
import Estoque from './pages/Estoque'
import Cast from './pages/Cast'
import Relatorio from './pages/Relatorio'
import Usuarios from './pages/Usuarios'
import Login from './pages/Login'
import { AuthProvider } from './lib/AuthContext'
import { useAuth } from './lib/useAuth'
import { ROLE_HOME, canOpenPath } from './lib/roles'

function RequireAuth() {
  const { session, role, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--gold)' }}>
        Carregando...
      </div>
    )
  }

  if (!session) {
    const from = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from }} />
  }

  if (!canOpenPath(role, location.pathname)) {
    return <Navigate to={ROLE_HOME[role] || '/pos'} replace />
  }

  return <Outlet />
}

function HomeRedirect() {
  const { role } = useAuth()
  return <Navigate to={ROLE_HOME[role] || '/pos'} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Layout />}>
              <Route index element={<HomeRedirect />} />
              <Route path="pos" element={<POS />} />
              <Route path="estoque" element={<Estoque />} />
              <Route path="cast" element={<Cast />} />
              <Route path="relatorio" element={<Relatorio />} />
              <Route path="usuarios" element={<Usuarios />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
