import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate, Spinner, Empty, filterSupplierVendas } from './utils'
import { PageHeader, PortalKpi, PortalSurface, PortalPills, PortalAlert } from './ui/PageLayout'
import { pagamentoStatus, pagamentosPendentes, totalPagamentosPendentes } from '../lib/faturaPagamentos'
import { confirmFaturaPayment } from '../lib/faturaLedger'
import { useI18n } from '../lib/i18n'
import MarkPaidPopup from './MarkPaidPopup'
import Icon from './ui/Icon'
import { ColumnChart } from './ui/Charts'
import { averageOfActive, invoiceCheck, invoiceDeliveries, invoiceLockError, invoiceMoney, invoicePeriod, paymentKind } from '../lib/money'

// Local date key (toISOString shifts to UTC, which moved Tokyo dates one day back).
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function getBillingPeriod(date) {
  const d = new Date(date + 'T12:00:00')
  const day = d.getDate(), year = d.getFullYear(), month = d.getMonth()
  if (day <= 5) return { start: ymd(new Date(year,month,1)), end: ymd(new Date(year,month,5)), due: ymd(new Date(year,month,20)) }
  if (day <= 20) return { start: ymd(new Date(year,month,6)), end: ymd(new Date(year,month,20)), due: ymd(new Date(year,month+1,5)) }
  return { start: ymd(new Date(year,month,21)), end: ymd(new Date(year,month+1,0)), due: ymd(new Date(year,month+1,20)) }
}

