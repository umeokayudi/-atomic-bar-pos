import { useState, useEffect } from 'react'
import { supabase, BAR_ID } from '../lib/supabase'

const fmt = n => '¥' + Math.round(n).toLocaleString('ja-JP')

export default function Estoque() {
  const [produtos, setProdutos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('todos')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('produtos')
        .select('*')
        .eq('bar_id', BAR_ID)
        .order('categoria')
        .order('nome')
      setProdutos(data || [])
      setLoading(false)
    }
    load()

    // Real-time subscription
    const channel = supabase
      .channel('estoque-realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'produtos',
        filter: `bar_id=eq.${BAR_ID}`
      }, payload => {
        setProdutos(prev => {
          if (payload.eventType === 'UPDATE') {
            return prev.map(p => p.id === payload.new.id ? payload.new : p)
          }
          if (payload.eventType === 'INSERT') return [...prev, payload.new]
          if (payload.eventType === 'DELETE') return prev.filter(p => p.id !== payload.old.id)
          return prev
        })
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const cats = ['todos', ...new Set(produtos.map(p => p.categoria))]
  const filtered = filter === 'todos' ? produtos : filter === 'baixo'
    ? produtos.filter(p => (p.estoque_atual || 0) < (p.estoque_minimo || 5))
    : produtos.filter(p => p.categoria === filter)

  const lowCount = produtos.filter(p => (p.estoque_atual || 0) < (p.estoque_minimo || 5)).length

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--gold)' }}>Carregando...</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>Estoque</h2>
          <div style={{ fontSize: 12, color: 'var(--white60)' }}>
            {produtos.length} produtos · atualização em tempo real
            {lowCount > 0 && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>⚠ {lowCount} baixo</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setFilter('baixo')} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
            background: filter === 'baixo' ? 'var(--danger-dim)' : 'none',
            color: filter === 'baixo' ? 'var(--danger)' : 'var(--white60)',
            border: `0.5px solid ${filter === 'baixo' ? 'var(--danger)' : 'var(--gold-border)'}`,
          }}>⚠ Baixo Estoque</button>
          {cats.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
              background: filter === c ? 'var(--gold-dim)' : 'none',
              color: filter === c ? 'var(--gold)' : 'var(--white60)',
              border: `0.5px solid ${filter === c ? 'var(--gold)' : 'var(--gold-border)'}`,
            }}>{c.charAt(0).toUpperCase() + c.slice(1)}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {filtered.map(p => {
          const qty = p.estoque_atual || 0
          const min = p.estoque_minimo || 5
          const max = p.estoque_maximo || min * 4
          const pct = Math.min(100, Math.round(qty / max * 100))
          const isLow = qty < min

          return (
            <div key={p.id} style={{
              background: isLow ? 'rgba(232,85,85,0.05)' : 'var(--white05)',
              border: `0.5px solid ${isLow ? 'rgba(232,85,85,0.3)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 10, padding: 14
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{p.nome}</span>
                {isLow && <span style={{ fontSize: 10, color: 'var(--danger)' }}>⚠ BAIXO</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 24, fontWeight: 500, color: isLow ? 'var(--danger)' : 'var(--gold)' }}>{qty}</span>
                <span style={{ fontSize: 11, color: 'var(--white30)' }}>{p.unidade || 'un'}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--white30)', marginBottom: 8 }}>
                Mín: {min} · Custo: {fmt(p.preco_custo || 0)}
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: isLow ? 'var(--danger)' : 'var(--success)', transition: 'width 0.3s' }} />
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--white30)', padding: 40 }}>
            Nenhum produto encontrado
          </div>
        )}
      </div>
    </div>
  )
}
