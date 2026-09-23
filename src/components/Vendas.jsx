import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { fmtYen, fmtDate, monthKey, monthLabel, Badge, Spinner, Empty, DelBtn, isSupplierProduct, filterSupplierVendas } from './utils'
import { AdminPage, PortalSurface, PortalKpi } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'

export default function VendasTab() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [vendas,   setVendas]   = useState([])
  const [produtos, setProdutos] = useState([])
  const [bars,     setBars]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [filterMonth, setFilterMonth] = useState('')
  const [filterBar,   setFilterBar]   = useState('')
  const [form, setForm] = useState({ data: new Date().toISOString().slice(0,10), bar_id: '', obs: '', itens: [] })

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: v }, { data: p }, { data: b }] = await Promise.all([
      supabase.from('vendas').select('*, vendas_itens(*, produtos(*))').order('data', { ascending: false }),
      supabase.from('produtos').select('*').eq('ativo', true).order('nome'),
      supabase.from('bars').select('*').order('nome')
    ])
    setVendas(filterSupplierVendas(v || []))
    setProdutos((p || []).filter(isSupplierProduct))
    setBars(b || [])
    if (b?.length && !form.bar_id) setForm(f => ({ ...f, bar_id: b[0].id }))
    setLoading(false)
  }

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const months = [...new Set(vendas.map(v => monthKey(v.data)))].sort().reverse()

  const filtered = vendas.filter(v =>
    (!filterMonth || monthKey(v.data) === filterMonth) &&
    (!filterBar   || v.bar_id === filterBar)
  )

  const totalReceita = filtered.reduce((a,v) => a + (+v.total||0), 0)

  const totalVendaForm = form.itens.reduce((a, it) => {
    const p = produtos.find(x => x.id === it.produto_id)
    return a + (p ? p.preco_venda * it.qtd : 0)
  }, 0)

  async function saveVenda() {
    if (!form.itens.length) return alert(t('sales.addOneItem'))
    if (!form.bar_id) return alert(t('sales.selectBar'))
    setSaving(true)
    const { data: venda, error } = await supabase.from('vendas').insert({
      data: form.data, bar_id: form.bar_id,
      total: totalVendaForm, obs: form.obs || t('sales.defaultObs'), criado_por: user.id,
    }).select().single()
    if (!error) {
      await supabase.from('vendas_itens').insert(
        form.itens.map(it => {
          const p = produtos.find(x => x.id === it.produto_id)
          return { venda_id: venda.id, produto_id: it.produto_id, qtd: it.qtd, preco_unitario: p?.preco_venda || 0 }
        })
      )
    }
    setSaving(false)
    setForm({ data: new Date().toISOString().slice(0,10), bar_id: bars[0]?.id || '', obs: '', itens: [] })
    loadAll()
  }

  async function deleteVenda(id) {
    if (!confirm(t('sales.confirmDelete'))) return
    await supabase.from('vendas').delete().eq('id', id)
    loadAll()
  }

  return (
    <AdminPage title={t('nav.sales')} subtitle={t('sales.subtitle')}>
      <PortalSurface title={t('sales.registerSale')}>
        <div className="grid3" style={{ marginBottom: 12 }}>
          <div><label className="form-label">{t('common.date')}</label>
            <input type="date" value={form.data} onChange={e=>setF('data',e.target.value)} /></div>
          <div><label className="form-label">{t('common.bar')}</label>
            <select value={form.bar_id} onChange={e=>setF('bar_id',e.target.value)}>
              {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select></div>
          <div><label className="form-label">{t('common.observation')}</label>
            <input type="text" value={form.obs} onChange={e=>setF('obs',e.target.value)} /></div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <label className="form-label" style={{ margin:0 }}>{t('sales.itemsSold')}</label>
            <button style={{ padding:'4px 10px', fontSize:11 }}
              onClick={() => setF('itens', [...form.itens, { produto_id: produtos[0]?.id || '', qtd: 1 }])}>
              {t('common.addItem')}
            </button>
          </div>
          {form.itens.map((it, i) => {
            const prod = produtos.find(p => p.id === it.produto_id)
            return (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 80px 1fr 36px', gap:6, marginBottom:6, alignItems:'center' }}>
                <select value={it.produto_id} onChange={e=>{
                  const a=[...form.itens]; a[i]={...a[i],produto_id:e.target.value}; setF('itens',a)
                }}>
                  {produtos.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
                <input type="number" value={it.qtd} min={1} onChange={e=>{
                  const a=[...form.itens]; a[i]={...a[i],qtd:+e.target.value}; setF('itens',a)
                }}/>
                <span style={{ fontSize:13, color:'var(--text2)' }}>
                  {prod ? fmtYen(prod.preco_venda * it.qtd) : '—'}
                </span>
                <button onClick={()=>setF('itens',form.itens.filter((_,j)=>j!==i))}
                  style={{ padding:0, fontSize:14 }}>✕</button>
              </div>
            )
          })}
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:14 }}>{t('common.total')}: <strong>{fmtYen(totalVendaForm)}</strong></div>
          <button className="btn-primary" onClick={saveVenda} disabled={saving}>
            {saving ? <><span className="spinner" />{t('common.saving')}</> : t('sales.saveSale')}
          </button>
        </div>
      </PortalSurface>

      <PortalSurface
        title={t('common.history')}
        headerRight={
          <div style={{ display:'flex', gap:8 }}>
            <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{ width:'auto' }}>
              <option value="">{t('common.allMonths')}</option>
              {months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <select value={filterBar} onChange={e=>setFilterBar(e.target.value)} style={{ width:'auto' }}>
              <option value="">{t('common.allBars')}</option>
              {bars.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </div>
        }
      >
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:14 }}>
          <PortalKpi label={t('sales.totalSold')} value={fmtYen(totalReceita)} color="var(--blue)" />
        </div>

        {loading ? <Spinner /> : filtered.length === 0 ? <Empty text={t('sales.noSales')} /> : (
          <table>
            <thead>
              <tr><th>{t('common.date')}</th><th>{t('common.bar')}</th><th>{t('common.items')}</th><th>{t('common.total')}</th><th>{t('common.obs')}</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(v => {
                const bar = bars.find(b => b.id === v.bar_id)
                return (
                  <tr key={v.id}>
                    <td style={{ whiteSpace:'nowrap' }}>{fmtDate(v.data)}</td>
                    <td><Badge color={bar?.cor||'var(--blue)'}>{bar?.nome||'?'}</Badge></td>
                    <td style={{ fontSize:12, color:'var(--text2)', maxWidth:200 }}>
                      {(v.vendas_itens||[]).map(it=>
                        `${it.produtos?.nome||'?'} ×${it.qtd}`
                      ).join(' · ')}
                    </td>
                    <td style={{ fontWeight:700 }}>{fmtYen(v.total)}</td>
                    <td style={{ color:'var(--text2)' }}>{v.obs||'—'}</td>
                    <td><DelBtn onClick={()=>deleteVenda(v.id)} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </PortalSurface>
    </AdminPage>
  )
}
