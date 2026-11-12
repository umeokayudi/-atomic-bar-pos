import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { ensureVendaFromPedido, findVendaForPedido, findVendaKeysForPedidos, pedidoSaleDate, mergeOrInsertPeriodFatura } from '../lib/pedidoVenda'
import { addStockFromDelivery } from '../lib/posSupply'
import { useAuth } from './Auth'
import { fmtYen, Badge, Spinner, Empty, DelBtn, CATEGORIAS, filterSupplierVendas, PedidoItemChip, NON_SUPPLIER_CATEGORIES } from './utils'
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
import { costPending, findDuplicates, isArchivedOrTest, isMenuItem, nameTaken, productMargin } from '../lib/catalog'
import { askConfirm, notify } from './ui/ConfirmDialog'
import AuditLogPanel from './AuditLogPanel'
import { logChange } from '../lib/audit'

// Category values saved in Portuguese by older screens → the one list the form uses.
const LEGACY_CATEGORY = { Cerveja: 'Beer', cerveja: 'Beer', vinho: 'Wine', Vinho: 'Wine', suco: 'Juice', Suco: 'Juice' }
const EMPTY_PRODUCT = { nome:'', categoria:'Beer', custo:0, preco_venda:0, estoque_atual:'', unidade:'', ativo:true }

