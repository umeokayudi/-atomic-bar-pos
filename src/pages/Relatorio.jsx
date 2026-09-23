import { useState, useEffect } from 'react'
import { supabase, BAR_ID } from '../lib/supabase'
import { custoMensalEstimado } from '../lib/payroll'

const fmt = n => '¥' + Math.round(n).toLocaleString('ja-JP')
const fmtDate = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })

export default function Relatorio() {
  const [vendas, setVendas] = useState([])
  const [caixa, setCaixa] = useState([])
  const [compras, setCompras] = useState([])
  const [custos, setCustos] = useState([])
  const [vip, setVip] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('hoje')

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const monthStart = today.slice(0, 7) + '-01'

  const dateFilter = period === 'hoje' ? today : monthStart

  useEffect(() => {
    async function load() {
      const [{ data: vData }, { data: cxData }, { data: compData }, { data: custoData }, { data: vipData }] = await Promise.all([
        supabase.from('vendas').select('*, vendas_itens(*)').eq('bar_id', BAR_ID).gte('data_venda', dateFilter).order('data_venda', { ascending: false }),
        supabase.from('caixa_movimentos').select('*').eq('bar_id', BAR_ID).gte('data', dateFilter).order('data', { ascending: false }),
        supabase.from('compras').select('*, compras_itens(*)').eq('bar_id', BAR_ID).gte('data_emissao', dateFilter),
        supabase.from('custos_locais').select('*').eq('ativo', true),
        supabase.from('sessoes_vip').select('*').eq('bar_id', BAR_ID).gte('inicio', dateFilter),
      ])
      setVendas(vData || [])
      setCaixa(cxData || [])
      setCompras(compData || [])
      setCustos(custoData || [])
      setVip(vipData || [])
      setLoading(false)
    }
    load()

    // Real-time: listen to vendas and caixa_movimentos
    const ch = supabase.channel('relatorio-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vendas', filter: `bar_id=eq.${BAR_ID}` }, async () => {
        const { data } = await supabase.from('vendas').select('*, vendas_itens(*)').eq('bar_id', BAR_ID).gte('data_venda', dateFilter).order('data_venda', { ascending: false })
        setVendas(data || [])
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'caixa_movimentos', filter: `bar_id=eq.${BAR_ID}` }, (payload) => {
        setCaixa(prev => [payload.new, ...prev])
      })
      .subscribe()

    return () => supabase.removeChannel(ch)
  }, [period])

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
  const pagamentosStaff = caixa.filter(c => c.referencia_tipo === 'pagamento_staff').reduce((s, c) => s + (c.valor || 0), 0)

  const fixosMes = custos.filter(c => c.natureza === 'fixo').reduce((s, c) => s + custoMensalEstimado(c), 0)
  const variaveisPeriodo = custos.filter(c => {
    if (c.natureza !== 'variavel') return false
    const d = String(c.data || '').slice(0, 10)
    return d >= dateFilter
  }).reduce((s, c) => s + (Number(c.valor) || 0), 0)
  const custosLocais = period === 'hoje' ? (fixosMes / 30) + variaveisPeriodo : fixosMes + variaveisPeriodo

  const vipTotal = vip.filter(s => s.status === 'encerrada').reduce((s, x) => s + (Number(x.valor) || 0), 0)

  const metrics = [
    { label: 'Vendas Brutas', val: fmt(totalVendasBruto), sub: `${vendas.length} pedidos` },
    { label: 'Salas VIP', val: fmt(vipTotal), sub: `${vip.filter(s => s.status === 'encerrada').length} sessões no caixa` },
    { label: 'Saldo Caixa', val: fmt(saldoCaixa), sub: 'Após taxas e comissões' },
    { label: 'Custo Bebidas', val: fmt(custoCompras), sub: `${compras.length} compras` },
    { label: 'Custos locais', val: fmt(custosLocais), sub: period === 'hoje' ? 'Fixos/30 + variáveis' : 'Fixos do mês + variáveis' },
    { label: 'Comissões Cast', val: fmt(comissoes), sub: 'Drink backs' },
    { label: 'Pagamentos staff', val: fmt(pagamentosStaff), sub: 'Hora / comissão' },
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'var(--white30)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <span>Data / Mesa</span><span>Pgto</span><span>Itens</span><span>Comissão</span><span style={{ textAlign: 'right' }}>Total</span>
        </div>
        {vendas.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--white30)', padding: 24, fontSize: 13 }}>Nenhum pedido no período</div>
        )}
        {vendas.slice(0, 30).map(v => (
          <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.04)', fontSize: 13, alignItems: 'center' }}>
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
            <span style={{ color: 'var(--white60)' }}>{v.vendas_itens?.length || 0}</span>
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
