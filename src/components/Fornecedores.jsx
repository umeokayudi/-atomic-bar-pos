import { useState, useEffect, Component } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, Spinner, Empty } from './utils'
import PurchaseCashflowAdvisor from './PurchaseCashflowAdvisor'
import { fromZeikomi, parseSupplierPriceNotas, formatPriceChange } from '../lib/consumptionTax'
import { AdminPage, PortalSurface, PortalPills } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div style={{ padding:20, background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:12, color:'#dc2626', fontSize:13 }}>
        <strong>Error:</strong> {this.state.error}
      </div>
    )
    return this.props.children
  }
}

function FornecedoresInner() {
  const { t } = useI18n()
  const [tab, setTab] = useState('list')
  return (
    <AdminPage
      title={t('nav.suppliers')}
      subtitle={t('suppliers.subtitle')}
      actions={
        <PortalPills
          options={[['list', t('suppliers.tabList')],['pricing', t('suppliers.tabPricing')],['purchase', t('suppliers.tabPurchase')]]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {tab==='list'     && <SupplierList />}
      {tab==='pricing'  && <SupplierPricing />}
      {tab==='purchase' && <SmartPurchase />}
    </AdminPage>
  )
}

function SupplierList() {
  const { t } = useI18n()
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const empty = { nome:'', contato:'', telefone:'', email:'', website:'', prazo_entrega_dias:1, pagamento:'Cash', pontos_pct:0, notas:'' }
  const [form, setForm] = useState(empty)
  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('fornecedores').select('*').order('nome')
    setSuppliers(data || []); setLoading(false)
  }
  async function save() {
    if (!form.nome) return
    setSaving(true)
    if (editId) await supabase.from('fornecedores').update(form).eq('id', editId)
    else await supabase.from('fornecedores').insert(form)
    setSaving(false); setShowForm(false); setEditId(null); setForm(empty); load()
  }
  async function del(id) {
    if (!confirm(t('suppliers.confirmDelete'))) return
    await supabase.from('fornecedores').delete().eq('id', id); load()
  }
  function edit(s) {
    setForm({ nome:s.nome, contato:s.contato||'', telefone:s.telefone||'', email:s.email||'',
      website:s.website||'', prazo_entrega_dias:s.prazo_entrega_dias||1,
      pagamento:s.pagamento||'Cash', pontos_pct:s.pontos_pct||0, notas:s.notas||'' })
    setEditId(s.id); setShowForm(true)
  }
  if (loading) return <Spinner text={t('common.loading')} />
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>{t('suppliers.supplierCount', { count: suppliers.length })}</div>
        <button className="btn-primary" onClick={()=>{setShowForm(x=>!x);setEditId(null);setForm(empty)}}>{showForm ? t('common.cancel') : t('suppliers.addSupplier')}</button>
      </div>
      {showForm && (
        <PortalSurface title={editId ? t('suppliers.editSupplier') : t('suppliers.newSupplier')} style={{ marginBottom:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div><label className="form-label">{t('common.name')} *</label><input value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} placeholder="ex. Costco Japan" /></div>
            <div><label className="form-label">{t('common.contact')}</label><input value={form.contato} onChange={e=>setForm({...form,contato:e.target.value})} /></div>
            <div><label className="form-label">{t('common.phone')}</label><input value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} /></div>
            <div><label className="form-label">{t('common.email')}</label><input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></div>
            <div><label className="form-label">{t('common.website')}</label><input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} placeholder="https://" /></div>
            <div><label className="form-label">{t('common.payment')}</label>
              <select value={form.pagamento} onChange={e=>setForm({...form,pagamento:e.target.value})}>
                {['Cash','Card','Bank Transfer','Invoice 30d','Invoice 60d','Online'].map(p=><option key={p}>{p}</option>)}
              </select>
            </div>
            <div><label className="form-label">{t('suppliers.deliveryDays')}</label><input type="number" min="0" value={form.prazo_entrega_dias} onChange={e=>setForm({...form,prazo_entrega_dias:+e.target.value})} /></div>
            <div><label className="form-label">{t('suppliers.pointsPct')}</label><input type="number" min="0" step="0.1" value={form.pontos_pct} onChange={e=>setForm({...form,pontos_pct:+e.target.value})} /></div>
          </div>
          <div style={{ marginBottom:12 }}><label className="form-label">{t('common.notes')}</label><input value={form.notas} onChange={e=>setForm({...form,notas:e.target.value})} /></div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
            <button onClick={()=>{setShowForm(false);setEditId(null)}} style={{ padding:'8px 16px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={save} disabled={saving||!form.nome}>{saving ? t('common.saving') : editId ? t('common.save') : t('suppliers.addSupplier')}</button>
          </div>
        </PortalSurface>
      )}
      {suppliers.length===0 ? <Empty text={t('suppliers.noSuppliers')} icon="🏭" /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {suppliers.map(s => (
            <div key={s.id} className="card" style={{ display:'flex', alignItems:'center', gap:16 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>{s.nome}</div>
                <div style={{ display:'flex', gap:16, fontSize:12, color:'var(--text2)', flexWrap:'wrap' }}>
                  {s.contato && <span>👤 {s.contato}</span>}
                  {s.telefone && <span>📞 {s.telefone}</span>}
                  {s.email && <span>✉️ {s.email}</span>}
                  {s.pagamento && <span>💳 {s.pagamento}</span>}
                  <span>🚚 {s.prazo_entrega_dias}d</span>
                  {s.pontos_pct>0 && <span style={{ color:'var(--gold)', fontWeight:600 }}>⭐ {s.pontos_pct}% points</span>}
                </div>
                {s.notas && <div style={{ fontSize:11, color:'var(--text2)', marginTop:4 }}>📝 {s.notas}</div>}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                {s.website && <a href={s.website} target="_blank" rel="noreferrer" style={{ fontSize:11, padding:'5px 10px', borderRadius:8, background:'var(--bg3)', color:'var(--navy)', textDecoration:'none', fontWeight:600 }}>🌐 {t('common.visit')}</a>}
                <button onClick={()=>edit(s)} style={{ padding:'5px 10px', fontSize:11, borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>✏️</button>
                <button onClick={()=>del(s.id)} style={{ padding:'5px 10px', fontSize:11, borderRadius:8, border:'none', background:'#fef2f2', color:'var(--red)', cursor:'pointer' }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SupplierPricing() {
  const { t } = useI18n()
  const [suppliers, setSuppliers] = useState([])
  const [produtos, setProdutos] = useState([])
  const [precos, setPrecos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selSup, setSelSup] = useState('')
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { load() }, [])
  async function load() {
    const [sR, pR, prR] = await Promise.all([
      supabase.from('fornecedores').select('*').order('nome'),
      supabase.from('produtos').select('id,nome,categoria,custo').order('categoria').order('nome'),
      supabase.from('fornecedor_precos').select('*, fornecedores(nome)'),
    ])
    setSuppliers(sR.data||[]); setProdutos(pR.data||[]); setPrecos(prR.data||[])
    if (sR.data?.length>0) setSelSup(sR.data[0].id)
    setLoading(false)
  }
  async function savePreco() {
    if (!modal.preco) return
    setSaving(true)
    await supabase.from('fornecedor_precos').upsert(
      { fornecedor_id:modal.fornecedor_id, produto_id:modal.produto_id, preco:+modal.preco, url_compra:modal.url_compra||null, notas:modal.notas||null, atualizado_em:new Date().toISOString() },
      { onConflict:'fornecedor_id,produto_id' }
    )
    setSaving(false); setModal(null); load()
  }
  const supPrecos = precos.filter(p=>p.fornecedor_id===selSup)
  const cats = [...new Set(produtos.map(p=>p.categoria))]
  if (loading) return <Spinner text={t('common.loading')} />
  if (suppliers.length===0) return <Empty text={t('suppliers.addFirst')} icon="🏭" />
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>{t('suppliers.supplierPricing')}</div>
        <select value={selSup} onChange={e=>setSelSup(e.target.value)} style={{ width:'auto' }}>
          {suppliers.map(s=><option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
      </div>
      {cats.map(cat => (
        <div key={cat} style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{cat}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {produtos.filter(p=>p.categoria===cat).map(p => {
              const sp = supPrecos.find(x=>x.produto_id===p.id)
              const meta = sp ? parseSupplierPriceNotas(sp.notas) : {}
              const zeibetsu = meta.zeibetsu ?? (sp ? fromZeikomi(sp.preco) : null)
              const variacao = meta.variacao_pct
              const diff = sp && p.custo ? Math.round((sp.preco - p.custo) / p.custo * 100) : null
              return (
                <div key={p.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:10 }}>
                  <div style={{ flex:1, fontSize:13, fontWeight:500 }}>{p.nome}</div>
                  <div style={{ fontSize:12, color:'var(--text2)' }}>JBM: {fmtYen(p.custo)}</div>
                  {sp ? <>
                    {zeibetsu != null && <div style={{ fontSize:11, color:'var(--text3)' }}>税抜 {fmtYen(zeibetsu)}</div>}
                    <div style={{ fontSize:14, fontWeight:700, color:'var(--navy)' }} title="税込 (+10%)">{fmtYen(sp.preco)}</div>
                    {variacao != null && variacao !== 0 && (
                      <div style={{ fontSize:11, fontWeight:700, color: variacao > 0 ? 'var(--red)' : 'var(--green)' }}>
                        jul {formatPriceChange(variacao)}
                      </div>
                    )}
                    {diff !== null && diff !== 0 && (
                      <div style={{ fontSize:10, color: diff < 0 ? 'var(--green)' : 'var(--red)' }}>vs JBM {diff > 0 ? '+' : ''}{diff}%</div>
                    )}
                    {sp.url_compra && <a href={sp.url_compra} target="_blank" rel="noreferrer" style={{ fontSize:11, padding:'4px 8px', borderRadius:6, background:'var(--bg3)', color:'var(--navy)', textDecoration:'none', fontWeight:600 }}>{t('suppliers.buy')}</a>}
                  </> : <div style={{ fontSize:12, color:'var(--text3)' }}>—</div>}
                  <button onClick={()=>setModal({ fornecedor_id:selSup, produto_id:p.id, preco:sp?.preco||'', url_compra:sp?.url_compra||'', notas:sp?.notas||'' })}
                    style={{ padding:'4px 10px', fontSize:11, borderRadius:6, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>
                    {sp ? '✏️' : t('suppliers.addPrice')}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {modal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--bg2)', borderRadius:20, padding:'28px', width:'100%', maxWidth:380, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:4 }}>{produtos.find(p=>p.id===modal.produto_id)?.nome}</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:20 }}>{suppliers.find(s=>s.id===modal.fornecedor_id)?.nome}</div>
            <div style={{ marginBottom:12 }}><label className="form-label">Price (¥) *</label><input type="number" value={modal.preco} onChange={e=>setModal({...modal,preco:e.target.value})} autoFocus /></div>
            <div style={{ marginBottom:12 }}><label className="form-label">{t('suppliers.buyLink')}</label><input type="url" value={modal.url_compra} onChange={e=>setModal({...modal,url_compra:e.target.value})} placeholder="https://..." /></div>
            <div style={{ marginBottom:20 }}><label className="form-label">{t('common.notes')}</label><input value={modal.notas} onChange={e=>setModal({...modal,notas:e.target.value})} /></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:8 }}>
              <button onClick={()=>setModal(null)} style={{ padding:'11px', borderRadius:12, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={savePreco} disabled={saving||!modal.preco} style={{ padding:'11px', borderRadius:12 }}>{saving ? t('common.saving') : t('suppliers.savePrice')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SmartPurchase() {
  const { t } = useI18n()
  const [produtos, setProdutos] = useState([])
  const [precos, setPrecos] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [advisorOffer, setAdvisorOffer] = useState(null)
  useEffect(() => { load() }, [])
  async function load() {
    const [pR, prR] = await Promise.all([
      supabase.from('produtos').select('id,nome,categoria,custo,preco_venda,volume_ml').order('categoria').order('nome'),
      supabase.from('fornecedor_precos').select('*, fornecedores(nome,prazo_entrega_dias,pagamento,pontos_pct,website)'),
    ])
    setProdutos(pR.data||[]); setPrecos(prR.data||[]); setLoading(false)
  }
  const filtered = produtos.filter(p => !search || p.nome.toLowerCase().includes(search.toLowerCase()) || p.categoria.toLowerCase().includes(search.toLowerCase()))
  const getPrices = id => precos.filter(p=>p.produto_id===id).sort((a,b)=>a.preco-b.preco)
  if (loading) return <Spinner text={t('common.loading')} />
  return (
    <div>
      <div style={{ fontSize:16, fontWeight:700, marginBottom:4 }}>{t('suppliers.smartPurchase')}</div>
      <div style={{ fontSize:13, color:'var(--text2)', marginBottom:16 }}>{t('suppliers.compareHint')}</div>
      <div style={{ position:'relative', marginBottom:20 }}>
        <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text3)' }}>🔍</span>
        <input type="text" placeholder={t('suppliers.searchProduct')} value={search} onChange={e=>setSearch(e.target.value)}
          style={{ width:'100%', padding:'11px 14px 11px 36px', borderRadius:12, fontSize:14 }} />
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {filtered.map(p => {
          const prices = getPrices(p.id)
          const best = prices[0]
          return (
            <div key={p.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', cursor:'pointer' }} onClick={()=>{ setSelected(selected===p.id?null:p.id); setAdvisorOffer(null) }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{p.nome}</div>
                  <div style={{ fontSize:11, color:'var(--text2)' }}>{p.categoria} · JBM: {fmtYen(p.custo)}</div>
                </div>
                {prices.length>0
                  ? <div style={{ textAlign:'right' }}><div style={{ fontSize:14, fontWeight:800, color:'var(--green)' }}>{t('suppliers.fromPrice', { price: fmtYen(best.preco) })}</div><div style={{ fontSize:11, color:'var(--text2)' }}>{t('suppliers.supplierCountShort', { count: prices.length })}</div></div>
                  : <div style={{ fontSize:12, color:'var(--text3)' }}>{t('suppliers.noPrices')}</div>}
                <span style={{ color:'var(--text3)', fontSize:12 }}>{selected===p.id?'▲':'▼'}</span>
              </div>
              {selected===p.id && prices.length>0 && (
                <div style={{ borderTop:'1px solid var(--border)', padding:'12px 16px', background:'var(--bg3)' }}>
                  {prices.map((pr,i) => (
                    <div key={pr.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', marginBottom:6,
                      background:i===0?'linear-gradient(135deg,#f0fdf4,#dcfce7)':'var(--bg2)',
                      border:i===0?'1px solid #86efac':'1px solid var(--border)', borderRadius:10 }}>
                      {i===0 && <span>🏆</span>}
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700 }}>{pr.fornecedores?.nome}</div>
                        <div style={{ fontSize:11, color:'var(--text2)', display:'flex', gap:10, marginTop:2 }}>
                          <span>🚚 {pr.fornecedores?.prazo_entrega_dias}d</span>
                          <span>💳 {pr.fornecedores?.pagamento}</span>
                          {pr.fornecedores?.pontos_pct>0 && <span style={{ color:'var(--gold)' }}>⭐ {pr.fornecedores.pontos_pct}%</span>}
                          {pr.notas && <span>📝 {pr.notas}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontSize:16, fontWeight:800, color:i===0?'var(--green)':'var(--navy)' }}>{fmtYen(pr.preco)}</div>
                        {p.custo>0 && <div style={{ fontSize:10, color:pr.preco<p.custo?'var(--green)':pr.preco>p.custo?'var(--red)':'var(--text2)', fontWeight:600 }}>
                          {pr.preco<p.custo ? t('suppliers.cheaper') : pr.preco>p.custo ? t('suppliers.moreExpensive') : t('suppliers.sameAsJbm')}
                        </div>}
                      </div>
                      <button type="button" onClick={()=>setAdvisorOffer({ product: p, offer: pr })}
                        style={{ padding:'8px 14px', borderRadius:10, background:advisorOffer?.offer?.id===pr.id?'var(--gold)':'var(--bg3)', color:advisorOffer?.offer?.id===pr.id?'var(--navy)':'var(--text)', border:'1px solid var(--border)', fontSize:12, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
                        {t('suppliers.cashflowBtn')}
                      </button>
                      {pr.url_compra && <a href={pr.url_compra} target="_blank" rel="noreferrer"
                        style={{ padding:'8px 14px', borderRadius:10, background:'var(--navy)', color:'white', textDecoration:'none', fontSize:12, fontWeight:700, whiteSpace:'nowrap' }}>{t('suppliers.buy')}</a>}
                    </div>
                  ))}
                  {advisorOffer?.product?.id === p.id && (
                    <div style={{ marginTop: 12 }}>
                      <PurchaseCashflowAdvisor
                        compact
                        purchaseAmount={advisorOffer.offer.preco}
                        supplierName={advisorOffer.offer.fornecedores?.nome}
                        supplierPayment={advisorOffer.offer.fornecedores?.pagamento || 'Cash'}
                        deliveryDays={advisorOffer.offer.fornecedores?.prazo_entrega_dias || 1}
                        pointsPct={advisorOffer.offer.fornecedores?.pontos_pct || 0}
                        productName={p.nome}
                        categoria={p.categoria}
                        qtd={1}
                        jbmSellPrice={p.preco_venda || p.custo || 0}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}


export default function Fornecedores() {
  return <ErrorBoundary><FornecedoresInner /></ErrorBoundary>
}
