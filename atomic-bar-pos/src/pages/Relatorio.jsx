import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useBar } from '../lib/useBar'

const fmt = n => '¥' + Math.round(n).toLocaleString('ja-JP')
const fmtDate = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })

export default function Relatorio() {
  const { barId } = useBar()
  const [vendas, setVendas] = useState([])
  const [caixa, setCaixa] = useState([])
  const [compras, setCompras] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('hoje')

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const monthStart = today.slice(0, 7) + '-01'

  const dateFilter = period === 'hoje' ? today : monthStart

  useEffect(() => {
    if (!barId) return
    async function load() {
      const [{ data: vData }, { data: cxData }, { data: compData }] = await Promise.all([
        supabase.from('vendas').select('id,total,forma_pagamento,data_venda,mesa,comissao_total').eq('bar_id', barId).gte('data_venda', dateFilter).order('data_venda', { ascending: false }).limit(80),
        supabase.from('caixa_movimentos').select('id,tipo,valor,descricao,data,referencia_tipo').eq('bar_id', barId).gte('data', dateFilter).order('data', { ascending: false }).limit(80),
        supabase.from('compras').select('id,total,data_emissao').eq('bar_id', barId).gte('data_emissao', dateFilter).limit(80)
      ])
      setVendas(vData || [])
      setCaixa(cxData || [])
      setCompras(compData || [])
      setLoading(false)
    }
    load()

    const ch = supabase.channel('relatorio-rt-' + barId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vendas', filter: `bar_id=eq.${barId}` }, () => { load() })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'caixa_movimentos', filter: `bar_id=eq.${barId}` }, (payload) => {
        setCaixa(prev => [payload.new, ...prev].slice(0, 80))
      })
      .subscribe()

    return () => supabase.removeChannel(ch)
  }, [period, barId])

  // Metrics
  const totalVendasBruto = vendas.reduce((s, v) => s + (v.total || 0), 0)
  const vendasDinheiro = vendas.filter(v => v.forma_pagamento === 'dinheiro').reduce((s, v) => s + (v.total || 0), 0)
  const vendasCartao = vendas.filter(v => v.forma_pagamento === 'cartao').reduce((s, v) => s + (v.total || 0), 0)

  const entradas = caixa.filter(c => c.tipo === 'entrada').reduce((s, c) => s + (c.valor || 0), 0)
  const saidas = caixa.filter(c => c.tipo === 'saida').reduce((s, c) => s + (c.valor || 0), 0)
  const taxasCartao = caixa.filter(c => c.referencia_tipo === 'taxa_cartao').reduce((s, c) => s + (c.valor || 0), 0)
  const comissoes = caixa.filter(c => c.referencia_tipo === 'comissao').reduce((s, c) => s + (c.valor || 0), 0)
  const custoCompras = compras.reduce((s, c) => s + (c.total || 0), 0)
  const saldoCaixa = entradas - saidas

  const metrics = [
    { label: 'Vendas Brutas', val: fmt(totalVendasBruto), sub: `${vendas.length} pedidos` },
    { label: 'Saldo Caixa', val: fmt(saldoCaixa), sub: 'Após taxas e comissões' },
    { label: 'Custo Bebidas', val: fmt(custoCompras), sub: `${compras.length} compras` },
    { label: 'Comissões Cast', val: fmt(comissoes), sub: 'Drink backs' },
    { label: 'Dinheiro', val: fmt(vendasDinheiro), sub: 'Pagamento' },
    { label: 'Cartão (+taxa)', val: fmt(vendasCartao), sub: `Taxa: ${fmt(taxasCartao)}` },
  ]

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--gold)' }}>Carregando...</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>Relatório</h2>
          <div style={{ fontSize: 12, color: 'var(--white60)' }}>
            <span style={{ color: 'var(--gold)' }}>●</span> Atualização em tempo real
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['hoje', 'mes'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
              background: period === p ? 'var(--gold-dim)' : 'none',
              color: period === p ? 'var(--gold)' : 'var(--white60)',
              border: `0.5px solid ${period === p ? 'var(--gold)' : 'var(--gold-border)'}`,
            }}>{p === 'hoje' ? 'Hoje' : 'Este mês'}</button>
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        {metrics.map(m => (
          <div key={m.label} style={{ background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--white30)', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }}>{m.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>{m.val}</div>
            <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 2 }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Vendas table */}
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--white30)', marginBottom: 8 }}>Pedidos</div>
      <div style={{ background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'var(--white30)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <span>Data / Mesa</span><span>Pgto</span><span>Comissão</span><span style={{ textAlign: 'right' }}>Total</span>
        </div>
        {vendas.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--white30)', padding: 24, fontSize: 13 }}>Nenhum pedido no período</div>
        )}
        {vendas.slice(0, 30).map(v => (
          <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.04)', fontSize: 13, alignItems: 'center' }}>
            <span>
              <div>{v.mesa}</div>
              <div style={{ fontSize: 11, color: 'var(--white30)' }}>{fmtDate(v.data_venda)}</div>
            </span>
            <span>
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 10,
                background: v.forma_pagamento === 'dinheiro' ? 'var(--success-dim)' : 'var(--gold-dim)',
                color: v.forma_pagamento === 'dinheiro' ? 'var(--success)' : 'var(--gold)'
              }}>
                {v.forma_pagamento === 'dinheiro' ? '💴' : '💳'}
              </span>
            </span>
            <span style={{ color: (v.comissao_total || 0) > 0 ? 'var(--warning)' : 'var(--white30)' }}>
              {(v.comissao_total || 0) > 0 ? fmt(v.comissao_total) : '—'}
            </span>
            <span style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmt(v.total)}</span>
          </div>
        ))}
      </div>

      {/* Caixa movimentos */}
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--white30)', marginBottom: 8 }}>Movimentos Caixa</div>
      <div style={{ background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
        {caixa.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--white30)', padding: 24, fontSize: 13 }}>Sem movimentos</div>
        )}
        {caixa.slice(0, 20).map((m, i) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: i < caixa.length - 1 ? '0.5px solid rgba(255,255,255,0.04)' : 'none', fontSize: 13 }}>
            <div>
              <div>{m.descricao}</div>
              <div style={{ fontSize: 11, color: 'var(--white30)' }}>{fmtDate(m.data)}</div>
            </div>
            <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: m.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)' }}>
              {m.tipo === 'entrada' ? '+' : '−'}{fmt(m.valor)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
