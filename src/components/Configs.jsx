import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { ensureVendaFromPedido, findVendaForPedido, findVendaKeysForPedidos, pedidoSaleDate, mergeOrInsertPeriodFatura } from '../lib/pedidoVenda'
import { addStockFromDelivery } from '../lib/posSupply'
import { useAuth } from './Auth'
import { fmtYen, Badge, Spinner, Empty, DelBtn, CATEGORIAS, filterSupplierVendas, PedidoItemChip } from './utils'
import { SupplierCostHint } from './SupplierPriceCheck'
import { staffFetch } from '../lib/apiAuth'
import { AdminPage, PortalSurface } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { canReadProductCost } from '../lib/legacyScope'
import Icon from './ui/Icon'
import OrderDetailPopup from './OrderDetailPopup'
import { BarIdentity, BarMark } from './BarIdentity'
import { ATOMIC_RED, BRAND_COLORS, brandColorOf, brandRow, brandTokens, cleanHex, cleanLogo, fileToLogo, resolveBrand } from '../lib/barBrand'
import { initialsOf } from '../lib/staffApp'
import { runChange } from '../lib/safeDelete'
import { askConfirm, notify } from './ui/ConfirmDialog'

// ── PRODUTOS ─────────────────────────────────────────────────────────────────
export function ProductsTab() {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const catalogCost = canReadProductCost(perfil?.role)
  const [produtos, setProducts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving,  setSaving]    = useState(false)
  const [editId,  setEditId]    = useState(null)
  const [form, setForm] = useState({ nome:'', categoria:'Cerveja', custo:0, preco_venda:0 })

  useEffect(() => { load() }, [perfil?.role])
  async function load() {
    setLoading(true)
    if (!canReadProductCost(perfil?.role)) {
      setProducts([])
      setLoading(false)
      return
    }
    const { data } = await supabase.from('produtos').select('*').order('nome')
    setProducts(data||[])
    setLoading(false)
  }

  const setF = (k,v) => setForm(f=>({...f,[k]:v}))

  async function save() {
    if (!canReadProductCost(perfil?.role)) return
    if (!form.nome) return
    setSaving(true)
    if (editId) {
      await supabase.from('produtos').update(form).eq('id', editId)
      setEditId(null)
    } else {
      await supabase.from('produtos').insert(form)
    }
    setSaving(false)
    setForm({ nome:'', categoria:'Cerveja', custo:0, preco_venda:0 })
    load()
  }

  async function del(id) {
    const p = produtos.find(x => x.id === id)
    if (!(await askConfirm({ title: t('configs.confirmDeleteProduct'), message: p?.nome, danger: true }))) return
    // Soft delete (sales and orders still point at the product); the result is checked and shown.
    if (await runChange(supabase.from('produtos').update({ ativo: false }).eq('id', id), { okText: t('configs.productRemoved', { name: p?.nome || '' }) })) {
      setProducts(prev => prev.map(x => x.id === id ? { ...x, ativo: false } : x))
    }
    load()
  }

  function startEdit(p) {
    setEditId(p.id)
    setForm({ nome:p.nome, categoria:p.categoria, custo:p.custo, preco_venda:p.preco_venda })
  }

  if (!catalogCost) {
    return (
      <AdminPage title={t('nav.products')}>
        <PortalSurface><Empty text={t('common.companyLedger')} /></PortalSurface>
      </AdminPage>
    )
  }

  return (
    <AdminPage title={t('nav.products')} subtitle={t('configs.productsSubtitle')}>
      <PortalSurface title={editId ? t('configs.editProduct') : t('configs.newProduct')} style={{ marginBottom: 16 }}>
        <div className="grid4" style={{ marginBottom:12, alignItems:'end' }}>
          <div style={{ gridColumn:'span 1' }}>
            <label className="form-label">{t('configs.productName')}</label>
            <input type="text" value={form.nome} onChange={e=>setF('nome',e.target.value)} placeholder={t('configs.productPlaceholder')} />
          </div>
          <div>
            <label className="form-label">{t('configs.category')}</label>
            <select value={form.categoria} onChange={e=>setF('categoria',e.target.value)}>
              {CATEGORIAS.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">{t('configs.cost')}</label>
            <input type="number" value={form.custo} onChange={e=>setF('custo',+e.target.value)} />
          </div>
          <div>
            <label className="form-label">{t('configs.sellPrice')}</label>
            <input type="number" value={form.preco_venda} onChange={e=>setF('preco_venda',+e.target.value)} />
          </div>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          {editId && <button onClick={()=>{setEditId(null);setForm({nome:'',categoria:'Cerveja',custo:0,preco_venda:0})}}>{t('common.cancel')}</button>}
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <><span className="spinner"/>{t('common.saving')}</> : editId ? t('configs.saveEdit') : t('configs.addProduct')}
          </button>
        </div>
      </PortalSurface>

      <PortalSurface>
        {loading ? <Spinner /> : produtos.length===0 ? <Empty text={t('configs.noProducts')} /> : (
          <table>
            <thead><tr><th>{t('configs.productCol')}</th><th>{t('configs.categoryCol')}</th><th>{t('configs.costCol')}</th><th>{t('configs.sellCol')}</th><th>{t('configs.margin')}</th><th></th></tr></thead>
            <tbody>
              {produtos.filter(p=>p.ativo!==false).map(p=>{
                const m = p.preco_venda>0 ? Math.round((p.preco_venda-p.custo)/p.preco_venda*100) : 0
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight:500 }}>{p.nome}</td>
                    <td><Badge color="var(--amber)">{p.categoria}</Badge></td>
                    <td>{fmtYen(p.custo)}</td>
                    <td>{fmtYen(p.preco_venda)}</td>
                    <td style={{ fontWeight:700,
                      color:m>50?'var(--green)':m>30?'var(--amber)':'var(--red)'
                    }}>{m}%</td>
                    <td style={{ display:'flex', gap:4 }}>
                      <button style={{padding:'4px 8px',fontSize:12}} onClick={()=>startEdit(p)} aria-label={t('common.edit')}><Icon name="edit" size={14} /></button>
                      <DelBtn onClick={()=>del(p.id)} />
                    </td>
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

// ── BARES ─────────────────────────────────────────────────────────────────────
const EMPTY_BAR = { id: null, nome: '', cor: '#1C7ED6', logo: '' }

/** A small picture of the bar app's top with the chosen colour, logo and name. */
function BrandPreview({ form }) {
  const { t } = useI18n()
  const bar = { id: form.id, nome: form.nome || t('configs.barName'), marca: { cor: form.cor, logo: form.logo } }
  const brand = resolveBrand(bar)
  const tokens = brandTokens(brand.color)
  const chrome = brand.theme === 'atomic' ? '#0E0E0F' : tokens?.['--bb-chrome'] || 'var(--c-chrome)'
  const accent = brand.theme === 'atomic' ? ATOMIC_RED : tokens?.['--bb-accent'] || 'var(--c-accent)'
  const onAccent = tokens?.['--bb-on'] || '#fff'
  return (
    <div className="brand-preview" aria-label={t('configs.preview')}>
      <div className="brand-preview-top" style={{ background: chrome, borderBottom: `3px solid ${brand.color || accent}` }}>
        <BarIdentity bar={bar} size={40} sub={t('configs.previewSub')} />
      </div>
      <div className="brand-preview-body">
        <div className="brand-preview-chip" style={{ width: '70%' }} />
        <div className="brand-preview-chip" style={{ width: '45%' }} />
        <div className="brand-preview-btn" style={{ background: accent, color: onAccent }}>{t('configs.previewButton')}</div>
      </div>
      <div className="brand-preview-nav">
        <span style={{ background: accent }} /><span /><span /><span />
      </div>
    </div>
  )
}

export function BarsTab() {
  const { t } = useI18n()
  const [bars,    setBars]    = useState([])
  const [marcas,  setMarcas]  = useState({})
  const [vendas,  setSales]  = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_BAR)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const logoInput = useRef(null)

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [{ data: b }, { data: v }, brandRes] = await Promise.all([
      supabase.from('bars').select('*').order('nome'),
      supabase.from('vendas').select('bar_id, total'),
      supabase.from('bar_brand').select('*'),
    ])
    setBars(b||[]); setSales(filterSupplierVendas(v||[]))
    setMarcas(Object.fromEntries((brandRes?.data || []).map(r => [r.bar_id || r.id, r])))
    setLoading(false)
  }

  const withMarca = b => (marcas[b.id] ? { ...b, marca: marcas[b.id] } : b)

  function startEdit(b) {
    const full = withMarca(b)
    setForm({ id: b.id, nome: b.nome || '', cor: brandColorOf(full) || EMPTY_BAR.cor, logo: cleanLogo(full.marca?.logo) })
    setMsg(''); setErr('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function pickLogo(file) {
    setErr('')
    try {
      const logo = await fileToLogo(file)
      setForm(f => ({ ...f, logo }))
    } catch (e) {
      setErr(errText(e))
    }
  }

  async function save() {
    const nome = form.nome.trim()
    if (!nome) return
    setSaving(true); setMsg(''); setErr('')
    try {
      const cor = cleanHex(form.cor)
      let id = form.id
      if (id) {
        const { error } = await supabase.from('bars').update({ nome, cor }).eq('id', id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('bars').insert({ nome, cor }).select('id').single()
        if (error) throw error
        id = data.id
      }
      const { error: brandErr } = await supabase.from('bar_brand').upsert(brandRow(id, { cor, logo: form.logo }))
      if (brandErr) throw brandErr
      setForm(EMPTY_BAR)
      setMsg(t('configs.barSaved'))
      load()
    } catch (e) {
      setErr(errText(e))
    }
    setSaving(false)
  }

  async function del(id) {
    if (!(await askConfirm({ title: t('configs.confirmDeleteBar'), danger: true, typeToConfirm: t('configs.deleteWord') }))) return
    await runChange(supabase.from('bars').delete().eq('id', id))
    load()
  }

  const customOn = !BRAND_COLORS.some(c => c.hex.toLowerCase() === cleanHex(form.cor))

  return (
    <AdminPage title={t('nav.bars')} subtitle={t('configs.barsSubtitle')}>
      <PortalSurface title={form.id ? t('configs.editBar') : t('configs.addBar')} style={{ marginBottom: 16 }}>
        <div className="brand-form">
          <div className="brand-fields">
            <div><label className="form-label">{t('configs.barName')}</label>
              <input type="text" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder={t('configs.barName')} /></div>
            <div>
              <label className="form-label">{t('configs.appColor')}</label>
              <div className="brand-swatches" role="radiogroup" aria-label={t('configs.appColor')}>
                {BRAND_COLORS.map(c => (
                  <button key={c.hex} type="button" role="radio" aria-checked={cleanHex(form.cor) === c.hex.toLowerCase()}
                    className={`brand-swatch${cleanHex(form.cor) === c.hex.toLowerCase() ? ' is-on' : ''}`}
                    style={{ background: c.hex }} title={c.hex === ATOMIC_RED ? `${c.hex} · ${t('configs.redBlack')}` : c.hex}
                    aria-label={c.hex} onClick={() => setForm({ ...form, cor: c.hex })} />
                ))}
                <label className={`brand-swatch brand-swatch-custom${customOn ? ' is-on' : ''}`} title={t('configs.customColor')} style={customOn ? { background: form.cor } : undefined}>
                  <input type="color" value={cleanHex(form.cor) || '#1c7ed6'} onChange={e => setForm({ ...form, cor: e.target.value })} aria-label={t('configs.customColor')} />
                </label>
              </div>
            </div>
            <div>
              <label className="form-label">{t('configs.logo')}</label>
              <div className="brand-logo-row">
                <span className="brand-logo-box">{form.logo ? <img src={form.logo} alt="" /> : <Icon name="bars" size={22} />}</span>
                <button type="button" onClick={() => logoInput.current?.click()}>{form.logo ? t('configs.changeLogo') : t('configs.uploadLogo')}</button>
                <input ref={logoInput} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickLogo(f) }} />
                {form.logo && <button type="button" onClick={() => setForm({ ...form, logo: '' })}>{t('configs.removeLogo')}</button>}
              </div>
              <div className="brand-hint" style={{ marginTop: 6 }}>{t('configs.logoHint')}</div>
            </div>
            <div className="brand-hint">{t('configs.brandHint')}</div>
            {err && <div style={{background:'var(--red-bg)',color:'var(--red)',borderRadius:8,padding:'10px 16px',fontSize:13}}>{asReactText(err)}</div>}
            {msg && <div style={{background:'var(--green-bg)',color:'var(--green)',borderRadius:8,padding:'10px 16px',fontSize:13}}>{msg}</div>}
            <div className="brand-actions">
              <button className="btn-primary" onClick={save} disabled={saving || !form.nome.trim()}>
                {saving ? <><span className="spinner"/>{t('common.saving')}</> : form.id ? t('configs.saveBar') : t('configs.addBarBtn')}
              </button>
              {form.id && <button onClick={() => { setForm(EMPTY_BAR); setErr('') }}>{t('common.cancel')}</button>}
            </div>
          </div>
          <div>
            <label className="form-label">{t('configs.preview')}</label>
            <BrandPreview form={form} />
          </div>
        </div>
      </PortalSurface>
      <PortalSurface>
        {loading ? <Spinner /> : bars.length===0 ? <Empty text={t('configs.noBars')} /> : (
          <table>
            <thead><tr><th>{t('nav.bars')}</th><th>{t('configs.lookCol')}</th><th>{t('nav.sales')}</th><th>{t('configs.totalRevenue')}</th><th></th></tr></thead>
            <tbody>
              {bars.map(b=>{
                const v = vendas.filter(x=>x.bar_id===b.id)
                const receita = v.reduce((a,x)=>a+(+x.total||0),0)
                const full = withMarca(b)
                const look = resolveBrand(full)
                return (
                  <tr key={b.id}>
                    <td><div className="bar-row-mark"><BarMark brand={{ ...look, initials: initialsOf(b.nome) }} size={32} /><strong>{b.nome}</strong></div></td>
                    <td><div style={{ display:'flex', alignItems:'center', gap:8 }}><div style={{ width:24,height:24,borderRadius:6,background:look.color || 'var(--c-surface-2)',border:'0.5px solid var(--border)' }}/>{look.theme === 'atomic' && <span style={{ fontSize:12, color:'var(--text3)' }}>{t('configs.redBlack')}</span>}</div></td>
                    <td>{v.length}</td>
                    <td style={{ fontWeight:600 }}>{fmtYen(receita)}</td>
                    <td><div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                      <button style={{padding:'4px 8px',fontSize:12}} onClick={()=>startEdit(b)} aria-label={t('configs.editBar')}><Icon name="edit" size={14} /></button>
                      <DelBtn onClick={()=>del(b.id)} />
                    </div></td>
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

// ── USUÁRIOS (admin only) ─────────────────────────────────────────────────────
export function UsuariosTab() {
  const { t } = useI18n()
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [bars, setBars] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ nome:'', email:'', role:'cliente', bar_id:'' })
  const [editPw, setEditPw] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  async function loadUsers() {
    const res = await staffFetch('/api/admin-user')
    const json = await res.json()
    if (!res.ok) throw new Error(errText(json.error, 'Failed to load users'))
    return json.users || []
  }

  async function load() {
    setLoading(true)
    setErr('')
    try {
      const [{ data: b }, u] = await Promise.all([
        supabase.from('bars').select('id,nome').order('nome'),
        loadUsers().catch(async () => {
          const { data: fallback } = await supabase.from('perfis').select('*').order('nome')
          return fallback || []
        }),
      ])
      setBars(b || [])
      setUsers(u || [])
    } catch (e) {
      setErr(errText(e))
    }
    setLoading(false)
  }

  async function saveEdit(id) {
    if (form.role === 'cliente' || form.role === 'caixa' || form.role === 'bar_staff') {
      if (!form.bar_id) {
        setErr('Select a bar for this login')
        return
      }
    }
    setSaving(true)
    setErr('')
    try {
      const res = await staffFetch('/api/admin-user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          nome: form.nome,
          email: form.email,
          role: form.role,
          bar_id: (form.role === 'cliente' || form.role === 'caixa' || form.role === 'bar_staff') ? form.bar_id : null,
          password: editPw || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(errText(json.error, 'Update failed'))
      setMsg(t('configs.userUpdated'))
      setEditId(null)
      setEditPw('')
      load()
      setTimeout(() => setMsg(''), 4000)
    } catch (e) {
      setErr(errText(e))
    }
    setSaving(false)
  }

  // The Administrator account and your own login cannot be deleted from here (no way back in otherwise).
  const isProtected = u => u?.role === 'admin' || u?.id === me?.id

  async function deleteUser(id) {
    const u = users.find(x => x.id === id)
    if (isProtected(u)) { notify(t('configs.adminProtected'), 'error'); return }
    if (!(await askConfirm({ title: t('configs.confirmDeleteUser'), message: u ? `${u.nome || ''} ${u.email ? `· ${u.email}` : ''}` : '', danger: true }))) return
    await runChange(supabase.from('perfis').delete().eq('id', id))
    load()
  }

  function startEdit(u) {
    setEditId(u.id)
    setEditPw('')
    setForm({
      nome: u.nome || '',
      email: u.email || '',
      role: u.role === 'funcionario' ? 'staff' : (u.role || 'cliente'),
      bar_id: u.bar_id || '',
    })
  }

  const roleColor = { admin:'var(--gold)', staff:'var(--navy)', funcionario:'var(--navy)', cliente:'var(--green)', caixa:'#7c3aed', bar_staff:'#0f766e' }
  const roleLabel = r => t(`shell.roles.${r === 'staff' ? 'staff' : r}`) || r

  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200,color:'var(--text2)'}}><span className="spinner"/>{t('configs.usersLoading')}</div>

  return (
    <AdminPage
      title={t('configs.usersTitle')}
      subtitle={t('configs.usersSubtitle')}
      actions={
        <button className="btn-primary" style={{fontSize:12,padding:'8px 16px'}} onClick={()=>{ setShowNew(v=>!v); setErr('') }}>{t('configs.newUser')}</button>
      }
    >

      {err && <div style={{background:'var(--red-bg)',color:'#b91c1c',border:'1px solid #fecaca',borderRadius:8,padding:'10px 16px',marginBottom:16,fontSize:13}}>{asReactText(err)}</div>}
      {msg && <div style={{background:'var(--green-bg)',color:'var(--green)',borderRadius:8,padding:'10px 16px',marginBottom:16,fontSize:13}}>{msg}</div>}

      {bars.length === 0 && (
        <div style={{background:'var(--amber-bg)',border:'1px solid #f0d080',borderRadius:8,padding:'12px 16px',marginBottom:16,fontSize:13,color:'var(--amber)'}}>
          {t('configs.noBarsWarning')}
        </div>
      )}

      {showNew && (
        <PortalSurface title={t('configs.createPortalLogin')} sub={t('configs.createPortalSub')} style={{marginBottom:20,background:'var(--bg2)',border:'1px solid color-mix(in srgb, var(--gold) 20%, transparent)'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <input className="input" placeholder={t('configs.fullName')} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/>
            <input className="input" placeholder={t('auth.email')} type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)}/>
            <input className="input" placeholder={t('configs.passwordMin')} type="password" value={newPw} onChange={e=>setNewPw(e.target.value)}/>
            <select className="input" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
              <option value="admin">Admin</option>
              <option value="staff">{t('shell.roles.staff')}</option>
              <option value="cliente">{t('configs.roleClientPortal')}</option>
              <option value="caixa">{t('shell.roles.caixa')}</option>
              <option value="bar_staff">{t('shell.roles.bar_staff')}</option>
            </select>
            {(form.role === 'cliente' || form.role === 'caixa' || form.role === 'bar_staff') && (
              <select className="input" value={form.bar_id} onChange={e=>setForm({...form,bar_id:e.target.value})} style={{ gridColumn:'span 2' }}>
                <option value="">{t('configs.selectBarRequired')}</option>
                {bars.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            )}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn-primary" style={{fontSize:12,padding:'8px 16px'}} disabled={creating||!newEmail||!newPw||!form.nome||((form.role==='cliente'||form.role==='caixa'||form.role==='bar_staff')&&!form.bar_id)}
              onClick={async()=>{
                setCreating(true)
                setErr('')
                try {
                  const res = await staffFetch('/api/admin-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: newEmail, password: newPw, nome: form.nome, role: form.role, bar_id: form.bar_id || null })
                  })
                  const json = await res.json()
                  if (!res.ok) throw new Error(errText(json.error, 'Create failed'))
                  setMsg(t('configs.userCreated', { email: newEmail }))
                  setShowNew(false); setNewEmail(''); setNewPw('')
                  setForm({ nome:'', email:'', role:'cliente', bar_id:'' })
                  load()
                  setTimeout(()=>setMsg(''),4000)
                } catch(e) { setErr(errText(e)) }
                setCreating(false)
              }}>
              {creating ? t('configs.creating') : t('configs.createLogin')}
            </button>
            <button onClick={()=>setShowNew(false)} style={{fontSize:12,padding:'8px 16px',background:'var(--bg3)',border:'none',borderRadius:8,cursor:'pointer',color:'var(--text2)'}}>{t('common.cancel')}</button>
          </div>
        </PortalSurface>
      )}

      <PortalSurface style={{padding:0,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr style={{background:'var(--bg2)',borderBottom:'1px solid var(--border)'}}>
              {[t('configs.colName'),t('configs.colEmail'),t('configs.colRole'),t('configs.colBar'),t('configs.colStatus'),t('configs.colActions')].map(h=>(
                <th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.05em'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u,i)=>(
              <tr key={u.id} style={{borderBottom:'1px solid var(--border)',background:i%2===0?'white':'var(--bg)'}}>
                {editId===u.id ? (
                  <>
                    <td style={{padding:'8px 14px'}}><input className="input" style={{padding:'4px 8px',fontSize:12,width:'100%'}} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/></td>
                    <td style={{padding:'8px 14px'}}><input className="input" type="email" style={{padding:'4px 8px',fontSize:12,width:'100%'}} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder={t('configs.changeEmail')}/></td>
                    <td style={{padding:'8px 14px'}}>
                      <select className="input" style={{padding:'4px 8px',fontSize:12}} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
                        <option value="admin">{t('shell.roles.admin')}</option>
                        <option value="staff">{t('shell.roles.staff')}</option>
                        <option value="cliente">{t('shell.roles.cliente')}</option>
                        <option value="caixa">{t('shell.roles.caixa')}</option>
                        <option value="bar_staff">{t('shell.roles.bar_staff')}</option>
                      </select>
                    </td>
                    <td style={{padding:'8px 14px'}}>
                      <select className="input" style={{padding:'4px 8px',fontSize:12}} value={form.bar_id} onChange={e=>setForm({...form,bar_id:e.target.value})} disabled={!(form.role==='cliente'||form.role==='caixa'||form.role==='bar_staff')}>
                        <option value="">—</option>
                        {bars.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}
                      </select>
                    </td>
                    <td style={{padding:'8px 14px'}}>
                      <input className="input" type="password" style={{padding:'4px 8px',fontSize:11,width:'100%'}} value={editPw} onChange={e=>setEditPw(e.target.value)} placeholder={t('configs.newPasswordOptional')}/>
                    </td>
                    <td style={{padding:'8px 14px'}}>
                      <div style={{display:'flex',gap:6}}>
                        <button className="btn-primary" style={{fontSize:11,padding:'4px 10px'}} disabled={saving} onClick={()=>saveEdit(u.id)}>{saving?'...':t('common.save')}</button>
                        <button onClick={()=>{setEditId(null);setEditPw('')}} style={{fontSize:11,padding:'4px 10px',background:'var(--bg3)',border:'none',borderRadius:6,cursor:'pointer'}}>{t('common.cancel')}</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{padding:'10px 14px',fontSize:13,fontWeight:600}}>{u.nome||'—'}</td>
                    <td style={{padding:'10px 14px',fontSize:12,color:'var(--text2)'}}>{u.email||'—'}</td>
                    <td style={{padding:'10px 14px'}}>
                      <span style={{fontSize:11,fontWeight:700,padding:'3px 8px',borderRadius:20,background:`${roleColor[u.role]||'#ccc'}20`,color:roleColor[u.role]||'#666',textTransform:'uppercase',letterSpacing:'0.04em'}}>{roleLabel(u.role)}</span>
                    </td>
                    <td style={{padding:'10px 14px',fontSize:12,color:'var(--text2)'}}>{bars.find(b=>b.id===u.bar_id)?.nome||'—'}</td>
                    <td style={{padding:'10px 14px',fontSize:11}}>
                      {u.role === 'cliente' && !u.bar_id
                        ? <span style={{color:'var(--red)',fontWeight:600}}>{t('configs.noBarLinked')}</span>
                        : <span style={{color:'var(--green)'}}>OK</span>}
                    </td>
                    <td style={{padding:'10px 14px'}}>
                      <div style={{display:'flex',gap:6}}>
                        <button onClick={()=>startEdit(u)} style={{fontSize:11,padding:'4px 10px',background:'var(--navy)',color:'white',border:'none',borderRadius:6,cursor:'pointer'}}>{t('common.edit')}</button>
                        {isProtected(u)
                          ? <span title={t('configs.adminProtected')} style={{fontSize:11,padding:'4px 10px',color:'var(--text2)'}}>{t('configs.protected')}</span>
                          : <button onClick={()=>deleteUser(u.id)} style={{fontSize:11,padding:'4px 10px',background:'var(--red)',color:'white',border:'none',borderRadius:6,cursor:'pointer'}}>{t('common.delete')}</button>}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {users.length===0 && <div style={{padding:32,textAlign:'center',color:'var(--text3)',fontSize:13}}>{t('configs.noUsers')}</div>}
      </PortalSurface>

    </AdminPage>
  )
}

export function PedidosAdminTab() {
  const { t } = useI18n()
  const [pedidos,setPedidos]=useState([])
  const [loading,setLoading]=useState(true)
  const [filterStatus,setFilterStatus]=useState('')
  const [checklistPedido,setChecklistPedido]=useState(null)
  const [detailPedido,setDetailPedido]=useState(null)
  const [checkedItems,setCheckedItems]=useState({})
  const [missingVenda,setMissingVenda]=useState({})
  const [repairing,setRepairing]=useState(null)
  const [supplierByProdId,setSupplierByProdId]=useState(new Map())
  const [supplierByProdName,setSupplierByProdName]=useState(new Map())

  const PEDIDOS_SELECT = '*, pedidos_itens(*, produtos(nome,custo,preco_venda,categoria,volume_ml)), bars(nome)'

  useEffect(()=>{ load() },[])
  useEffect(()=>{
    supabase.from('fornecedor_precos').select('produto_id, preco, produtos(id,nome), fornecedores(nome)')
      .then(({ data }) => {
        const list = data || []
        const byId = new Map()
        const byName = new Map()
        for (const p of list) {
          if (p.produto_id) byId.set(p.produto_id, p)
          const n = p.produtos?.nome
          if (n) byName.set(n.toLowerCase(), p)
        }
        setSupplierByProdId(byId)
        setSupplierByProdName(byName)
      })
  },[])

  async function fetchPedidoCompleto(id) {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, pedidos_itens(*, produtos(nome,custo,preco_venda,categoria,volume_ml)), bars(nome)')
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  async function markMissingVendas(list) {
    const entregues = (list || []).filter(p => p.status === 'entregue')
    const vendaKeys = await findVendaKeysForPedidos(supabase, entregues)
    const miss = {}
    for (const p of entregues) {
      if (!vendaKeys.has(String(p.id).slice(0, 8).toLowerCase())) miss[p.id] = true
    }
    setMissingVenda(miss)
  }

  async function load(){
    const since = new Date()
    since.setMonth(since.getMonth() - 6)
    const sinceStr = since.toISOString().slice(0, 10)

    const { data: p } = await supabase
      .from('pedidos')
      .select(PEDIDOS_SELECT)
      .or(`data_entrega_prevista.gte.${sinceStr},criado_em.gte.${sinceStr}T00:00:00`)
      .order('criado_em', { ascending: false })
      .limit(80)

    const list = p || []
    setPedidos(list)
    await markMissingVendas(list)
    setLoading(false)
  }

  async function registerVendaForPedido(pedido) {
    const fresh = await fetchPedidoCompleto(pedido.id)
    const { venda } = await ensureVendaFromPedido(supabase, fresh)
    if (!venda) throw new Error('Could not create the sale')
    try { await addStockFromDelivery(supabase, fresh) } catch (e) { console.warn('estoque entrega:', e.message) }
    return venda
  }

  async function repairVenda(pedido) {
    setRepairing(pedido.id)
    try {
      const venda = await registerVendaForPedido(pedido)
      notify(t('configs.deliveryOk', { amount: fmtYen(venda.total || 0), date: venda.data }))
      await load()
    } catch (e) {
      notify(t('configs.saleError', { message: e.message }), 'error')
    } finally {
      setRepairing(null)
    }
  }

  async function updateStatus(id,status){
    if(status==='entregue'){
      const pedido=pedidos.find(p=>p.id===id)
      if(!pedido) return
      try {
        const venda = await registerVendaForPedido(pedido)
        await supabase.from('pedidos').update({status}).eq('id',id)
        await supabase.from('notificacoes').insert({
          user_id:pedido.criado_por,tipo:'pedido_entregue',
          titulo: t('configs.notifDeliveredTitle'),
          mensagem: t('configs.notifDeliveredBody', { amount: '¥'+Math.round(pedido.total_estimado).toLocaleString('ja-JP') }),
          link:'pedidos',
        }).catch(()=>{})
        const saleDate = pedidoSaleDate(pedido)
        try {
          await mergeOrInsertPeriodFatura(supabase, {
            barId: pedido.bar_id,
            amount: pedido.total_estimado,
            saleDate,
            vendaId: venda?.id || null,
            notas: t('configs.invoiceAutoNote'),
          })
        } catch (e) { console.error('auto-fatura error:', e) }
      } catch (e) {
        notify(t('configs.saleError', { message: e.message }), 'error')
        return
      }
    } else {
      await supabase.from('pedidos').update({status}).eq('id',id)
    }
    if(status==='confirmado'){
      const pedido=pedidos.find(p=>p.id===id)
      if(pedido) await supabase.from('notificacoes').insert({
        user_id:pedido.criado_por,tipo:'pedido_confirmado',
        titulo:t('configs.notifConfirmedTitle'),mensagem:t('configs.notifConfirmedBody'),link:'pedidos',
      }).catch(()=>{})
    }
    setPedidos(prev => prev.map(p => p.id===id ? {...p, status} : p))
    load()
  }

  function openChecklist(pedido){
    const init={}
    ;(pedido.pedidos_itens||[]).forEach(it=>{init[it.id]=false})
    setCheckedItems(init)
    setChecklistPedido(pedido)
  }

  async function confirmDelivery(){
    if(!Object.values(checkedItems).every(v=>v)){
      notify(t('configs.checkItemsFirst'), 'error')
      return
    }
    const pedido=checklistPedido
    const id=pedido.id
    setChecklistPedido(null)
    setCheckedItems({})
    try {
      const venda = await registerVendaForPedido(pedido)
      await supabase.from("pedidos").update({status:"entregue"}).eq("id",id)
      await supabase.from("notificacoes").insert({user_id:pedido.criado_por,tipo:"pedido_entregue",titulo:t('configs.notifDeliveredTitle'),mensagem:t('configs.notifDeliveredBody', { amount: `¥${Math.round(venda.total||0).toLocaleString('ja-JP')}` }),link:"pedidos"}).catch(()=>{})

      const saleDate = pedidoSaleDate(pedido)
      try {
        await mergeOrInsertPeriodFatura(supabase, {
          barId: pedido.bar_id,
          amount: pedido.total_estimado,
          saleDate,
          vendaId: venda?.id || null,
          notas: t('configs.invoiceAutoNote'),
        })
      } catch (e) { console.error('Invoice auto-create failed:', e) }
      notify(t('configs.deliveryOk', { amount: fmtYen(venda.total || 0), date: venda.data }))
    } catch (e) {
      notify(t('configs.saleError', { message: e.message }), 'error')
    }
    load()
  }

  const STATUS_MAP={
    pendente:{label:'Pendente',color:'var(--amber)',bg:'var(--amber-bg)'},
    confirmado:{label:'Confirmado',color:'var(--blue)',bg:'var(--blue-bg)'},
    entregue:{label:'Entregue',color:'var(--green)',bg:'var(--green-bg)'},
    cancelado:{label:'Cancelado',color:'var(--red)',bg:'var(--red-bg)'},
  }
  const filtered=filterStatus?pedidos.filter(p=>p.status===filterStatus):pedidos
  const pendentes=pedidos.filter(p=>p.status==='pendente').length
  const missingCount=Object.keys(missingVenda).length

  return(
    <AdminPage
      title={t('configs.pedidosTitle')}
      subtitle={t('configs.pedidosSubtitle')}
      actions={
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {missingCount>0&&(
            <button onClick={async()=>{
              if(!(await askConfirm({ title: t('configs.confirmSyncMissing', { count: missingCount }), danger: false }))) return
              for(const p of pedidos.filter(x=>missingVenda[x.id])) await repairVenda(p)
            }} style={{padding:'8px 14px',fontSize:11,borderRadius:8,background:'var(--red)',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>
              {t('configs.syncMissingSales')}
            </button>
          )}
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{width:'auto'}}>
            <option value="">{t('configs.allStatuses')}</option>
            <option value="pendente">{t('orderStatus.pendente')}</option>
            <option value="confirmado">{t('orderStatus.confirmado')}</option>
            <option value="entregue">{t('orderStatus.entregue')}</option>
            <option value="cancelado">{t('orderStatus.cancelado')}</option>
          </select>
        </div>
      }
    >
      {(pendentes>0||missingCount>0)&&(
        <div style={{marginBottom:16}}>
          {pendentes>0&&<div style={{fontSize:12,color:'var(--red)',marginTop:2}}>{t('configs.awaitingConfirm', { count: pendentes })}</div>}
          {missingCount>0&&<div style={{fontSize:12,color:'var(--red)',marginTop:2,fontWeight:600}}>{t('configs.deliveredNoSale', { count: missingCount })}</div>}
        </div>
      )}

      {loading
        ? <div style={{color:'var(--text2)',fontSize:13}}>{t('common.loading')}</div>
        : filtered.length===0
          ? <div style={{color:'var(--text3)',textAlign:'center',padding:'40px 0'}}>{t('configs.noOrders')}</div>
          : filtered.map(p=>{
            const s=STATUS_MAP[p.status]||STATUS_MAP.pendente
            return(
              <PortalSurface key={p.id} style={{marginBottom:12,borderLeft:p.status==='pendente'?'3px solid var(--gold)':'3px solid var(--border)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:14}}>{p.bars?.nome} &mdash; {pedidoSaleDate(p)}</div>
                    {p.data_entrega_prevista && p.data_pedido && p.data_entrega_prevista !== p.data_pedido && (
                      <div style={{fontSize:11,color:'var(--text3)'}}>Pedido registrado: {p.data_pedido}</div>
                    )}
                    {p.data_entrega_prevista&&<div style={{fontSize:12,color:'var(--text3)'}}>Entrega: {p.data_entrega_prevista}</div>}
                    {p.obs&&<div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>{p.obs}</div>}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:700}}>&yen;{Math.round(p.total_estimado).toLocaleString()}</span>
                    <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,background:s.bg,color:s.color}}>{s.label}</span>
                  </div>
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
                  {(p.pedidos_itens||[]).map(it=>(
                    <PedidoItemChip
                      key={it.id}
                      nome={it.produtos?.nome || '?'}
                      qtd={it.qtd}
                      precoUnitario={it.preco_unitario}
                      custoUnitario={it.produtos?.custo}
                    />
                  ))}
                </div>
                {missingVenda[p.id]&&(
                  <div style={{marginBottom:12,padding:'10px 14px',borderRadius:10,background:'var(--red-bg)',border:'1px solid #f5c6c6',fontSize:12,color:'var(--red)'}}>
                    <Icon name="warning" size={14} /> {t('configs.saleNotRegistered')}
                    <button onClick={()=>repairVenda(p)} disabled={repairing===p.id}
                      style={{marginLeft:10,padding:'4px 10px',fontSize:11,borderRadius:6,background:'var(--red)',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>
                      {repairing===p.id ? t('configs.registering') : t('configs.registerSaleNow')}
                    </button>
                  </div>
                )}
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>setDetailPedido(p)} style={{padding:'6px 14px',fontSize:11,borderRadius:8,fontWeight:600}}><Icon name="pedidos" size={14} /> {t('orderDetail.open')}</button>
                  {p.status==='pendente'&&<>
                    <button onClick={()=>updateStatus(p.id,'confirmado')} style={{padding:'6px 14px',fontSize:11,borderRadius:8,background:'var(--navy)',color:'var(--gold)',border:'none',fontWeight:600}}>{t('configs.confirm')}</button>
                    <button onClick={()=>updateStatus(p.id,'cancelado')} className="btn-danger" style={{padding:'6px 14px',fontSize:11,borderRadius:8}}>{t('common.cancel')}</button>
                  </>}
                  <button onClick={async()=>{ if(!(await askConfirm({ title: t('configs.confirmDeleteOrder'), danger: true })))return; setPedidos(prev=>prev.filter(x=>x.id!==p.id)); await supabase.from('pedidos_itens').delete().eq('pedido_id',p.id); const {data:v}=await supabase.from('vendas').select('id').eq('obs','Auto: order '+p.id.slice(0,8)).maybeSingle(); if(v){await supabase.from('vendas_itens').delete().eq('venda_id',v.id); await supabase.from('vendas').delete().eq('id',v.id);} await supabase.from('pedidos').delete().eq('id',p.id); }} style={{padding:'6px 14px',fontSize:11,borderRadius:8,background:'var(--red)',color:'white',border:'none',fontWeight:600,cursor:'pointer'}}><Icon name="trash" size={14} /></button>
                  {p.status==='confirmado'&&(
                    <button onClick={()=>openChecklist(p)} style={{padding:'6px 14px',fontSize:11,borderRadius:8,background:'var(--green)',color:'white',border:'none',fontWeight:600}}>{t('configs.markDelivered')}</button>
                  )}
                </div>
              </PortalSurface>
            )
          })
      }

      {detailPedido&&<OrderDetailPopup pedido={detailPedido} date={pedidoSaleDate(detailPedido)} onClose={()=>setDetailPedido(null)} />}
      {checklistPedido&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:'var(--bg2)',borderRadius:16,padding:'28px 28px 24px',width:'100%',maxWidth:480,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
            <div style={{fontSize:16,fontWeight:800,color:'var(--c-text)',marginBottom:4}}>{t('configs.deliveryChecklist')}</div>
            <div style={{fontSize:12,color:'var(--text3)',marginBottom:20}}>{checklistPedido.bars?.nome} &mdash; {t('configs.markEachItem')}</div>
            {(checklistPedido.pedidos_itens||[]).map(it=>(
              <div key={it.id} onClick={()=>setCheckedItems(prev=>({...prev,[it.id]:!prev[it.id]}))}
                style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:10,marginBottom:8,cursor:'pointer',
                  background:checkedItems[it.id]?'var(--green-bg)':'var(--bg3)',
                  border:checkedItems[it.id]?'1.5px solid var(--green)':'1.5px solid var(--border)',transition:'all 0.15s'}}>
                <div style={{width:22,height:22,borderRadius:6,flexShrink:0,
                  background:checkedItems[it.id]?'var(--green)':'var(--bg2)',
                  border:checkedItems[it.id]?'none':'2px solid var(--border)',
                  display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:13,fontWeight:700}}>
                  {checkedItems[it.id]?'\u2713':''}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600}}>{it.produtos?.nome}</div>
                  <div style={{fontSize:11,color:'var(--text3)'}}>Qtd: {it.qtd} &times; &yen;{(it.preco_unitario||0).toLocaleString()}</div>
                  <SupplierCostHint
                    produtoId={it.produto_id}
                    produtoNome={it.produtos?.nome}
                    byProductId={supplierByProdId}
                    byProductName={supplierByProdName}
                  />
                </div>
                <div style={{fontWeight:700,fontSize:13}}>&yen;{((it.preco_unitario||0)*it.qtd).toLocaleString()}</div>
              </div>
            ))}
            <div style={{background:'var(--navy)',borderRadius:10,padding:'12px 16px',display:'flex',justifyContent:'space-between',marginTop:12,marginBottom:20}}>
              <span style={{color:'rgba(255,255,255,0.6)',fontSize:13}}>{t('common.total')}</span>
              <span style={{color:'var(--gold)',fontWeight:800,fontSize:15}}>&yen;{Math.round(checklistPedido.total_estimado).toLocaleString()}</span>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>{setChecklistPedido(null);setCheckedItems({})}} style={{flex:1,padding:'11px',borderRadius:10,border:'1px solid var(--border)',background:'transparent',fontSize:13,cursor:'pointer'}}>{t('common.cancel')}</button>
              <button onClick={confirmDelivery} style={{flex:2,padding:'11px',borderRadius:10,border:'none',
                background:Object.values(checkedItems).every(v=>v)?'var(--green)':'var(--border)',
                color:Object.values(checkedItems).every(v=>v)?'white':'var(--text3)',
                fontSize:13,fontWeight:700,cursor:'pointer'}}>
                {t('configs.markedConfirmDelivery', {
                  checked: Object.values(checkedItems).filter(v=>v).length,
                  total: Object.values(checkedItems).length,
                })}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  )
}
