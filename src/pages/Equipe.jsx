import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import CadastroStaff from './equipe/CadastroStaff'
import Pagamentos from './equipe/Pagamentos'
import Custos from './equipe/Custos'
import { Chip } from '../components/ui'

const TABS = [
  { id: 'equipe', label: 'Equipe' },
  { id: 'pagamentos', label: 'Pagamentos' },
  { id: 'custos', label: 'Custos por local' },
]

export default function Equipe() {
  const [tab, setTab] = useState('equipe')
  const [locais, setLocais] = useState([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('locais').select('*').eq('ativo', true).order('nome')
      if (cancelled) return
      if (error) { setLocais([]); return }
      if (!data?.length) {
        const { data: created } = await supabase.from('locais').insert({ nome: 'Atomic Bar · Shinjuku', ativo: true }).select()
        if (!cancelled) setLocais(created || [])
        return
      }
      setLocais(data)
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>Pessoal & custos</h2>
          <div style={{ fontSize: 12, color: 'var(--white60)' }}>
            Cadastro da equipe, vencimento de pagamentos e custos de cada local
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(t => (
            <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</Chip>
          ))}
        </div>
      </div>

      {tab === 'equipe' && <CadastroStaff locais={locais} onChanged={() => setTick(n => n + 1)} />}
      {tab === 'pagamentos' && <Pagamentos tick={tick} />}
      {tab === 'custos' && <Custos locais={locais} onLocaisChange={() => {
        supabase.from('locais').select('*').eq('ativo', true).order('nome').then(({ data }) => setLocais(data || []))
      }} />}
    </div>
  )
}
