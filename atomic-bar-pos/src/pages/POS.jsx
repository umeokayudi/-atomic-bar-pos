import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useBar } from '../lib/useBar'

const fmt = n => '¥' + Math.round(n).toLocaleString('ja-JP')

// Drink-back commission: 50% freelancer, 30% in-house above ¥2000
function calcCommission(castMember, item) {
  if (!castMember) return 0
  const rate = castMember.tipo === 'freelancer' ? 0.5 : (item.price > 2000 ? 0.3 : 0)
  return Math.round(item.price * rate)
}

export default function POS() {
  const { barId, bar } = useBar()
  const [produtos, setProdutos] = useState([])
  const [cat, setCat] = useState(null)
  const [order, setOrder] = useState([])
  const [payment, setPayment] = useState('dinheiro')
  const [mesa, setMesa] = useState('Mesa 1')
  const [cast, setCast] = useState([])
  const [selectedCast, setSelectedCast] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [modal, setModal] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    if (!barId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: prods }, { data: castData }] = await Promise.all([
        supabase.from('produtos').select('id,nome,categoria,preco_venda,estoque_atual').eq('bar_id', barId).order('categoria').order('nome'),
        supabase.from('cast_members').select('id,nome,tipo,ativo').eq('bar_id', barId).eq('ativo', true).order('nome')
      ])
      if (cancelled) return
      setProdutos(prods || [])
      setCast(castData || [])
      setOrder([])
      setSelectedCast(null)
      if (prods?.length) setCat(prods[0].categoria)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [barId])

  const cats = [...new Set(produtos.map(p => p.categoria))]
  const filtered = produtos.filter(p => p.categoria === cat)

  const addItem = (produto) => {
    setOrder(prev => {
      const ex = prev.find(o => o.produto_id === produto.id)
      if (ex) return prev.map(o => o.produto_id === produto.id ? { ...o, qty: o.qty + 1 } : o)
      return [...prev, { produto_id: produto.id, nome: produto.nome, price: produto.preco_venda, qty: 1, premium: produto.preco_venda >= 2000 }]
    })
  }

  const changeQty = (id, delta) => {
    setOrder(prev => {
      const updated = prev.map(o => o.produto_id === id ? { ...o, qty: o.qty + delta } : o)
      return updated.filter(o => o.qty > 0)
    })
  }

  const subtotal = order.reduce((s, o) => s + o.price * o.qty, 0)
  const surcharge = payment === 'cartao' ? Math.round(subtotal * 0.25) : 0
  const processorFee = payment === 'cartao' ? Math.round(subtotal * 0.0378) : 0
  const grandTotal = subtotal + surcharge
  const barRevenue = grandTotal - processorFee
  const totalCommission = selectedCast
    ? order.reduce((s, o) => s + calcCommission(selectedCast, o) * o.qty, 0)
    : 0
  const barProfit = barRevenue - totalCommission

  async function confirmOrder() {
    if (!order.length) return
    setSubmitting(true)
    try {
      // 1. Insert venda
      const { data: venda, error: vendaErr } = await supabase
        .from('vendas')
        .insert({
          bar_id: barId,
          data_venda: new Date().toISOString(),
          total: grandTotal,
          forma_pagamento: payment,
          mesa,
          cast_id: selectedCast?.id || null,
          comissao_total: totalCommission,
          status: 'confirmada'
        })
        .select()
        .single()
      if (vendaErr) throw vendaErr

      // 2. Insert vendas_itens
      const itens = order.map(o => ({
        venda_id: venda.id,
        produto_id: o.produto_id,
        quantidade: o.qty,
        preco_unitario: o.price,
        subtotal: o.price * o.qty,
        comissao: selectedCast ? calcCommission(selectedCast, o) * o.qty : 0
      }))
      const { error: itensErr } = await supabase.from('vendas_itens').insert(itens)
      if (itensErr) throw itensErr

      // 3. Debit stock for each item
      for (const item of order) {
        await supabase.rpc('deduct_stock', {
          p_produto_id: item.produto_id,
          p_qty: item.qty
        })
      }

      // 4. Insert caixa_movimentos
      const { error: cxErr } = await supabase.from('caixa_movimentos').insert({
        bar_id: barId,
        tipo: 'entrada',
        valor: barRevenue,
        descricao: `Venda ${mesa} - ${payment}`,
        referencia_id: venda.id,
        referencia_tipo: 'venda',
        data: new Date().toISOString()
      })
      if (cxErr) throw cxErr

      // 5. If card, insert fee as saida
      if (payment === 'cartao' && processorFee > 0) {
        await supabase.from('caixa_movimentos').insert({
          bar_id: barId,
          tipo: 'saida',
          valor: processorFee,
          descricao: `Taxa cartão (3.78%) - ${mesa}`,
          referencia_id: venda.id,
          referencia_tipo: 'taxa_cartao',
          data: new Date().toISOString()
        })
      }

      // 6. If cast commission, insert saida
      if (totalCommission > 0) {
        await supabase.from('caixa_movimentos').insert({
          bar_id: barId,
          tipo: 'saida',
          valor: totalCommission,
          descricao: `Comissão ${selectedCast.nome} - ${mesa}`,
          referencia_id: venda.id,
          referencia_tipo: 'comissao',
          data: new Date().toISOString()
        })
        // Also log to cast_comissoes
        await supabase.from('cast_comissoes').insert({
          cast_id: selectedCast.id,
          venda_id: venda.id,
          valor: totalCommission,
          data: new Date().toISOString()
        })
      }

      setOrder([])
      setModal(false)
      showToast(`Pedido confirmado: ${fmt(grandTotal)}`)
    } catch (err) {
      console.error(err)
      showToast('Erro ao confirmar pedido', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--gold)' }}>
      Carregando cardápio...
    </div>
  )

  return (
    <div className="pos-shell">
      {/* LEFT: Menu */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Category tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '12px 16px', borderBottom: '0.5px solid var(--gold-border)', flexWrap: 'wrap' }}>
          {cats.map(c => (
            <button key={c} onClick={() => setCat(c)} style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
              background: cat === c ? 'var(--gold-dim)' : 'none',
              color: cat === c ? 'var(--gold)' : 'var(--white60)',
              border: `0.5px solid ${cat === c ? 'var(--gold)' : 'var(--gold-border)'}`,
              transition: 'all 0.15s'
            }}>{c}</button>
          ))}
        </div>
        {/* Products grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {filtered.map(p => (
              <div key={p.id} onClick={() => addItem(p)} style={{
                background: 'var(--white05)',
                border: `0.5px solid ${p.preco_venda >= 2000 ? 'var(--gold-border)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 8, padding: '12px 10px', cursor: 'pointer',
                textAlign: 'center', transition: 'all 0.15s', userSelect: 'none'
              }}>
                {p.preco_venda >= 2000 && <div style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: 0.5, marginBottom: 3 }}>PREMIUM</div>}
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{p.nome}</div>
                <div style={{ fontSize: 14, color: 'var(--gold)', fontWeight: 500 }}>{fmt(p.preco_venda)}</div>
                {p.estoque_atual !== undefined && (
                  <div style={{ fontSize: 10, color: p.estoque_atual < 5 ? 'var(--danger)' : 'var(--white30)', marginTop: 4 }}>
                    {p.estoque_atual} un.
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--white30)', padding: 32, fontSize: 13 }}>
                Nenhum produto nesta categoria
              </div>
            )}
          </div>
        </div>
      </div>

      <aside className="ticket">
        <div className="ticket-head">
            <select value={mesa} onChange={e => setMesa(e.target.value)}>
              {['Mesa 1','Mesa 2','Mesa 3','Mesa 4','Mesa 5','Mesa 6','Balcão','Takeout'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select value={selectedCast?.id || ''} onChange={e => {
              const c = cast.find(c => c.id === e.target.value)
              setSelectedCast(c || null)
            }}>
              <option value=''>Sem cast</option>
              {cast.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
        </div>

        <div className="ticket-list">
          {order.length === 0
            ? <div className="ticket-empty">Toque no produto para lançar<br /><span style={{ color: 'var(--white30)' }}>{bar?.nome || 'Pedido'}</span></div>
            : order.map(o => (
              <div key={o.produto_id} className="ticket-line">
                <div className="ticket-qty">
                  <button type="button" onClick={() => changeQty(o.produto_id, -1)}>−</button>
                  <span style={{ fontSize: 14, fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{o.qty}</span>
                  <button type="button" onClick={() => changeQty(o.produto_id, 1)}>+</button>
                </div>
                <div>
                  <strong>{o.nome}</strong>
                  <em>{fmt(o.price)} un.</em>
                </div>
                <span style={{ fontSize: 14, color: 'var(--gold)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(o.price * o.qty)}</span>
              </div>
            ))
          }
        </div>

        <div className="ticket-foot">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {['dinheiro','cartao'].map(p => (
              <button key={p} type="button" onClick={() => setPayment(p)} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12,
                border: `0.5px solid ${payment === p ? 'var(--gold)' : 'var(--gold-border)'}`,
                background: payment === p ? 'var(--gold-dim)' : 'none',
                color: payment === p ? 'var(--gold)' : 'var(--white60)',
              }}>
                {p === 'dinheiro' ? 'Dinheiro' : 'Cartão'}
              </button>
            ))}
          </div>
          <div className="row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            {surcharge > 0 && (
              <div className="row" style={{ color: 'var(--warning)' }}>
                <span>Cartão +25%</span>
                <span>{fmt(surcharge)}</span>
              </div>
            )}
            {totalCommission > 0 && (
              <div className="row" style={{ fontSize: 12 }}>
                <span>Comissão {selectedCast?.nome}</span>
                <span>−{fmt(totalCommission)}</span>
              </div>
            )}
            <div className="row total">
              <span>Total</span>
              <span>{fmt(grandTotal)}</span>
            </div>
            {totalCommission > 0 && (
              <div className="row" style={{ fontSize: 11 }}>
                <span>Lucro bar</span>
                <span>{fmt(barProfit)}</span>
              </div>
            )}
          <button
            onClick={() => setModal(true)}
            disabled={order.length === 0 || submitting}
            style={{
              width: '100%', marginTop: 12, padding: 12,
              background: order.length ? 'var(--gold)' : 'rgba(193,156,86,0.3)',
              color: 'var(--navy)', fontWeight: 700, fontSize: 14,
              border: 'none', borderRadius: 10, cursor: order.length ? 'pointer' : 'not-allowed',
            }}
          >
            Confirmar
          </button>
        </div>
      </aside>

      {/* Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,10,28,0.9)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--navy2)', border: '0.5px solid var(--gold-border)', borderRadius: 12, padding: 24, width: 340 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--gold)', marginBottom: 16 }}>Confirmar Pedido</div>
            <div style={{ fontSize: 12, color: 'var(--white60)', marginBottom: 12 }}>{mesa} · {selectedCast ? selectedCast.nome : 'Sem cast'} · {payment === 'cartao' ? 'Cartão' : 'Dinheiro'}</div>
            {order.map(o => (
              <div key={o.produto_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
                <span>{o.qty}× {o.nome}</span>
                <span>{fmt(o.price * o.qty)}</span>
              </div>
            ))}
            {surcharge > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', color: 'var(--warning)' }}>
                <span>Cartão +25%</span><span>{fmt(surcharge)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, fontSize: 16, color: 'var(--gold)', borderTop: '1px solid var(--gold-border)', paddingTop: 12, marginTop: 8 }}>
              <span>Total</span><span>{fmt(grandTotal)}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setModal(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '0.5px solid var(--gold-border)', background: 'none', color: 'var(--white90)', fontSize: 13 }}>Cancelar</button>
              <button onClick={confirmOrder} disabled={submitting} style={{ flex: 1, padding: 10, borderRadius: 8, background: 'var(--gold)', color: 'var(--navy)', border: 'none', fontWeight: 600, fontSize: 13 }}>
                {submitting ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 200,
          background: toast.type === 'error' ? 'var(--danger)' : 'var(--success)',
          color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
