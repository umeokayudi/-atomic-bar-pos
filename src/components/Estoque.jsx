import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { fmtYen, fmtDate, Spinner, Empty } from './utils'
import { AdminPage, PortalSurface, PortalAlert } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'

export default function EstoqueTab() {
  const { t } = useI18n()
  const { user, perfil } = useAuth()
  const [produtos,    setProdutos]    = useState([])
  const [movimentos,  setMovimentos]  = useState([])
  const [bars,        setBars]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showForm,    setShowForm]    = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [filterBar,   setFilterBar]   = useState('')
  const [filterProd,  setFilterProd]  = useState('')

  // Open bottle form
  const [formProdId,  setFormProdId]  = useState('')
  const [formBarId,   setFormBarId]   = useState('')
  const [formQtd,     setFormQtd]     = useState(1)
  const [formObs,     setFormObs]     = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [pR, mR, bR] = await Promise.all([
      supabase.from('produtos').select('*').eq('ativo', true).order('categoria').order('nome'),
      supabase.from('estoque_movimentos').select('*, produtos(nome,categoria,custo,preco_venda), bars(nome), perfis(nome)')
        .order('criado_em', { ascending: false }).limit(100),
      supabase.from('bars').select('*').order('nome'),
    ])
    setProdutos(pR.data || [])
    setMovimentos(mR.data || [])
    setBars(bR.data || [])
    if (bR.data && bR.data.length > 0 && !formBarId) setFormBarId(bR.data[0].id)
    if (pR.data && pR.data.length > 0 && !formProdId) setFormProdId(pR.data[0].id)
    setLoading(false)
  }

  // Calculate current stock per product
  const stockMap = {}
  movimentos.forEach(m => {
    const pid = m.produto_id
    if (!stockMap[pid]) stockMap[pid] = 0
    if (m.tipo === 'entrada') stockMap[pid] += m.qtd
    if (m.tipo === 'saida')   stockMap[pid] -= m.qtd
  })

  // Stock from purchases (compras create "entrada" movements)
  const stockList = produtos.map(p => ({
    ...p,
    estoque: stockMap[p.id] || 0,
    movs: movimentos.filter(m => m.produto_id === p.id)
  }))

  async function openBottle() {
    if (!formProdId || !formBarId || formQtd <= 0) return
    setSaving(true)
    await supabase.from('estoque_movimentos').insert({
      produto_id: formProdId,
      bar_id: formBarId,
      tipo: 'saida',
      qtd: formQtd,
      obs: formObs || 'Bottle opened',
      criado_por: user.id
    })
    // Update produto estoque_atual
    const prod = produtos.find(p => p.id === formProdId)
    if (prod) {
      await supabase.from('produtos').update({
        estoque_atual: Math.max(0, (prod.estoque_atual || 0) - formQtd)
      }).eq('id', formProdId)
    }
    setSaving(false)
    setFormObs('')
    setFormQtd(1)
    setShowForm(false)
    loadAll()
  }

  const filtered = movimentos.filter(m => {
    if (filterBar  && m.bar_id !== filterBar) return false
    if (filterProd && m.produto_id !== filterProd) return false
    return true
  })

  const lowStock = stockList.filter(p => p.estoque > 0 && p.estoque <= 3)
  const outStock  = stockList.filter(p => p.estoque <= 0)

  if (loading) return <Spinner text={t('estoque.loading')} />

  return (
    <AdminPage
      title={t('estoque.title')}
      subtitle={t('estoque.subtitle')}
      actions={(
        <button className="btn-primary" onClick={() => setShowForm(x => !x)} style={{ padding: '9px 18px', borderRadius: 10 }}>
          {showForm ? t('common.cancel') : t('estoque.openBottle')}
        </button>
      )}
    >

      {outStock.length > 0 && (
        <PortalAlert variant="red">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('estoque.outOfStock')}</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>{outStock.map(p => p.nome).join(', ')}</div>
        </PortalAlert>
      )}
      {lowStock.length > 0 && (
        <PortalAlert variant="amber">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('estoque.lowStock')}</div>
          <div style={{ fontSize: 12 }}>{lowStock.map(p => p.nome + ' (' + p.estoque + ' ' + t('estoque.rest') + ')').join(', ')}</div>
        </PortalAlert>
      )}

      {showForm && (
        <PortalSurface title={t('estoque.registerOpen')} style={{ marginBottom: 16, border: '2px solid rgba(193,156,86,0.3)' }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <label className="form-label">{t('estoque.product')}</label>
              <select value={formProdId} onChange={e => setFormProdId(e.target.value)}>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">{t('estoque.bar')}</label>
              <select value={formBarId} onChange={e => setFormBarId(e.target.value)}>
                {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">{t('estoque.qty')}</label>
              <input type="number" min="0.1" step="0.1" value={formQtd}
                onChange={e => setFormQtd(+e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label className="form-label">{t('estoque.notesOptional')}</label>
            <input type="text" value={formObs} onChange={e => setFormObs(e.target.value)}
              placeholder={t('estoque.notesPlaceholder')} />
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <button className="btn-primary" onClick={openBottle} disabled={saving}>
              {saving ? t('common.saving') : t('estoque.registerOpenBtn')}
            </button>
          </div>
        </PortalSurface>
      )}

      <PortalSurface title={t('estoque.stockLevels')} style={{ marginBottom: 16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:8 }}>
          {stockList.filter(p => p.estoque > 0 || p.estoque_atual > 0).map(p => {
            const stock = p.estoque || p.estoque_atual || 0
            const status = stock <= 0 ? 'out' : stock <= 3 ? 'low' : 'ok'
            const colors = { out:'var(--red)', low:'var(--amber)', ok:'var(--green)' }
            return (
              <div key={p.id} style={{
                border:'1px solid var(--border)', borderRadius:10,
                padding:'12px 14px', background:'var(--bg2)'
              }}>
                <div style={{ fontSize:12, fontWeight:600, marginBottom:4 }}>{p.nome}</div>
                <div style={{ fontSize:11, color:'var(--text2)', marginBottom:8 }}>{p.categoria}</div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:18, fontWeight:800, color:colors[status] }}>{stock}</span>
                  <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20,
                    background:status==='ok'?'#f0fdf4':status==='low'?'#fffbeb':'#fef2f2',
                    color:colors[status]
                  }}>
                    {status === 'ok' ? t('estoque.ok') : status === 'low' ? t('estoque.low') : t('estoque.empty')}
                  </span>
                </div>
              </div>
            )
          })}
          {stockList.filter(p => p.estoque > 0 || p.estoque_atual > 0).length === 0 && (
            <div style={{ gridColumn:'1/-1' }}>
              <Empty text={t('estoque.noStockData')} />
            </div>
          )}
        </div>
      </PortalSurface>

      <PortalSurface
        title={t('estoque.movementHistory')}
        headerRight={(
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={filterBar} onChange={e => setFilterBar(e.target.value)} style={{ width: 'auto', fontSize: 12 }}>
              <option value="">{t('estoque.allBars')}</option>
              {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
            <select value={filterProd} onChange={e => setFilterProd(e.target.value)} style={{ width: 'auto', fontSize: 12 }}>
              <option value="">{t('estoque.allProducts')}</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        )}
      >
        {filtered.length === 0 ? <Empty text={t('estoque.noMovements')} /> : (
          <table>
            <thead>
              <tr><th>{t('estoque.colDate')}</th><th>{t('estoque.colProduct')}</th><th>{t('estoque.colBar')}</th><th>{t('estoque.colType')}</th><th>{t('estoque.colQty')}</th><th>{t('estoque.colObs')}</th></tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.id}>
                  <td style={{ fontSize: 12 }}>{fmtDate(m.criado_em?.slice(0, 10))}</td>
                  <td style={{ fontWeight: 500, fontSize: 12 }}>{m.produtos?.nome}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{m.bars?.nome || '—'}</td>
                  <td>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: m.tipo === 'entrada' ? '#f0fdf4' : '#fff7ed',
                      color: m.tipo === 'entrada' ? 'var(--green)' : 'var(--amber)',
                    }}>
                      {m.tipo === 'entrada' ? t('estoque.entry') : t('estoque.exit')}
                    </span>
                  </td>
                  <td style={{ fontWeight: 700 }}>{m.qtd}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{m.obs || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PortalSurface>
    </AdminPage>
  )
}
