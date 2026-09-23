import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate, Spinner, Empty, filterSupplierVendas } from './utils'
import { PageHeader, PortalKpi, PortalSurface, PortalPills, PortalAlert } from './ui/PageLayout'
import { pagamentoStatus, pagamentosPendentes, totalPagamentosPendentes, pagamentoEmAnalise } from '../lib/faturaPagamentos'
import { useI18n } from '../lib/i18n'

function getBillingPeriod(date) {
  const d = new Date(date)
  const day = d.getDate(), year = d.getFullYear(), month = d.getMonth()
  if (day <= 5) return { start: new Date(year,month,1).toISOString().slice(0,10), end: new Date(year,month,5).toISOString().slice(0,10), due: new Date(year,month,20).toISOString().slice(0,10) }
  if (day <= 20) return { start: new Date(year,month,6).toISOString().slice(0,10), end: new Date(year,month,20).toISOString().slice(0,10), due: new Date(year,month+1,5).toISOString().slice(0,10) }
  return { start: new Date(year,month,21).toISOString().slice(0,10), end: new Date(year,month+1,0).toISOString().slice(0,10), due: new Date(year,month+1,20).toISOString().slice(0,10) }
}

export default function Faturas() {
  const { t } = useI18n()
  const [tab, setTab] = useState('overview')
  return (
    <div className="fade-in" style={{ maxWidth: 1000 }}>
      <PageHeader
        title={t('invoices.title')}
        subtitle={t('invoices.subtitle')}
        actions={<PortalPills options={[['overview', t('invoices.tabOverview')],['invoices', t('invoices.tabInvoices')],['payments', t('invoices.tabPayments')]]} value={tab} onChange={setTab} />}
      />
      {tab==='overview'  && <Overview />}
      {tab==='invoices'  && <InvoiceList />}
      {tab==='payments'  && <PaymentList />}
    </div>
  )
}

