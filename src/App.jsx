import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import POS from './pages/POS'
import Estoque from './pages/Estoque'
import Equipe from './pages/Equipe'
import Relatorio from './pages/Relatorio'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/pos" replace />} />
          <Route path="pos" element={<POS />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="equipe" element={<Equipe />} />
          <Route path="cast" element={<Navigate to="/equipe" replace />} />
          <Route path="relatorio" element={<Relatorio />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