// ── PRODUTOS ─────────────────────────────────────────────────────────────────
export function ProductsTab() {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const catalogCost = canReadProductCost(perfil?.role)
  const [produtos, setProducts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving,  setSaving]    = useState(false)
  const [editId,  setEditId]    = useState(null)
  const [form, setForm] = useState(EMPTY_PRODUCT)
  const [showMenu, setShowMenu] = useState(false)
  const [formErr, setFormErr] = useState('')

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
    if (!form.nome.trim()) return
    // One product per name: "Orange Juice (dup)", "Cramberry", "Chivas 12 (1L)" match an existing item.
    const taken = nameTaken(produtos, form.nome, editId)
    if (taken) { setFormErr(t('catalog.nameTaken', { name: taken.nome })); return }
    // A JBM product at cost ¥0 bills with no margin: the cost is required (bar menu items are exempt).
    const menuItem = isMenuItem({ nome: form.nome, categoria: LEGACY_CATEGORY[form.categoria] || form.categoria }, NON_SUPPLIER_CATEGORIES)
    if (!menuItem && form.ativo !== false && !(+form.custo > 0)) { setFormErr(t('catalogFix.needCost')); return }
    setFormErr('')
    setSaving(true)
    const row = {
      nome: form.nome.trim(),
      categoria: LEGACY_CATEGORY[form.categoria] || form.categoria,
      custo: +form.custo || 0,
      preco_venda: +form.preco_venda || 0,
      ativo: form.ativo !== false,
    }
    if (form.estoque_atual !== '' && form.estoque_atual != null) row.estoque_atual = Math.round(+form.estoque_atual || 0)
    if (form.unidade) row.unidade = form.unidade
    const res = editId
      ? await supabase.from('produtos').update(row).eq('id', editId)
      : await supabase.from('produtos').insert(row)
    setSaving(false)
    if (res.error) { setFormErr(res.error.message); return }
    setEditId(null)
    notify(t('confirm.saved'))
    setForm(EMPTY_PRODUCT)
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

  // Duplicates: orders, sales, stock and prices of the others move to the one kept; the others are switched off.
  async function mergeGroup(keep, group) {
    const dups = group.filter(p => p.id !== keep.id)
    if (!(await askConfirm({ title: t('catalogFix.mergeKeep', { name: keep.nome }), message: `${t('catalogFix.mergeLead')}\n${dups.map(d => d.nome).join(' · ')}` }))) return
    try {
      for (const d of dups) {
        for (const table of ['pedidos_itens', 'vendas_itens', 'estoque_movimentos']) {
          const { error } = await supabase.from(table).update({ produto_id: keep.id }).eq('produto_id', d.id)
          if (error) throw new Error(`${table}: ${error.message}`)
        }
        // These may already have a row for the kept product (unique per supplier/bar): best effort.
        for (const table of ['fornecedor_precos', 'estoque_regras']) await supabase.from(table).update({ produto_id: keep.id }).eq('produto_id', d.id)
        const { error } = await supabase.from('produtos').update({ ativo: false }).eq('id', d.id)
        if (error) throw new Error(error.message)
        logChange(supabase, { tabela: 'produtos', registro_id: d.id, acao: 'update', antes: { nome: d.nome, ativo: true }, depois: { ativo: false, motivo: `merged into ${keep.nome} (${keep.id})` } })
      }
      if (!(+keep.custo > 0)) {
        const withCost = dups.find(d => +d.custo > 0)
        if (withCost) await supabase.from('produtos').update({ custo: withCost.custo }).eq('id', keep.id)
      }
      notify(t('catalogFix.mergeDone', { n: dups.length, name: keep.nome }))
    } catch (e) {
      notify(t('catalogFix.mergeFail', { message: e.message }), 'error')
    }
    load()
  }

  function startEdit(p) {
    setEditId(p.id)
    setForm({ nome:p.nome, categoria:LEGACY_CATEGORY[p.categoria] || p.categoria, custo:p.custo, preco_venda:p.preco_venda, estoque_atual:p.estoque_atual ?? '', unidade:p.unidade || '', ativo:p.ativo !== false })
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
              {!CATEGORIAS.includes(form.categoria) && form.categoria && <option value={form.categoria}>{t('catalog.unknownCategory', { cat: form.categoria })}</option>}
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
        <div className="grid4" style={{ marginBottom:12, alignItems:'end' }}>
          <div><label className="form-label">{t('catalog.stock')}</label><input type="number" value={form.estoque_atual} onChange={e=>setF('estoque_atual',e.target.value)} /></div>
          <div><label className="form-label">{t('catalog.unit')}</label><input value={form.unidade} onChange={e=>setF('unidade',e.target.value)} placeholder="bottle / case / kg" /></div>
          <div><label className="form-label">{t('catalog.active')}</label>
            <select value={form.ativo === false ? 'n' : 'y'} onChange={e=>setF('ativo', e.target.value === 'y')}><option value="y">✓</option><option value="n">—</option></select>
          </div>
        </div>
        {formErr && <div style={{ color:'var(--red)', fontSize:12, marginBottom:8 }}>{formErr}</div>}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          {editId && <button onClick={()=>{setEditId(null);setForm(EMPTY_PRODUCT);setFormErr('')}}>{t('common.cancel')}</button>}
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <><span className="spinner"/>{t('common.saving')}</> : editId ? t('configs.saveEdit') : t('configs.addProduct')}
          </button>
        </div>
      </PortalSurface>

      {!loading && (() => {
        const dups = findDuplicates(produtos)
        const pending = produtos.filter(p => p.ativo !== false && costPending(p) && !isMenuItem(p, NON_SUPPLIER_CATEGORIES))
        if (!dups.length && !pending.length) return null
        return (
          <PortalSurface style={{ marginBottom: 16 }}>
            {pending.length > 0 && <div style={{ fontSize:13, color:'var(--amber)', fontWeight:600, marginBottom: dups.length ? 10 : 0 }}>{t('catalog.costPendingCount', { count: pending.length })}</div>}
            {dups.length > 0 && (
              <details>
                <summary style={{ fontSize:13, fontWeight:700, cursor:'pointer' }}>{t('catalog.duplicates', { count: dups.length })}</summary>
                <div style={{ fontSize:12, color:'var(--text2)', margin:'6px 0' }}>{t('catalog.duplicatesHint')}</div>
                <div style={{ fontSize:12, color:'var(--text2)', margin:'0 0 6px' }}>{t('catalogFix.mergeLead')}</div>
                {dups.map(g => (
                  <div key={g[0].id} style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center', fontSize:12, padding:'6px 0', borderTop:'1px solid var(--border)' }}>
                    <span style={{ fontWeight:600, marginRight:4 }}>{t('catalogFix.merge')}:</span>
                    {g.map(p => (
                      <button key={p.id} type="button" className="ui-btn is-sm" onClick={() => mergeGroup(p, g)} title={t('catalogFix.mergeKeep', { name: p.nome })}>
                        {t('catalogFix.mergeKeep', { name: p.nome })}{+p.custo > 0 ? ` · ${fmtYen(p.custo)}` : ''}
                      </button>
                    ))}
                  </div>
                ))}
              </details>
            )}
          </PortalSurface>
        )
      })()}

      <PortalSurface headerRight={(() => {
        const n = produtos.filter(p => !isArchivedOrTest(p) && isMenuItem(p, NON_SUPPLIER_CATEGORIES)).length
        return n ? <label style={{ fontSize:12, display:'flex', gap:6, alignItems:'center' }}><input type="checkbox" checked={showMenu} onChange={e=>setShowMenu(e.target.checked)} />{showMenu ? t('catalog.showMenu') : t('catalog.menuHidden', { count: n })}</label> : null
      })()}>
        {loading ? <Spinner /> : produtos.length===0 ? <Empty text={t('configs.noProducts')} /> : (
          <table>
            <thead><tr><th>{t('configs.productCol')}</th><th>{t('configs.categoryCol')}</th><th>{t('configs.costCol')}</th><th>{t('configs.sellCol')}</th><th>{t('configs.margin')}</th><th></th></tr></thead>
            <tbody>
              {produtos.filter(p=>!isArchivedOrTest(p) && (showMenu || !isMenuItem(p, NON_SUPPLIER_CATEGORIES))).map(p=>{
                // Cost ¥0 is a pending item, not a 100% margin.
                const m = productMargin(p)
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight:500 }}>{p.nome}</td>
                    <td><Badge color="var(--amber)">{p.categoria}</Badge></td>
                    <td>{costPending(p) ? <Badge color="var(--amber)">{t('catalog.costPending')}</Badge> : fmtYen(p.custo)}</td>
                    <td>{fmtYen(p.preco_venda)}</td>
                    <td style={{ fontWeight:700,
                      color:m==null?'var(--text3)':m>50?'var(--green)':m>30?'var(--amber)':'var(--red)'
                    }}>{m==null ? '—' : `${m}%`}</td>
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
// The bar's file lives in the live-store table bar_profile (one row per bar, id = bar id); HQ writes it.
const PROFILE_FIELDS = ['endereco', 'responsavel', 'email_cobranca', 'telefone', 'prazo_dias', 'limite_credito', 'dados_fiscais']
const EMPTY_PROFILE = Object.fromEntries(PROFILE_FIELDS.map(k => [k, '']))
const EMPTY_BAR = { id: null, nome: '', cor: '#1C7ED6', logo: '', ...EMPTY_PROFILE }

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
  const [profiles, setProfiles] = useState({})
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
    const [{ data: b }, { data: v }, brandRes, profRes] = await Promise.all([
      supabase.from('bars').select('*').order('nome'),
      supabase.from('vendas').select('bar_id, total'),
      supabase.from('bar_brand').select('*'),
      supabase.from('bar_profile').select('*'),
    ])
    setProfiles(Object.fromEntries((profRes?.data || []).map(r => [r.bar_id || r.id, r])))
    setBars(b||[]); setSales(filterSupplierVendas(v||[]))
    setMarcas(Object.fromEntries((brandRes?.data || []).map(r => [r.bar_id || r.id, r])))
    setLoading(false)
  }

  const withMarca = b => (marcas[b.id] ? { ...b, marca: marcas[b.id] } : b)

  function startEdit(b) {
    const full = withMarca(b)
    const prof = profiles[b.id] || {}
    setForm({ id: b.id, nome: b.nome || '', cor: brandColorOf(full) || EMPTY_BAR.cor, logo: cleanLogo(full.marca?.logo), ...Object.fromEntries(PROFILE_FIELDS.map(k => [k, prof[k] ?? ''])) })
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
      const email = String(form.email_cobranca || '').trim()
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(t('barProfile.badEmail'))
      const profile = {
        id, bar_id: id, atualizado_em: new Date().toISOString(),
        ...Object.fromEntries(PROFILE_FIELDS.map(k => [k, typeof form[k] === 'string' ? form[k].trim() : form[k]])),
        prazo_dias: form.prazo_dias === '' ? null : Math.max(0, Math.round(+form.prazo_dias || 0)),
        limite_credito: form.limite_credito === '' ? null : Math.max(0, Math.round(+form.limite_credito || 0)),
      }
      const { error: profErr } = await supabase.from('bar_profile').upsert(profile)
      if (profErr) throw profErr
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
            <div className="grid4" style={{ gap: 10 }}>
              {PROFILE_FIELDS.map(k => (
                <div key={k} style={k === 'endereco' || k === 'dados_fiscais' ? { gridColumn: 'span 2' } : undefined}>
                  <label className="form-label">{t(`barProfile.${k}`)}</label>
                  <input type={k === 'prazo_dias' || k === 'limite_credito' ? 'number' : k === 'email_cobranca' ? 'email' : 'text'}
                    value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} />
                </div>
              ))}
            </div>
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

      <AuditLogPanel />

    </AdminPage>
  )
}