function Overview() {
  const { t } = useI18n()
  const [faturas, setFaturas] = useState([])
  const [vendas, setVendas] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  const [pagamentos, setPagamentos] = useState([])
  async function load() {
    const [fR, vR, pR] = await Promise.all([
      supabase.from('faturas').select('*, bars(nome)').order('data_vencimento',{ascending:false}),
      supabase.from('vendas').select('total,data,bar_id').order('data'),
      supabase.from('fatura_pagamentos').select('*, faturas(*, bars(nome))').eq('confirmado',false).order('criado_em',{ascending:false}),
    ])
    setFaturas(fR.data||[]); setVendas(filterSupplierVendas(vR.data||[])); setPagamentos(pR.data||[]); setLoading(false)
  }
  if (loading) return <Spinner text={t('common.loading')} />

  const pending = faturas.filter(f=>f.status!=='pago')
  const totalPending = pending.reduce((a,f)=>a+((+f.total||+f.valor||0)-(+f.pago||0)),0)
  const overdue = pending.filter(f=>new Date(f.data_vencimento)<new Date())
  const upcoming = pending.filter(f=>new Date(f.data_vencimento)>=new Date()).sort((a,b)=>new Date(a.data_vencimento)-new Date(b.data_vencimento))

  // Weekly spend chart - last 8 weeks
  const weeks = []
  for (let i=7; i>=0; i--) {
    const end = new Date(); end.setDate(end.getDate() - i*7)
    const start = new Date(end); start.setDate(start.getDate()-6)
    const startStr = start.toISOString().slice(0,10)
    const endStr = end.toISOString().slice(0,10)
    const total = vendas.filter(v=>v.data>=startStr&&v.data<=endStr).reduce((a,v)=>a+(+v.total||0),0)
    weeks.push({ label: start.toLocaleDateString('pt-BR',{month:'short',day:'numeric'}), total })
  }
  const maxWeek = Math.max(...weeks.map(w=>w.total), 1)
  const avgWeek = Math.round(weeks.reduce((a,w)=>a+w.total,0)/weeks.filter(w=>w.total>0).length||1)

  // Monthly chart - last 4 months
  const months = []
  for (let i=3; i>=0; i--) {
    const d = new Date(); d.setMonth(d.getMonth()-i)
    const mk = d.toISOString().slice(0,7)
    const total = vendas.filter(v=>v.data?.startsWith(mk)).reduce((a,v)=>a+(+v.total||0),0)
    months.push({ label: mk.slice(5), total })
  }
  const maxMonth = Math.max(...months.map(m=>m.total), 1)

  return (
    <div>
      {overdue.length>0 && (
        <PortalAlert variant="red">
          <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>{t('invoices.overduePayments', { count: overdue.length })}</div>
          <div style={{ fontSize:12, opacity:0.9 }}>{overdue.map(f=>(f.bars?.nome||'?')+' — '+fmtYen((+f.total||+f.valor||0)-(+f.pago||0))).join(' · ')}</div>
        </PortalAlert>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
        {[
          { label: t('invoices.toReceive'), value: fmtYen(totalPending), color: totalPending > 0 ? 'var(--red)' : 'var(--green)' },
          { label: t('invoices.overdueCount'), value: overdue.length, color: overdue.length > 0 ? 'var(--red)' : 'var(--green)' },
          { label: t('invoices.upcoming'), value: upcoming.length, color: 'var(--navy)' },
          { label: t('invoices.avgPerWeek'), value: fmtYen(avgWeek), color: 'var(--navy)' },
        ].map(k=>(
          <PortalKpi key={k.label} label={k.label} value={k.value} color={k.color} />
        ))}
      </div>

      {/* Pending client payments */}
      {pagamentos.length>0 && (
        <PortalAlert variant="amber">
          <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>🔔 {t('invoices.pendingReview', { count: pagamentos.length })}</div>
          {pagamentos.map(p=>{
            const st = pagamentoStatus(p)
            return (
            <div key={p.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{p.faturas?.bars?.nome} — {fmtYen(p.valor)} <span style={{ fontSize:11, color: st.tone==='green'?'var(--green)':'var(--amber)', marginLeft:6 }}>{st.label}</span></div>
                <div style={{ fontSize:11, color:'var(--text2)' }}>{fmtDate(p.data)} · {p.metodo} {p.notas?'· '+p.notas:''}</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {p.comprovante_url && <a href={p.comprovante_url} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'var(--navy)', fontWeight:600, padding:'5px 10px', borderRadius:8, border:'1px solid var(--border)', background:'white', textDecoration:'none' }}>{t('invoices.receiptLink')}</a>}
                <button onClick={async()=>{
                  const f = p.faturas
                  const totalFatura = +f.total || +f.valor || 0
                  const newPago = (+f.pago||0)+(+p.valor||0)
                  await supabase.from('fatura_pagamentos').update({ confirmado:true, confirmado_em:new Date().toISOString() }).eq('id',p.id)
                  await supabase.from('faturas').update({ pago:newPago, status:newPago>=totalFatura?'pago':'parcial' }).eq('id',f.id)
                  load()
                }} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'none', background:'#16a34a', color:'white', cursor:'pointer', fontWeight:700 }}>{t('invoices.confirmCredit')}</button>
              </div>
            </div>
          )})}
        </PortalAlert>
      )}

      <PortalSurface
        title={t('invoices.weeklyRevenue')}
        headerRight={<span style={{ fontSize:12, color:'var(--text2)' }}>{t('invoices.avgWeek', { amount: fmtYen(avgWeek) })}</span>}
      >
        <div style={{ display:'flex', alignItems:'flex-end', gap:6, height:100 }}>
          {weeks.map((w,i) => {
            const pct = Math.max(w.total/maxWeek*100, w.total>0?4:0)
            const isCurrent = i===7
            const isHigh = w.total === Math.max(...weeks.map(x=>x.total)) && w.total > 0
            const isLow = w.total > 0 && w.total === Math.min(...weeks.filter(x=>x.total>0).map(x=>x.total))
            return (
              <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                <div style={{ fontSize:9, color:'var(--text2)', fontWeight:600, textAlign:'center' }}>
                  {w.total>0?Math.round(w.total/1000)+'k':''}
                  {isHigh && <span style={{ color:'var(--green)' }}> ↑</span>}
                  {isLow && <span style={{ color:'var(--red)' }}> ↓</span>}
                </div>
                <div style={{ width:'100%', height:pct+'%', minHeight:w.total>0?3:0, borderRadius:'4px 4px 0 0', transition:'height 0.3s',
                  background:isHigh?'var(--green)':isLow?'var(--red)':isCurrent?'var(--navy)':'var(--border)' }}/>
                <div style={{ fontSize:9, color:isCurrent?'var(--navy)':'var(--text3)', fontWeight:isCurrent?700:400, textAlign:'center' }}>{w.label}</div>
              </div>
            )
          })}
        </div>
      </PortalSurface>

      <PortalSurface title={t('invoices.monthlyRevenue')}>
        <div style={{ display:'flex', alignItems:'flex-end', gap:10, height:80 }}>
          {months.map((m,i) => {
            const pct = Math.max(m.total/maxMonth*100, m.total>0?4:0)
            const isCurrent = i===3
            return (
              <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                <div style={{ fontSize:11, color:'var(--text2)', fontWeight:600 }}>{m.total>0?fmtYen(m.total):''}</div>
                <div style={{ width:'100%', height:pct+'%', minHeight:m.total>0?3:0, background:isCurrent?'var(--navy)':'var(--border)', borderRadius:'6px 6px 0 0' }}/>
                <div style={{ fontSize:11, color:isCurrent?'var(--navy)':'var(--text3)', fontWeight:isCurrent?700:400 }}>{m.label}</div>
              </div>
            )
          })}
        </div>
      </PortalSurface>

      {upcoming.length>0 && (
        <PortalSurface title={t('invoices.nextDue')}>
          {upcoming.map(f => {
            const daysLeft = Math.ceil((new Date(f.data_vencimento)-new Date())/(1000*60*60*24))
            return (
              <div key={f.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
                <div style={{ width:44, height:44, borderRadius:12, background:daysLeft<=5?'#fef2f2':'#f0fdf4', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <div style={{ fontSize:16, fontWeight:800, color:daysLeft<=5?'var(--red)':'var(--green)', lineHeight:1 }}>{daysLeft}</div>
                  <div style={{ fontSize:9, color:'var(--text2)', textTransform:'uppercase' }}>{t('common.days')}</div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{f.bars?.nome}</div>
                  <div style={{ fontSize:11, color:'var(--text2)' }}>{t('common.dueOn', { date: fmtDate(f.data_vencimento) })} · {fmtDate(f.data_emissao)} → {fmtDate(f.data_vencimento)}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:16, fontWeight:800, color:'var(--red)' }}>{fmtYen(f.total-(f.pago||0))}</div>
                  <div style={{ fontSize:10, color:'var(--text2)' }}>{t('common.remaining')}</div>
                </div>
              </div>
            )
          })}
        </PortalSurface>
      )}
    </div>
  )
}

