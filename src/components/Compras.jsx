import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import {
  fmtYen, fmtDate, monthKey, monthLabel, compraDate,
  Badge, Spinner, Empty, DelBtn,
  PAGAMENTOS, analyzeReceipt
} from './utils'
import { loadAllCompras } from '../lib/loadCompras'
import { SupplierPricePanel } from './SupplierPriceCheck'
import PurchaseCashflowAdvisor from './PurchaseCashflowAdvisor'
import { AdminPage, PortalSurface, PortalKpi } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'

export default function ComprasTab() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [compras, setCompras] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [fornecedores, setFornecedores] = useState([])
  const [scanning, setScanning] = useState(false)
  const [imgSrc,   setImgSrc]   = useState(null)
  const [scanned,  setScanned]  = useState(null)
  const [filterMonth, setFilterMonth] = useState('')
  const [form, setForm] = useState(defaultForm())

  function defaultForm() {
    return {
      data: new Date().toISOString().slice(0,10),
      fornecedor: '', pagamento: 'Dinheiro',
      pontos_ganhos: 0, desconto_pontos: 0, tipo_ponto: '', data_pagamento: '', foto_url: '',
      subtotal: 0, total_pago: 0, obs: '',
      itens: []
    }
  }

  useEffect(() => { load(); loadFornecedores() }, [])
  async function loadFornecedores() {
    const { data } = await supabase.from('fornecedores').select('id,nome,pagamento,prazo_entrega_dias,pontos_pct').order('nome')
    setFornecedores(data||[])
  }

  const selectedSupplier = fornecedores.find(f => f.nome === form.fornecedor)
  const purchaseTotal = (+form.total_pago || +form.subtotal || 0) - (+form.desconto_pontos || 0)

  async function load() {
    setLoading(true)
    const data = await loadAllCompras()
    setCompras((data || []).sort((a, b) => compraDate(b).localeCompare(compraDate(a))))
    setLoading(false)
  }

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const months = [...new Set(compras.map(c => monthKey(compraDate(c))))].sort().reverse()
  const filtered = filterMonth ? compras.filter(c => monthKey(compraDate(c)) === filterMonth) : compras

  const totalCusto    = filtered.reduce((a,c) => a + (+c.total_real||0), 0)
  const totalDesconto = filtered.reduce((a,c) => a + (+c.desconto_pontos||0), 0)
  const totalPontos   = filtered.reduce((a,c) => a + (+c.pontos_ganhos||0), 0)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      setImgSrc(ev.target.result)
      setScanning(true); setScanned(null)
      const b64 = ev.target.result.split(',')[1]
      const result = await analyzeReceipt(b64, file.type || 'image/jpeg')
      setScanning(false)
      if (result) {
        setScanned(result)
        setForm(f => ({
          ...f,
          data:            result.data        || f.data,
          fornecedor:      result.fornecedor   || f.fornecedor,
          pagamento:       result.pagamento    || f.pagamento,
          pontos_ganhos:   result.pontos_ganhos   || 0,
          desconto_pontos: result.desconto_pontos  || 0,
          subtotal:        result.subtotal     || 0,
          total_pago:      result.total_pago   || 0,
          itens: (result.itens || []).map(it => ({
            nome: it.nome, qtd: it.qtd || 1, custo_unitario: it.custo_unitario || 0
          }))
        }))
      }
    }
    reader.readAsDataURL(file)
  }

  async function saveCompra() {
    if (!form.fornecedor) return alert(t('purchases.enterSupplier'))
    setSaving(true)
    const total_real = (+form.total_pago || +form.subtotal) - (+form.desconto_pontos || 0)
    const { data: compra, error } = await supabase.from('compras').insert({
      data:            form.data,
      fornecedor:      form.fornecedor,
      pagamento:       form.pagamento,
      subtotal:        +form.subtotal,
      desconto_pontos: +form.desconto_pontos,
      total_pago:      +form.total_pago,
      total_real,
      pontos_ganhos:   +form.pontos_ganhos,
      tipo_ponto:      form.tipo_ponto||null,
      data_pagamento:  form.data_pagamento||null,
      foto_url:        form.foto_url||null,
      obs:             form.obs,
      criado_por:      user.id
    }).select().single()

    if (!error && form.itens.length > 0) {
      await supabase.from('compras_itens').insert(
        form.itens.map(it => ({ compra_id: compra.id, ...it }))
      )
      // Atualiza custo dos produtos correspondentes
      for (const it of form.itens) {
        const { data: prods } = await supabase
          .from('produtos')
          .select('id, nome')
          .ilike('nome', `%${it.nome.split(' ')[0]}%`)
        if (prods?.length) {
          await supabase.from('produtos')
            .update({ custo: it.custo_unitario })
            .eq('id', prods[0].id)
        }
      }
    }
    // Auto cashflow entry
    const hoje = form.data_pagamento || form.data
    if (hoje) {
      await supabase.from('caixa_movimentos').insert({
        tipo: 'saida',
        valor: total_real,
        descricao: 'Compra: ' + form.fornecedor,
        metodo: form.pagamento,
        data: hoje
      }).catch(()=>{})
    }
    setSaving(false)
    setForm(defaultForm()); setImgSrc(null); setScanned(null)
    load()
  }

  async function deleteCompra(id) {
    if (!confirm(t('purchases.confirmDelete'))) return
    await supabase.from('compras').delete().eq('id', id)
    load()
  }

  return (
    <AdminPage title={t('nav.purchases')} subtitle={t('purchases.subtitle')}>
      <PortalSurface title={t('purchases.scanReceipt')}>
        <div
          onClick={() => document.getElementById('fileCompra').click()}
          style={{
            border: '1.5px dashed var(--border2)', borderRadius: 12,
            padding: '24px 16px', textAlign: 'center', cursor: 'pointer',
            transition: 'background 0.15s'
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {imgSrc
            ? <img src={imgSrc} alt="nota" style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 8 }} />
            : <>
                <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t('purchases.tapToSelect')}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                  {t('purchases.aiExtractHint')}
                </div>
              </>
          }
          <input type="file" id="fileCompra" accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={handleFile} />
        </div>
        {scanning && <div style={{ marginTop: 12 }}><Spinner text={t('purchases.analyzing')} /></div>}
        {scanned && (
          <div style={{
            marginTop: 12, background: 'var(--bg3)', borderRadius: 8,
            padding: '10px 14px', fontSize: 13
          }}>
            ✅ <strong>{scanned.fornecedor}</strong>
            {' · '}{t('purchases.scannedItems', { count: scanned.itens?.length || 0 })}
            {' · '}{t('purchases.scannedPaid', { amount: fmtYen(scanned.total_pago || 0) })}
            {scanned.desconto_pontos > 0 && ` · ${t('purchases.pointsDiscountShort', { amount: fmtYen(scanned.desconto_pontos) })}`}
          </div>
        )}
      </PortalSurface>

      <PortalSurface title={t('purchases.registerPurchase')}>
        <div className="grid3" style={{ marginBottom: 12 }}>
          <div><label className="form-label">{t('common.date')}</label>
            <input type="date" value={form.data} onChange={e=>setF('data',e.target.value)} /></div>
          <div><label className="form-label">{t('common.supplier')}</label>
            <select value={form.fornecedor} onChange={e=>setF('fornecedor',e.target.value)}>
              <option value="">{t('common.selectSupplier')}</option>
              {fornecedores.map(f=><option key={f.id} value={f.nome}>{f.nome}</option>)}
            </select></div>
          <div><label className="form-label">{t('common.payment')}</label>
            <select value={form.pagamento} onChange={e=>setF('pagamento',e.target.value)}>
              {PAGAMENTOS.map(p => <option key={p}>{p}</option>)}
            </select></div>
        </div>
        {selectedSupplier && (
          <SupplierPricePanel
            fornecedorId={selectedSupplier.id}
            fornecedorNome={selectedSupplier.nome}
            onApplyPrice={(sp) => {
              const nome = sp.produtos?.nome || ''
              const exists = form.itens.findIndex(it => it.nome.toLowerCase() === nome.toLowerCase())
              const row = { nome, qtd: 1, custo_unitario: sp.preco }
              if (exists >= 0) {
                const itens = [...form.itens]
                itens[exists] = { ...itens[exists], custo_unitario: sp.preco }
                setF('itens', itens)
              } else {
                setF('itens', [...form.itens, row])
              }
            }}
          />
        )}
        <div className="grid4" style={{ marginBottom: 12 }}>
          <div><label className="form-label">{t('common.subtotal')} (¥)</label>
            <input type="number" value={form.subtotal} onChange={e=>setF('subtotal',e.target.value)} /></div>
          <div><label className="form-label">{t('common.pointsDiscount')} (¥)</label>
            <input type="number" value={form.desconto_pontos} onChange={e=>setF('desconto_pontos',e.target.value)} /></div>
          <div><label className="form-label">{t('common.totalPaid')} (¥)</label>
            <input type="number" value={form.total_pago} onChange={e=>setF('total_pago',e.target.value)} /></div>
          <div><label className="form-label">{t('common.pointsEarned')}</label>
            <input type="number" value={form.pontos_ganhos} onChange={e=>setF('pontos_ganhos',e.target.value)} /></div>
          <div><label className="form-label">{t('common.pointType')}</label>
            <select value={form.tipo_ponto} onChange={e=>setF('tipo_ponto',e.target.value)}>
              <option value="">{t('common.none')}</option>
              <option value="T-Point">T-Point</option>
              <option value="Rakuten">Rakuten</option>
              <option value="Waon">Waon</option>
              <option value="Nanaco">Nanaco</option>
              <option value="PayPay">PayPay</option>
              <option value="Outro">{t('common.other')}</option>
            </select></div>
          <div><label className="form-label">{t('common.paymentDate')}</label>
            <input type="date" value={form.data_pagamento} onChange={e=>setF('data_pagamento',e.target.value)} /></div>
        </div>
        <div style={{marginBottom:12}}>
          <label className="form-label">{t('common.receiptPhoto')}</label>
          <input type="file" accept="image/*,.pdf,application/pdf" onChange={async e=>{
            const file = e.target.files[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = ev => setF('foto_url', ev.target.result)
            reader.readAsDataURL(file)
          }} />
          {form.foto_url && <img src={form.foto_url} style={{marginTop:8,maxWidth:200,borderRadius:8}} alt="recibo"/>}
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="form-label">{t('common.observation')}</label>
          <input type="text" value={form.obs} onChange={e=>setF('obs',e.target.value)} placeholder={t('common.optional')} />
        </div>

        {/* Itens */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
            <label className="form-label" style={{ margin:0 }}>{t('common.invoiceItems')}</label>
            <button style={{ padding:'4px 10px', fontSize:11 }}
              onClick={() => setF('itens', [...form.itens, { nome:'', qtd:1, custo_unitario:0 }])}>
              {t('common.addItem')}
            </button>
          </div>
          {form.itens.map((it, i) => (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 80px 120px 36px', gap:6, marginBottom:6 }}>
              <input type="text" value={it.nome} placeholder={t('common.product')} onChange={e=>{
                const a=[...form.itens]; a[i]={...a[i],nome:e.target.value}; setF('itens',a)
              }}/>
              <input type="number" value={it.qtd} placeholder={t('common.qty')} onChange={e=>{
                const a=[...form.itens]; a[i]={...a[i],qtd:+e.target.value}; setF('itens',a)
              }}/>
              <input type="number" value={it.custo_unitario} placeholder={t('common.unitCost')} onChange={e=>{
                const a=[...form.itens]; a[i]={...a[i],custo_unitario:+e.target.value}; setF('itens',a)
              }}/>
              <button onClick={()=>setF('itens',form.itens.filter((_,j)=>j!==i))}
                style={{ padding:0, fontSize:14 }}>✕</button>
            </div>
          ))}
        </div>

        <PurchaseCashflowAdvisor
          purchaseAmount={purchaseTotal}
          supplierName={form.fornecedor}
          supplierPayment={selectedSupplier?.pagamento || form.pagamento}
          deliveryDays={selectedSupplier?.prazo_entrega_dias || 1}
          pointsPct={selectedSupplier?.pontos_pct || 0}
          productName={form.itens?.[0]?.nome || ''}
          qtd={form.itens?.reduce((a, it) => a + (+it.qtd || 0), 0) || 1}
        />

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:16 }}>
          <div style={{ fontSize:14 }}>
            {t('common.realCost')}: <strong style={{ color:'var(--blue)' }}>
              {fmtYen(purchaseTotal)}
            </strong>
          </div>
          <button className="btn-primary" onClick={saveCompra} disabled={saving}>
            {saving ? <><span className="spinner" />{t('common.saving')}</> : t('purchases.savePurchase')}
          </button>
        </div>
      </PortalSurface>

      <PortalSurface
        title={t('common.history')}
        headerRight={
          <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{ width:'auto' }}>
            <option value="">{t('common.allMonths')}</option>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        }
      >
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:16 }}>
          <PortalKpi label={t('purchases.totalCost')} value={fmtYen(totalCusto)} color="var(--red)" />
          <PortalKpi label={t('purchases.descPontos')} value={fmtYen(totalDesconto)} color="var(--green)" />
          <PortalKpi label={t('purchases.custoReal')} value={fmtYen(totalCusto)} color="var(--blue)" />
          <PortalKpi label={t('common.ptsAccumulated')} value={totalPontos.toLocaleString()} />
        </div>

        {loading ? <Spinner /> : filtered.length === 0 ? <Empty text={t('purchases.noPurchases')} /> : (
          <table>
            <thead>
              <tr>
                <th>{t('common.date')}</th><th>{t('common.supplier')}</th><th>{t('common.payment')}</th>
                <th>{t('common.subtotal')}</th><th>{t('purchases.descPontos')}</th><th>{t('purchases.custoReal')}</th>
                <th>Pts</th><th>{t('common.items')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td style={{ whiteSpace:'nowrap' }}>{fmtDate(c.data)}</td>
                  <td style={{ fontWeight:500 }}>{c.fornecedor}</td>
                  <td><Badge color="var(--blue)">{c.pagamento}</Badge></td>
                  <td>{fmtYen(c.subtotal)}</td>
                  <td style={{ color:'var(--green)' }}>
                    {+c.desconto_pontos > 0 ? `-${fmtYen(c.desconto_pontos)}` : '—'}
                  </td>
                  <td style={{ fontWeight:700 }}>{fmtYen(c.total_real)}</td>
                  <td>{+c.pontos_ganhos > 0 ? `+${c.pontos_ganhos}${c.tipo_ponto?' ('+c.tipo_ponto+')':''}` : '—'}</td>
                  <td>{c.data_pagamento ? fmtDate(c.data_pagamento) : '—'}</td>
                  <td>{c.foto_url ? <a href={c.foto_url} target="_blank" style={{fontSize:11}}>📷</a> : '—'}</td>
                  <td>{(c.compras_itens || []).length}</td>
                  <td><DelBtn onClick={() => deleteCompra(c.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PortalSurface>
    </AdminPage>
  )
}