// The adjustment columns come from sql/money_structure.sql; say so when they are not in the database yet.
function adjustErrText(error, t) {
  const msg = String(error?.message || error || '')
  return /ajuste/i.test(msg) ? t('invoiceLock.needSql') : msg
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
  const [payItem, setPayItem] = useState(null)
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
  // No week with sales → no average (was ¥1 because of `|| 1`).
  const avgWeek = averageOfActive(weeks.map(w => w.total))

  // Monthly chart - last 4 months
  const months = []
  for (let i=3; i>=0; i--) {
    const d = new Date(); d.setMonth(d.getMonth()-i)
    const mk = d.toISOString().slice(0,7)
    const total = vendas.filter(v=>v.data?.startsWith(mk)).reduce((a,v)=>a+(+v.total||0),0)
    months.push({ label: mk.slice(5), total })
  }

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
          { label: t('invoices.toReceive'), value: fmtYen(totalPending), color: totalPending > 0 ? 'var(--red)' : 'var(--green)', icon: 'invoices', tone: totalPending > 0 ? 'danger' : 'success' },
          { label: t('invoices.overdueCount'), value: overdue.length, color: overdue.length > 0 ? 'var(--red)' : 'var(--green)', icon: 'warning', tone: overdue.length > 0 ? 'danger' : 'success' },
          { label: t('invoices.upcoming'), value: upcoming.length, color: 'var(--c-text)', icon: 'shifts', tone: 'info' },
          { label: t('invoices.avgPerWeek'), value: avgWeek == null ? '—' : fmtYen(avgWeek), color: 'var(--c-text)', icon: 'trendUp' },
        ].map(k=>(
          <PortalKpi key={k.label} label={k.label} value={k.value} color={k.color} icon={k.icon} tone={k.tone} />
        ))}
      </div>

      {/* Pending client payments */}
      {pagamentos.length>0 && (
        <PortalAlert variant="amber">
          <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>{t('invoices.pendingReview', { count: pagamentos.length })}</div>
          {pagamentos.map(p=>{
            const st = pagamentoStatus(p)
            return (
            <div key={p.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{p.faturas?.bars?.nome} — {fmtYen(p.valor)} <span style={{ fontSize:11, color: st.tone==='green'?'var(--green)':'var(--amber)', marginLeft:6 }}>{st.label}</span></div>
                <div style={{ fontSize:11, color:'var(--text2)' }}>{fmtDate(p.data)} · {p.metodo} {p.notas?'· '+p.notas:''}</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {p.comprovante_url && <a href={p.comprovante_url} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'var(--c-text)', fontWeight:600, padding:'5px 10px', borderRadius:8, border:'1px solid var(--border)', background: 'var(--bg2)', textDecoration:'none' }}>{t('invoices.receiptLink')}</a>}
                <button onClick={async()=>{
                  try { await confirmFaturaPayment(supabase, p) } catch (e) { alert(e.message) }
                  load()
                }} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'none', background:'var(--green)', color:'white', cursor:'pointer', fontWeight:700 }}>{t('invoices.confirmCredit')}</button>
              </div>
            </div>
          )})}
        </PortalAlert>
      )}

      <PortalSurface
        title={t('invoices.weeklyRevenue')}
        headerRight={<span style={{ fontSize:12, color:'var(--text2)' }}>{t('invoices.avgWeek', { amount: avgWeek == null ? '—' : fmtYen(avgWeek) })}</span>}
      >
        <ColumnChart
          data={weeks.map(w => ({ label: w.label, value: w.total }))}
          format={fmtYen} highlight="last" height={160} empty={t('dash.noData')}
        />
      </PortalSurface>

      <PortalSurface title={t('invoices.monthlyRevenue')}>
        <ColumnChart
          data={months.map(m => ({ label: m.label, value: m.total }))}
          format={fmtYen} highlight="last" height={140} empty={t('dash.noData')}
        />
      </PortalSurface>

      {upcoming.length>0 && (
        <PortalSurface title={t('invoices.nextDue')}>
          {upcoming.map(f => {
            const daysLeft = Math.ceil((new Date(f.data_vencimento)-new Date())/(1000*60*60*24))
            return (
              <div key={f.id} onClick={() => setPayItem({ type: 'fatura', id: f.id, label: f.bars?.nome || '?', amount: (+f.total||+f.valor||0)-(+f.pago||0), dueDate: f.data_vencimento, paid: false })} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid var(--border)', cursor: 'pointer' }}>
                <div style={{ width:44, height:44, borderRadius:12, background:daysLeft<=5?'var(--red-bg)':'var(--green-bg)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <div style={{ fontSize:16, fontWeight:800, color:daysLeft<=5?'var(--red)':'var(--green)', lineHeight:1 }}>{daysLeft}</div>
                  <div style={{ fontSize:9, color:'var(--text2)', textTransform:'uppercase' }}>{t('common.days')}</div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{f.bars?.nome}</div>
                  <div style={{ fontSize:11, color:'var(--text2)' }}>{t('common.dueOn', { date: fmtDate(f.data_vencimento) })} · {fmtDate(invoicePeriod(f).start)} → {fmtDate(invoicePeriod(f).end)}</div>
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
      {payItem && <MarkPaidPopup item={payItem} onClose={() => setPayItem(null)} onSaved={load} />}
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
  const [saving, setSaving] = useState(false)
  const [selBar, setSelBar] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [payItem, setPayItem] = useState(null)
  const [pedidos, setPedidos] = useState([])
  const [adjust, setAdjust] = useState(null)
  const [lockErr, setLockErr] = useState('')

  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  const [allPagamentos, setAllPagamentos] = useState([])
  async function load() {
    const [fR, bR, vR, pR, pedR] = await Promise.all([
      supabase.from('faturas').select('*, bars(nome)').order('data_vencimento',{ascending:false}),
      supabase.from('bars').select('*').order('nome'),
      supabase.from('vendas').select('*, vendas_itens(qtd,preco_unitario,produtos(nome))').order('data',{ascending:false}),
      supabase.from('fatura_pagamentos').select('*').order('criado_em',{ascending:false}),
      supabase.from('pedidos').select('id,bar_id,status,total_estimado,data_pedido,data_entrega_prevista,criado_em'),
    ])
    setFaturas(fR.data||[]); setBars(bR.data||[]); setVendas(filterSupplierVendas(vR.data||[])); setAllPagamentos(pR.data||[]); setPedidos(pedR.data||[])
    if (bR.data?.length>0 && !selBar) setSelBar(bR.data[0].id)
    setLoading(false)
  }
  // The period, issue date and due date start from the current billing cycle and can all be changed.
  const [genForm, setGenForm] = useState(() => {
    const p = getBillingPeriod(ymd(new Date()))
    return { start: p.start, end: p.end, issue: ymd(new Date()), due: p.due, ajuste: '', motivo: '' }
  })
  const setGen = (k, v) => setGenForm(f => ({ ...f, [k]: v }))
  async function generateInvoice() {
    if (!selBar || !genForm.start || !genForm.end || genForm.start > genForm.end) return
    const venc = genForm.due || customDue || getBillingPeriod(genForm.end).due
    // Invoice lock: total = linked deliveries + an explicit adjustment with its reason.
    const deliveries = invoiceDeliveries({ bar_id: selBar, periodo_inicio: genForm.start, periodo_fim: genForm.end }, { pedidos, vendas }).total
    const ajuste = Math.round(+genForm.ajuste || 0)
    const motivo = genForm.motivo.trim()
    const total = deliveries + ajuste
    const lock = invoiceLockError({ total, deliveries, ajuste, motivo })
    if (lock) { setLockErr(t('invoiceLock.needReason')); return }
    setLockErr('')
    setSaving(true)
    const row = { bar_id:selBar, valor:total, data_emissao:genForm.issue || genForm.start, periodo_inicio:genForm.start, periodo_fim:genForm.end, data_vencimento:venc, total, pago:0, status:'pendente' }
    if (ajuste) Object.assign(row, { ajuste, ajuste_motivo: motivo })
    const { error } = await supabase.from('faturas').insert(row)
    setSaving(false)
    if (error) { setLockErr(adjustErrText(error, t)); return }
    setShowForm(false); setGenForm(f => ({ ...f, ajuste: '', motivo: '' })); load()
  }
  async function saveAdjust() {
    if (!adjust) return
    const ajuste = Math.round(+adjust.ajuste || 0)
    const motivo = String(adjust.motivo || '').trim()
    if (ajuste && !motivo) { setLockErr(t('invoiceLock.needReason')); return }
    setSaving(true)
    const { error } = await supabase.from('faturas').update({ ajuste, ajuste_motivo: motivo || null }).eq('id', adjust.id)
    setSaving(false)
    if (error) { setLockErr(adjustErrText(error, t)); return }
    setLockErr(''); setAdjust(null); load()
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
        <PortalSurface title={t('invoices.generateInvoice')}>
          <div style={{ marginBottom:12 }}><label className="form-label">{t('common.bar')}</label><select value={selBar} onChange={e=>setSelBar(e.target.value)}>{bars.map(b=><option key={b.id} value={b.id}>{b.nome}</option>)}</select></div>
          <div className="grid4" style={{ marginBottom:12 }}>
            <div><label className="form-label">{t('invoices.periodStart')}</label><input type="date" value={genForm.start} onChange={e=>setGen('start', e.target.value)} /></div>
            <div><label className="form-label">{t('invoices.periodEnd')}</label><input type="date" value={genForm.end} onChange={e=>setGen('end', e.target.value)} /></div>
            <div><label className="form-label">{t('invoices.issueDate')}</label><input type="date" value={genForm.issue} onChange={e=>setGen('issue', e.target.value)} /></div>
            <div><label className="form-label">{t('common.dueDate')}</label><input type="date" value={genForm.due} onChange={e=>setGen('due', e.target.value)} /></div>
          </div>
          {selBar && (() => {
            const period = { start: genForm.start, end: genForm.end, due: genForm.due }
            const linked = invoiceDeliveries({ bar_id: selBar, periodo_inicio: period.start, periodo_fim: period.end }, { pedidos, vendas })
            const periodVendas = linked.rows
            const total = linked.total + Math.round(+genForm.ajuste || 0)
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
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ color:'var(--text2)' }}>{t('invoiceLock.deliveriesTotal')}</span><span style={{ fontWeight:600 }}>{fmtYen(linked.total)}</span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:8, margin:'8px 0' }}>
                  <input type="number" value={genForm.ajuste} onChange={e=>setGen('ajuste', e.target.value)} placeholder={t('invoiceLock.adjustAmount')} aria-label={t('invoiceLock.adjustAmount')} />
                  <input value={genForm.motivo} onChange={e=>setGen('motivo', e.target.value)} placeholder={t('invoiceLock.adjustReason')} aria-label={t('invoiceLock.adjustReason')} />
                </div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:'var(--text2)' }}>{t('common.total')}</span><span style={{ fontWeight:800, fontSize:16, color:'var(--c-text)' }}>{fmtYen(total)}</span>
                </div>
              </div>
            )
          })()}
          {lockErr && showForm && <div style={{ color:'var(--red)', fontSize:12, marginBottom:8 }}>{lockErr}</div>}
          <div style={{ display:'flex', justifyContent:'flex-end' }}><button className="btn-primary" onClick={generateInvoice} disabled={saving}>{saving ? t('common.generating') : t('common.generate')}</button></div>
        </PortalSurface>
      )}

      {filtered.length===0 ? <Empty text={t('invoices.noInvoices')} icon="🧾" /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(f => {
            const remaining = Math.max(0,(+f.total||+f.valor||0)-(+f.pago||0))
            const pendingPay = pagamentosPendentes(allPagamentos, f.id)
            const pendingTotal = totalPagamentosPendentes(allPagamentos, f.id)
            const pct = (+f.total||+f.valor)>0?Math.min(100,Math.round((+f.pago||0)/(+f.total||+f.valor)*100)):0
            const isOverdue = f.status!=='pago'&&remaining>0&&new Date(f.data_vencimento)<new Date()
            const period = invoicePeriod(f)
            const linked = invoiceDeliveries(f, { pedidos, vendas })
            const periodVendas = linked.rows
            const check = invoiceCheck(f, linked.total)
            const money = invoiceMoney(f, allPagamentos)
            return (
              <div key={f.id} style={{ background:'var(--bg2)', border:'1px solid', borderColor:isOverdue?'rgba(255,59,48,0.3)':'var(--border)', borderRadius:16, overflow:'hidden', boxShadow:'var(--shadow)' }}>
                <div style={{ padding:'14px 18px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700 }}>{f.bars?.nome}</div>
                      <div style={{ fontSize:12, color:'var(--text2)' }}>{fmtDate(period.start)} → {fmtDate(period.end)} · {t('cashflow.dueOnDate', { date: fmtDate(f.data_vencimento) })}</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, background:f.status==='pago'?'var(--green-bg)':isOverdue?'var(--red-bg)':'var(--blue-bg)', color:f.status==='pago'?'var(--green)':isOverdue?'var(--red)':'var(--navy)' }}>
                        {f.status==='pago' ? t('invoices.statusPaid') : isOverdue ? t('invoices.statusOverdue') : f.status==='parcial' ? t('invoices.statusPartial') : t('invoices.statusPending')}
                      </span>
                      <div style={{ fontSize:18, fontWeight:800, color:'var(--c-text)', marginTop:4 }}>{fmtYen(f.total||f.valor||0)}</div>
                    </div>
                  </div>
                  <div style={{ height:5, background:'var(--bg3)', borderRadius:3, overflow:'hidden', marginBottom:6 }}>
                    <div style={{ height:'100%', width:pct+'%', background:f.status==='pago'?'var(--green)':'var(--gold)', borderRadius:3 }}/>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text2)', marginBottom:10 }}>
                    <span>{t('invoices.paidLabel', { amount: fmtYen(money.received), pct })}{money.direct > 0 ? ` · ${t('ledger.directPaid')}: ${fmtYen(money.direct)}` : ''}</span>
                    {remaining>0&&<span style={{ color:'var(--red)', fontWeight:600 }}>{t('invoices.remainingLabel', { amount: fmtYen(remaining) })}</span>}
                  </div>
                  <div style={{ fontSize:12, color:'var(--text2)', marginBottom:8 }}>
                    {t('invoiceLock.line', { deliveries: fmtYen(check.deliveries), count: periodVendas.length })}
                    {check.ajuste !== 0 && <> · {t('invoiceLock.adjustLine', { amount: fmtYen(check.ajuste), reason: check.motivo || '—' })}</>}
                  </div>
                  {!check.ok && (
                    <div style={{ background:'var(--red-bg)', border:'1px solid rgba(239,68,68,0.35)', borderRadius:8, padding:'8px 12px', marginBottom:10, fontSize:12 }}>
                      <div style={{ fontWeight:700, color:'var(--red)' }}>
                        {check.needsReason ? t('invoiceLock.noReason') : t('invoiceLock.diff', { diff: fmtYen(check.diff), deliveries: fmtYen(check.deliveries), total: fmtYen(check.total) })}
                      </div>
                      {adjust?.id === f.id ? (
                        <div style={{ display:'grid', gridTemplateColumns:'130px 1fr auto auto', gap:6, marginTop:8 }}>
                          <input type="number" value={adjust.ajuste} onChange={e=>setAdjust(a=>({ ...a, ajuste:e.target.value }))} aria-label={t('invoiceLock.adjustAmount')} />
                          <input value={adjust.motivo} onChange={e=>setAdjust(a=>({ ...a, motivo:e.target.value }))} placeholder={t('invoiceLock.adjustReason')} aria-label={t('invoiceLock.adjustReason')} />
                          <button type="button" className="btn-primary" disabled={saving} onClick={saveAdjust} style={{ padding:'4px 12px', fontSize:12 }}>{t('common.save')}</button>
                          <button type="button" onClick={()=>{ setAdjust(null); setLockErr('') }} style={{ padding:'4px 12px', fontSize:12 }}>{t('common.cancel')}</button>
                          {lockErr && <div style={{ gridColumn:'1 / -1', color:'var(--red)' }}>{lockErr}</div>}
                        </div>
                      ) : (
                        <button type="button" onClick={()=>{ setLockErr(''); setAdjust({ id:f.id, ajuste:String(check.ajuste + check.diff), motivo:check.motivo }) }} style={{ marginTop:6, padding:'4px 12px', fontSize:12, borderRadius:8, border:'1px solid var(--border)', background:'var(--bg2)', cursor:'pointer' }}>{t('invoiceLock.record')}</button>
                      )}
                    </div>
                  )}
                  {pendingPay.length>0 && (
                    <div style={{ background:'var(--amber-bg)', border:'1px solid #fcd34d', borderRadius:8, padding:'8px 12px', marginBottom:10, fontSize:12 }}>
                      {t('invoices.underReview', { amount: fmtYen(pendingTotal), count: pendingPay.length })}
                      {pendingPay.map(p => (
                        <div key={p.id} style={{ color:'var(--text2)', marginTop:4 }}>{p.metodo}{p.notas ? ` · ${p.notas}` : ''}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button onClick={()=>setPayItem({ type: 'fatura', id: f.id })} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'none', background:f.status==='pago'?'transparent':'var(--navy)', color:f.status==='pago'?'var(--navy)':'white', outline:f.status==='pago'?'1px solid var(--border)':'none', cursor:'pointer', fontWeight:600 }}>{f.status==='pago' ? t('ledger.open') : t('ledger.record')}</button>
                    {f.status==='pago'&&!f.ryoshusho_id&&<button onClick={()=>generateRyoshusho(f)} disabled={saving} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'none', background:'var(--gold)', color:'white', cursor:'pointer', fontWeight:600 }}>{t('invoices.generateRyoshusho')}</button>}
                    {f.ryoshusho_id&&<span style={{ fontSize:12, color:'var(--green)', fontWeight:600, padding:'6px 0' }}>{t('invoices.ryoshushoIssued')}</span>}
                    {periodVendas.length>0&&<button onClick={()=>setExpanded(expanded===f.id?null:f.id)} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>
                      {expanded===f.id ? t('invoices.hideDeliveries') : t('invoices.showDeliveries')} {t('invoices.deliveriesCount', { count: periodVendas.length })}
                    </button>}
                    <button onClick={async()=>{ if(!confirm(t('invoices.confirmDeleteInvoice')))return; await supabase.from('fatura_pagamentos').delete().eq('fatura_id',f.id); await supabase.from('faturas').delete().eq('id',f.id); setFaturas(prev=>prev.filter(x=>x.id!==f.id)) }} style={{ padding:'6px 14px', fontSize:12, borderRadius:8, border:'none', background:'var(--red)', color:'white', cursor:'pointer', fontWeight:600 }}><Icon name="trash" size={14} /></button>
                  </div>
                </div>
                {expanded===f.id && (
                  <div style={{ borderTop:'1px solid var(--border)', background:'var(--bg3)', padding:'12px 18px' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', marginBottom:8 }}>{t('invoices.deliveriesInPeriod')}</div>
                    {periodVendas.map(r=>{
                      const v = r.kind === 'venda' ? vendas.find(x => x.id === r.id) : null
                      return (
                      <div key={r.kind + r.id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                        <div>
                          <span style={{ fontWeight:600 }}>{fmtDate(r.data)}</span>
                          <span style={{ color:'var(--text2)', marginLeft:8 }}>
                            {r.kind === 'pedido' ? t('invoiceLock.orderRow', { id: String(r.id).slice(0, 8) }) : (v?.vendas_itens||[]).map(it=>it.produtos?.nome+'×'+it.qtd).join(', ')}
                          </span>
                        </div>
                        <span style={{ fontWeight:700 }}>{fmtYen(r.valor)}</span>
                      </div>
                    )})}
                    <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, marginTop:8, paddingTop:8, borderTop:'2px solid var(--border)' }}>
                      <span>{t('common.total')}</span><span style={{ color:'var(--c-text)' }}>{fmtYen(linked.total)}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {payItem && <MarkPaidPopup item={payItem} onClose={() => setPayItem(null)} onSaved={load} />}
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
  // Same rule as Cash flow: only confirmed payments count as received; review and bar → supplier are apart.
  const sumOf = kind => payments.filter(p => paymentKind(p) === kind).reduce((a, p) => a + (+p.valor || 0), 0)
  const totalPaid = sumOf('received')
  const totalReview = sumOf('review')
  const totalDirect = sumOf('direct')
  return (
    <div>
      <PortalSurface
        title={t('invoices.paymentHistory')}
        headerRight={<span style={{ fontSize:14, fontWeight:700, color:'var(--green)' }}>{t('invoices.totalReceived', { amount: fmtYen(totalPaid) })}</span>}
      >
      {(totalReview > 0 || totalDirect > 0) && (
        <div style={{ fontSize:12, color:'var(--text2)', marginBottom:10 }}>
          {totalReview > 0 && <span>{t('ledger.inReview')}: <b style={{ color:'var(--amber)' }}>{fmtYen(totalReview)}</b></span>}
          {totalReview > 0 && totalDirect > 0 && ' · '}
          {totalDirect > 0 && <span>{t('ledger.directPaid')}: <b>{fmtYen(totalDirect)}</b></span>}
        </div>
      )}
      {payments.length===0?<Empty text={t('invoices.noPayments')} icon="💳" />:(
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {payments.map(p=>{
            const st = pagamentoStatus(p)
            return (
            <div key={p.id} style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px', display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ width:40, height:40, borderRadius:10, background: st.tone==='green'?'var(--green-bg)':'var(--amber-bg)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>
                <Icon name={/dinheiro|cash/i.test(p.metodo)?'payCash':/stripe|cart/i.test(p.metodo)?'payCard':'imposto'} size={16} />
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