function InvoiceList() {
  const { t } = useI18n()
  const [faturas, setFaturas] = useState([])
  const [bars, setBars] = useState([])
  const [vendas, setVendas] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [customDue, setCustomDue] = useState('')
  const [payModal, setPayModal] = useState(null)
  const [payForm, setPayForm] = useState({ valor:'', metodo:'Cash', notas:'', emAnalise:false })
  const [saving, setSaving] = useState(false)
  const [selBar, setSelBar] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  const [allPagamentos, setAllPagamentos] = useState([])
  async function load() {
    const [fR, bR, vR, pR] = await Promise.all([
      supabase.from('faturas').select('*, bars(nome)').order('data_vencimento',{ascending:false}),
      supabase.from('bars').select('*').order('nome'),
      supabase.from('vendas').select('*, vendas_itens(qtd,preco_unitario,produtos(nome))').order('data',{ascending:false}),
      supabase.from('fatura_pagamentos').select('*').order('criado_em',{ascending:false}),
    ])
    setFaturas(fR.data||[]); setBars(bR.data||[]); setVendas(filterSupplierVendas(vR.data||[])); setAllPagamentos(pR.data||[])
    if (bR.data?.length>0 && !selBar) setSelBar(bR.data[0].id)
    setLoading(false)
  }
  async function generateInvoice() {
    if (!selBar) return; setSaving(true)
    const period = getBillingPeriod(new Date().toISOString().slice(0,10))
    const venc = customDue || period.due
    const total = vendas.filter(v=>v.bar_id===selBar&&v.data>=period.start&&v.data<=period.end).reduce((a,v)=>a+(+v.total||0),0)
    await supabase.from('faturas').insert({ bar_id:selBar, valor:total, data_emissao:period.start, periodo_inicio:period.start, periodo_fim:period.end, data_vencimento:venc, total, pago:0, status:'pendente' })
    setSaving(false); setShowForm(false); load()
  }
  async function registerPayment() {
    if (!payForm.valor||!payModal) return; setSaving(true)
    const valor = +payForm.valor
    const emAnalise = payForm.emAnalise || pagamentoEmAnalise({ metodo: payForm.metodo })
    await supabase.from('fatura_pagamentos').insert({
      fatura_id: payModal.id,
      valor,
      metodo: payForm.metodo,
      notas: payForm.notas,
      data: new Date().toISOString().slice(0, 10),
      confirmado: !emAnalise,
      confirmado_em: emAnalise ? null : new Date().toISOString(),
    })
    if (!emAnalise) {
      const newPago = (payModal.pago||0)+valor
      await supabase.from('faturas').update({ pago:newPago, status:newPago>=payModal.valor?'pago':'parcial' }).eq('id',payModal.id)
    }
    setSaving(false); setPayModal(null); setPayForm({ valor:'', metodo:'Cash', notas:'', emAnalise:false }); load()
  }
  async function generateRyoshusho(fatura) {
    setSaving(true)
    const { data } = await supabase.from('ryoshusho').insert({ bar_id:fatura.bar_id, data:new Date().toISOString().slice(0,10), valor:fatura.total, descricao:'Payment '+fatura.periodo_inicio+' to '+fatura.periodo_fim, metodo:'Bank Transfer' }).select().single()
    if (data) await supabase.from('faturas').update({ ryoshusho_id:data.id }).eq('id',fatura.id)
    setSaving(false); load()
  }

  const filtered = faturas.filter(f=>filterStatus==='all'||f.status===filterStatus)
  if (loading) return <Spinner text={t('common.loading')} />

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>{t('invoices.invoiceCount', { count: filtered.length })}</div>
        <div style={{ display:'flex', gap:8 }}>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{ width:'auto', fontSize:12 }}>
            {[['all', t('invoices.filterAll')],['pendente', t('invoices.filterPending')],['parcial', t('invoices.filterPartial')],['pago', t('invoices.filterPaid')]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn-primary" onClick={()=>setShowForm(x=>!x)} style={{ padding:'8px 16px', fontSize:12, borderRadius:10 }}>{showForm ? t('common.cancel') : t('invoices.generateInvoice')}</button>
        </div>
      </div>

      {showForm && (
        <PortalSurface title={t('invoices.generatePeriod')}>
          <div style={{ marginBottom:12 }}><label className="form-label">{t('common.bar')}</label><select value={selBar} onChange={e=>setSelBar(e.target.value)}>{bars.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div>
          {selBar && (() => {
            const period = getBillingPeriod(new Date().toISOString().slice(0,10))
            const periodVendas = vendas.filter(v=>v.bar_id===selBar&&v.data>=period.start&&v.data<=period.end)
            const total = periodVendas.reduce((a,v)=>a+(+v.total||0),0)
            return (
              <div style={{ background:'var(--bg3)', borderRadius:10, padding:'12px 16px', marginBottom:12, fontSize:13 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ color:'var(--text2)' }}>{t('common.period')}</span><span style={{ fontWeight:600 }}>{period.start} → {period.end}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ color:'var(--text2)' }}>{t('common.dueDate')}</span><span style={{ fontWeight:600 }}>{period.due}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ color:'var(--text2)' }}>{t('invoices.periodDeliveries')}</span><span style={{ fontWeight:600 }}>{periodVendas.length}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:'var(--text2)' }}>{t('common.total')}</span><span style={{ fontWeight:800, fontSize:16, color:'var(--navy)' }}>{fmtYen(total)}</span>
                </div>
              </div>
            )
          })()}
          <div style={{ display:'flex', justifyContent:'flex-end' }}><button className="btn-primary" onClick={generateInvoice} disabled={saving}>{saving ? t('common.generating') : t('common.generate')}</button></div>
        </PortalSurface>
      )}

      {filtered.length===0 ? <Empty text={t('invoices.noInvoices')} icon="🧾" /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(f => {
            const remaining = (f.total||0)-(f.pago||0)
            const pendingPay = pagamentosPendentes(allPagamentos, f.id)
            const pendingTotal = totalPagamentosPendentes(allPagamentos, f.id)
            const pct = f.valor>0?Math.round((f.pago||0)/f.total*100):0
            const isOverdue = f.status==='pendente'&&new Date(f.data_vencimento)<new Date()
            const periodStart = f.periodo_inicio || f.data_emissao
            const periodEnd = f.periodo_fim || f.data_vencimento
            const periodVendas = vendas.filter(v=>v.bar_id===f.bar_id&&v.data>=periodStart&&v.data<=periodEnd)
            return (
              <div key={f.id} style={{ background:'var(--bg2)', border:'1px solid', borderColor:isOverdue?'rgba(255,59,48,0.3)':'var(--border)', borderRadius:16, overflow:'hidden', boxShadow:'var(--shadow)' }}>
                <div style={{ padding:'14px 18px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700 }}>{f.bars?.nome}</div>
                      <div style={{ fontSize:12, color:'var(--text2)' }}>{fmtDate(f.data_emissao)} → {fmtDate(f.data_vencimento)} · Vence {fmtDate(f.data_vencimento)}</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, background:f.status==='pago'?'#f0fdf4':isOverdue?'#fef2f2':'#EAF0FA', color:f.status==='pago'?'var(--green)':isOverdue?'var(--red)':'var(--navy)' }}>
                        {f.status==='pago' ? t('invoices.statusPaid') : isOverdue ? t('invoices.statusOverdue') : f.status==='parcial' ? t('invoices.statusPartial') : t('invoices.statusPending')}
                      </span>
                      <div style={{ fontSize:18, fontWeight:800, color:'var(--navy)', marginTop:4 }}>{fmtYen(f.total||f.valor||0)}</div>
                    </div>
                  </div>
                  <div style={{ height:5, background:'var(--bg3)', borderRadius:3, overflow:'hidden', marginBottom:6 }}>
                    <div style={{ height:'100%', width:pct+'%', background:f.status==='pago'?'var(--green)':'var(--gold)', borderRadius:3 }}/>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text2)', marginBottom:10 }}>
                    <span>{t('invoices.paidLabel', { amount: fmtYen(f.pago||0), pct })}</span>
                    {remaining>0&&<span style={{ color:'var(--red)', fontWeight:600 }}>{t('invoices.remainingLabel', { amount: fmtYen(remaining) })}</span>}
                  </div>
                  {pendingPay.length>0 && (
                    <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:8, padding:'8px 12px', marginBottom:10, fontSize:12 }}>
                      ⏳ {t('invoices.underReview', { amount: fmtYen(pendingTotal), count: pendingPay.length })}
                      {pendingPay.map(p => (
                        <div key={p.id} style={{ color:'var(--text2)', marginTop:4 }}>{p.metodo}{p.notas ? ` · ${p.notas}` : ''}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {f.status!=='pago'&&<button onClick={()=>setPayModal(f)} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'none', background:'var(--navy)', color:'white', cursor:'pointer', fontWeight:600 }}>{t('invoices.registerPayment')}</button>}
                    {f.status==='pago'&&!f.ryoshusho_id&&<button onClick={()=>generateRyoshusho(f)} disabled={saving} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'none', background:'var(--gold)', color:'white', cursor:'pointer', fontWeight:600 }}>{t('invoices.generateRyoshusho')}</button>}
                    {f.ryoshusho_id&&<span style={{ fontSize:12, color:'var(--green)', fontWeight:600, padding:'6px 0' }}>{t('invoices.ryoshushoIssued')}</span>}
                    {periodVendas.length>0&&<button onClick={()=>setExpanded(expanded===f.id?null:f.id)} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>
                      {expanded===f.id ? t('invoices.hideDeliveries') : t('invoices.showDeliveries')} {t('invoices.deliveriesCount', { count: periodVendas.length })}
                    </button>}
                    <button onClick={async()=>{ if(!confirm(t('invoices.confirmDeleteInvoice')))return; await supabase.from('fatura_pagamentos').delete().eq('fatura_id',f.id); await supabase.from('faturas').delete().eq('id',f.id); setFaturas(prev=>prev.filter(x=>x.id!==f.id)) }} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'none', background:'#7f1d1d', color:'white', cursor:'pointer', fontWeight:600 }}>🗑</button>
                  </div>
                </div>
                {expanded===f.id && (
                  <div style={{ borderTop:'1px solid var(--border)', background:'var(--bg3)', padding:'12px 18px' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', marginBottom:8 }}>{t('invoices.deliveriesInPeriod')}</div>
                    {periodVendas.map(v=>(
                      <div key={v.id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                        <div>
                          <span style={{ fontWeight:600 }}>{fmtDate(v.data)}</span>
                          <span style={{ color:'var(--text2)', marginLeft:8 }}>
                            {(v.vendas_itens||[]).map(it=>it.produtos?.nome+'×'+it.qtd).join(', ')}
                          </span>
                        </div>
                        <span style={{ fontWeight:700 }}>{fmtYen(v.total)}</span>
                      </div>
                    ))}
                    <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, marginTop:8, paddingTop:8, borderTop:'2px solid var(--border)' }}>
                      <span>{t('common.total')}</span><span style={{ color:'var(--navy)' }}>{fmtYen(periodVendas.reduce((a,v)=>a+(+v.total||0),0))}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {payModal&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--bg2)', borderRadius:20, padding:'28px', width:'100%', maxWidth:400, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:4 }}>{payModal.bars?.nome}</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:20 }}>
              {t('invoices.paymentModalTotal', { total: fmtYen(payModal.total || payModal.valor), remaining: fmtYen((+payModal.total || +payModal.valor || 0) - (+payModal.pago || 0)) })}
            </div>
            <div style={{ marginBottom:12 }}><label className="form-label">{t('invoices.paymentAmount')}</label><input type="number" value={payForm.valor} onChange={e=>setPayForm({...payForm,valor:e.target.value})} autoFocus /></div>
            <div style={{ marginBottom:12 }}><label className="form-label">{t('invoices.paymentMethod')}</label><select value={payForm.metodo} onChange={e=>setPayForm({...payForm,metodo:e.target.value, emAnalise:pagamentoEmAnalise({ metodo:e.target.value })?true:payForm.emAnalise})}>{['Dinheiro','Transferência','Stripe','Cartão'].map(m=><option key={m}>{m}</option>)}</select></div>
            <div style={{ marginBottom:12 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
                <input type="checkbox" checked={payForm.emAnalise} onChange={e=>setPayForm({...payForm, emAnalise:e.target.checked})} />
                {t('invoices.paymentUnderReview')}
              </label>
            </div>
            <div style={{ marginBottom:20 }}><label className="form-label">{t('common.notes')}</label><input value={payForm.notas} onChange={e=>setPayForm({...payForm,notas:e.target.value})} placeholder={t('invoices.paymentNotesPlaceholder')} /></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:8 }}>
              <button onClick={()=>setPayModal(null)} style={{ padding:'11px', borderRadius:12, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={registerPayment} disabled={saving||!payForm.valor} style={{ padding:'11px', borderRadius:12 }}>{saving ? t('common.saving') : t('invoices.registerPayment')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PaymentList() {
  const { t } = useI18n()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  async function load() {
    const { data } = await supabase.from('fatura_pagamentos').select('*, faturas(*, bars(nome))').order('criado_em',{ascending:false}).limit(100)
    setPayments(data||[]); setLoading(false)
  }
  if (loading) return <Spinner text={t('common.loading')} />
  const totalPaid = payments.reduce((a,p)=>a+p.valor,0)
  return (
    <div>
      <PortalSurface
        title={t('invoices.paymentHistory')}
        headerRight={<span style={{ fontSize:14, fontWeight:700, color:'var(--green)' }}>{t('invoices.totalReceived', { amount: fmtYen(totalPaid) })}</span>}
      >
      {payments.length===0?<Empty text={t('invoices.noPayments')} icon="💳" />:(
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {payments.map(p=>{
            const st = pagamentoStatus(p)
            return (
            <div key={p.id} style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px', display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ width:40, height:40, borderRadius:10, background: st.tone==='green'?'#f0fdf4':'#fffbeb', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>
                {/dinheiro|cash/i.test(p.metodo)?'💵':/stripe/i.test(p.metodo)?'💳':/cart/i.test(p.metodo)?'💳':'🏦'}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{p.faturas?.bars?.nome} <span style={{ fontSize:11, color: st.tone==='green'?'var(--green)':'var(--amber)', marginLeft:6 }}>{st.label}</span></div>
                <div style={{ fontSize:11, color:'var(--text2)' }}>{fmtDate(p.data)} · {p.metodo} {p.notas?'· '+p.notas:''}</div>
              </div>
              <div style={{ fontSize:16, fontWeight:800, color: st.tone==='green'?'var(--green)':'var(--amber)' }}>{fmtYen(p.valor)}</div>
            </div>
          )})}
        </div>
      )}
      </PortalSurface>
    </div>
  )
}
