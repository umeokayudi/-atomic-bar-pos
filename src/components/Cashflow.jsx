import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate, Spinner, Empty, compraDueDate, isCompraOverdue } from './utils'
import { splitPendingCompras, splitPendingFaturas, buildCashflowEvents, pagamentoFor, pagamentoMap } from '../lib/compraPagamentos'
import { uploadCobrancaDoc, buildCobrancaDocument, downloadTextFile } from '../lib/cobrancaDocs'
import JbmHoldingPanel from './JbmHoldingPanel'
import CashflowAi from './CashflowAi'
import MarkPaidPopup from './MarkPaidPopup'
import OpenInvoicesList from './OpenInvoicesList'
import { AdminPage, PortalKpi, PortalSurface, PortalPills } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'

export default function Cashflow() {
  const { t } = useI18n()
  const [tab, setTab] = useState('overview')
  return (
    <AdminPage
      title={t('nav.cashflow')}
      subtitle={t('cashflow.subtitle')}
      wide
      actions={
        <PortalPills
          scrollable
          options={[
            ['overview', t('cashflow.tabOverview')],
            ['agenda', t('cashflow.tabAgenda')],
            ['in', t('cashflow.tabIn')],
            ['out', t('cashflow.tabOut')],
            ['caixa', t('cashflow.tabCaixa')],
            ['holding', t('cashflow.tabHolding')],
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {tab==='overview'  && <CashflowOverview />}
      {tab==='agenda'    && <Calendario />}
      {tab==='in'        && <MoneyIn />}
      {tab==='out'       && (
        <>
          <PurchasePayments />
          <div style={{ height: 20 }} />
          <MoneyOut />
        </>
      )}
      {tab==='holding'   && <JbmHoldingPanel />}
      {tab==='caixa'     && <Caixa />}
    </AdminPage>
  )
}

function CashflowOverview() {
  const { t } = useI18n()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [payItem, setPayItem] = useState(null)
  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  async function load() {
    const [fR, cR, pR, foR] = await Promise.all([
      supabase.from('faturas').select('*, bars(nome)').order('data_vencimento'),
      supabase.from('compras').select('*').order('data'),
      supabase.from('fatura_pagamentos').select('id,fatura_id,valor,confirmado,metodo,data'),
      supabase.from('fornecedores').select('nome,pagamento'),
    ])
    setData({
      faturas: fR.data||[],
      compras: cR.data||[],
      pagamentos: pR.data||[],
      fornecedores: foR.data||[],
    })
    setLoading(false)
  }
  if (loading) return <Spinner text={t('common.loading')} />

  const { faturas, compras, pagamentos = [], fornecedores = [] } = data
  const today = new Date().toISOString().slice(0,10)
  const pendingSplit = splitPendingCompras(compras, fornecedores)
  const faturaSplit = splitPendingFaturas(faturas, today)
  const pagamentosPendentes = pagamentos.filter(p => !p.confirmado)

  // Entradas = valor já recebido dos bars (parcial ou total), não só fatura "paga"
  const paidIn = faturas.reduce((a, f) => a + (+f.pago || 0), 0)
  const pendingIn = faturas.reduce((a, f) => a + Math.max(0, (+f.total || +f.valor || 0) - (+f.pago || 0)), 0)
  const emAnalise = pagamentosPendentes.reduce((a, p) => a + (+p.valor || 0), 0)

  // Saídas = só compras marcadas como pagas (Le Vin pendente não entra no caixa)
  const paidOut = compras.filter(c => c.status_pagamento === 'pago').reduce((a, c) => a + (+c.total_real || +c.total_pago || 0), 0)
  const pendingOut = pendingSplit.pendingTotal
  const overdueOut = pendingSplit.overdueTotal

  const netCash = paidIn - paidOut
  const openFaturas = faturas.filter(f => f.status !== 'pago' && Math.max(0, (+f.total || +f.valor || 0) - (+f.pago || 0)) > 0)
  const openCompras = [...pendingSplit.overdue, ...(pendingSplit.noDue || []), ...(pendingSplit.future || [])]

  // Last 8 weeks: money in by the date each confirmed payment arrived
  const weeks = []
  for (let i=7; i>=0; i--) {
    const end = new Date(); end.setDate(end.getDate()-i*7)
    const start = new Date(end); start.setDate(start.getDate()-6)
    const s = start.toISOString().slice(0,10)
    const e = end.toISOString().slice(0,10)
    const inAmt = pagamentos.filter(p=>p.confirmado&&p.data>=s&&p.data<=e).reduce((a,p)=>a+(+p.valor||0),0)
    const outAmt = compras.filter(c=>c.status_pagamento==='pago'&&(c.data_pagamento||c.data)>=s&&(c.data_pagamento||c.data)<=e).reduce((a,c)=>a+(+c.total_real||+c.total_pago||0),0)
    weeks.push({ label: start.toLocaleDateString('en-US',{month:'short',day:'numeric'}), in:inAmt, out:outAmt, net:inAmt-outAmt })
  }
  const maxVal = Math.max(...weeks.map(w=>Math.max(w.in,w.out)), 1)

  const weekAhead = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i)
    weekAhead.push(d.toISOString().slice(0, 10))
  }
  const pagMap = pagamentoMap(fornecedores)
  const weekText = weekAhead.map(ds => {
    const inAmt = openFaturas.filter(f => f.data_vencimento === ds).reduce((a, f) => a + Math.max(0, (+f.total || +f.valor || 0) - (+f.pago || 0)), 0)
    const outAmt = compras.filter(c => c.status_pagamento === 'pendente' && compraDueDate(c, pagamentoFor(c.fornecedor, pagMap)) === ds)
      .reduce((a, c) => a + (+c.total_real || +c.total_pago || 0), 0)
    if (!inAmt && !outAmt) return ''
    return `${fmtDate(ds)}: ${inAmt ? `in ${fmtYen(inAmt)}` : ''}${inAmt && outAmt ? ' · ' : ''}${outAmt ? `out ${fmtYen(outAmt)}` : ''}`
  }).filter(Boolean).join('\n')
  const collectText = faturaSplit.overdue.length
    ? faturaSplit.overdue.map(f => `${f.bars?.nome || 'Bar'}: ${fmtYen(f.amount)} (due ${fmtDate(f.dueDate)})`).join('\n')
    : ''
  const payText = pendingSplit.overdue.length
    ? pendingSplit.overdue.map(c => `${c.fornecedor || 'Supplier'}: ${fmtYen(c.amount)} (due ${fmtDate(c.dueDate)})`).join('\n')
    : ''
  const whyText = netCash < 0
    ? `Net cash ${fmtYen(netCash)} because we already paid ${fmtYen(paidOut)} and only ${fmtYen(paidIn)} came in. ${fmtYen(pendingIn)} can still be collected.`
    : `Net cash ${fmtYen(netCash)}. Confirmed in ${fmtYen(paidIn)}, paid out ${fmtYen(paidOut)}.`

  const aiSnap = {
    paidIn, paidOut, netCash, pendingIn, pendingOut,
    overdueIn: faturaSplit.overdueTotal, overdueOut,
    weekText, collectText, payText, whyText,
  }

  return (
    <div>
      <div className="cash-big">
        <PortalKpi label={t('cashflow.simpleIn')} value={fmtYen(paidIn)} color="var(--green)" sub={t('cashflow.simpleInSub')} />
        <PortalKpi label={t('cashflow.simpleOut')} value={fmtYen(paidOut)} color="var(--red)" sub={t('cashflow.simpleOutSub')} />
        <PortalKpi label={t('cashflow.simpleNet')} value={fmtYen(netCash)} color={netCash >= 0 ? 'var(--green)' : 'var(--red)'} sub={t('cashflow.simpleNetSub')} />
      </div>
      <p className="cash-explain">
        {netCash < 0
          ? t('cashflow.simpleExplainNeg', { paidOut: fmtYen(paidOut), paidIn: fmtYen(paidIn), pendingIn: fmtYen(pendingIn) })
          : t('cashflow.simpleExplainPos', { pendingIn: fmtYen(pendingIn), pendingOut: fmtYen(pendingOut) })}
        {emAnalise > 0 ? ' ' + t('cashflow.simpleExplainWaiting', { amount: fmtYen(emAnalise) }) : ''}
      </p>

      <PortalSurface
        title={t('cashflow.barsOweTitle', { amount: fmtYen(pendingIn) })}
        sub={t('cashflow.barsOweSub')}
        style={{ marginBottom: 16 }}
      >
        <OpenInvoicesList
          faturas={openFaturas}
          pagamentos={pagamentos}
          onOpen={f => setPayItem({ type: 'fatura', id: f.id })}
          emptyText={t('cashflow.barsOweNone')}
        />
      </PortalSurface>

      <PortalSurface title={t('cashflow.weOweTitle', { amount: fmtYen(pendingOut) })} sub={t('cashflow.weOweSub')} style={{ marginBottom: 16 }}>
        {openCompras.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t('cashflow.weOweNone')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {openCompras.map(c => {
              const late = c.dueDate && c.dueDate < today
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPayItem({ type: 'compra', id: c.id, label: c.fornecedor || t('common.supplier'), amount: c.amount, dueDate: c.dueDate, paid: false })}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, border: '1px solid', borderColor: late ? 'rgba(239,68,68,0.45)' : 'var(--border)', background: 'var(--bg2)', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{c.fornecedor || t('common.supplier')}</div>
                    <div style={{ fontSize: 11, color: late ? 'var(--red)' : 'var(--text2)', fontWeight: late ? 700 : 400 }}>
                      {c.dueDate ? (late ? t('common.expiredOn', { date: fmtDate(c.dueDate) }) : t('cashflow.dueOnDate', { date: fmtDate(c.dueDate) })) : fmtDate(c.data)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--red)' }}>{fmtYen(c.amount)}</div>
                    <div style={{ fontSize: 10, color: 'var(--navy)', fontWeight: 700 }}>{t('payMark.tap')}</div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </PortalSurface>

      <PortalSurface title={t('cashflow.weeklyFlow')} style={{ marginBottom:16 }}>
        <div style={{ display:'flex', gap:16, marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11 }}><div style={{ width:12,height:12,borderRadius:2,background:'var(--green)' }}/> {t('cashflow.inflows')}</div>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11 }}><div style={{ width:12,height:12,borderRadius:2,background:'var(--red)' }}/> {t('cashflow.outflows')}</div>
        </div>
        <div style={{ display:'flex', alignItems:'flex-end', gap:8, height:120 }}>
          {weeks.map((w,i) => (
            <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
              <div style={{ width:'100%', display:'flex', gap:2, alignItems:'flex-end', height:90 }}>
                <div style={{ flex:1, background:'rgba(52,199,89,0.8)', borderRadius:'3px 3px 0 0', height:Math.max(w.in/maxVal*90, w.in>0?3:0)+'px' }}/>
                <div style={{ flex:1, background:'rgba(255,59,48,0.8)', borderRadius:'3px 3px 0 0', height:Math.max(w.out/maxVal*90, w.out>0?3:0)+'px' }}/>
              </div>
              <div style={{ fontSize:9, color:i===7?'var(--navy)':'var(--text3)', fontWeight:i===7?700:400, textAlign:'center' }}>{w.label}</div>
              {w.net!==0 && <div style={{ fontSize:9, color:w.net>=0?'var(--green)':'var(--red)', fontWeight:600 }}>{w.net>=0?'+':''}{Math.round(w.net/1000)}k</div>}
            </div>
          ))}
        </div>
      </PortalSurface>

      <CashflowAi snapshot={aiSnap} />
      {payItem && <MarkPaidPopup item={payItem} onClose={() => setPayItem(null)} onSaved={load} />}
    </div>
  )
}

function MoneyIn() {
  const { t } = useI18n()
  const [faturas, setFaturas] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showPaid, setShowPaid] = useState(false)
  const [payItem, setPayItem] = useState(null)
  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  async function load() {
    const [fR, pR] = await Promise.all([
      supabase.from('faturas').select('*, bars(nome)').order('data_vencimento',{ascending:false}),
      supabase.from('fatura_pagamentos').select('id,fatura_id,valor,confirmado,metodo,data'),
    ])
    setFaturas(fR.data||[]); setPagamentos(pR.data||[]); setLoading(false)
  }
  if (loading) return <Spinner text={t('common.loading')} />
  const total = faturas.reduce((a,f)=>a+(+f.total||+f.valor||0),0)
  const received = faturas.reduce((a,f)=>a+(+f.pago||0),0)
  const open = faturas.filter(f => f.status !== 'pago' && (+f.total||+f.valor||0) - (+f.pago||0) > 0)
  const paid = faturas.filter(f => !open.includes(f))
  return (
    <div>
      <div className="cash-big" style={{ marginBottom: 20 }}>
        <PortalKpi label={t('cashflow.totalInvoiced')} value={fmtYen(total)} color="var(--navy)" />
        <PortalKpi label={t('ledger.received')} value={fmtYen(received)} color="var(--green)" />
        <PortalKpi label={t('ledger.left')} value={fmtYen(Math.max(0, total - received))} color={total - received > 0 ? 'var(--red)' : 'var(--green)'} />
      </div>
      <PortalSurface title={t('cashflow.barsOweTitle', { amount: fmtYen(Math.max(0, total - received)) })} sub={t('cashflow.barsOweSub')} style={{ marginBottom: 16 }}>
        <OpenInvoicesList faturas={open} pagamentos={pagamentos} onOpen={f => setPayItem({ type: 'fatura', id: f.id })} emptyText={t('cashflow.barsOweNone')} />
      </PortalSurface>
      {paid.length > 0 && (
        <PortalSurface
          title={t('cashflow.paidInvoices', { count: paid.length })}
          headerRight={<button type="button" onClick={() => setShowPaid(x => !x)} style={{ fontSize: 12, border: '1px solid var(--border)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>{showPaid ? t('invoices.hideDeliveries') : t('invoices.showDeliveries')}</button>}
        >
          {showPaid && <OpenInvoicesList faturas={paid} pagamentos={pagamentos} onOpen={f => setPayItem({ type: 'fatura', id: f.id })} emptyText="" />}
        </PortalSurface>
      )}
      {payItem && <MarkPaidPopup item={payItem} onClose={() => setPayItem(null)} onSaved={load} />}
    </div>
  )
}

function MoneyOut() {
  const { t } = useI18n()
  const [compras, setCompras] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  async function load() {
    const { data } = await supabase.from('compras').select('*').order('data',{ascending:false}).limit(100)
    setCompras(data||[]); setLoading(false)
  }
  if (loading) return <Spinner text={t('common.loading')} />
  const total = compras.reduce((a,c)=>a+(+c.total_pago||0),0)
  const paid = compras.filter(c=>c.status_pagamento!=='pendente').reduce((a,c)=>a+(+c.total_pago||0),0)
  const pending = compras.filter(c=>c.status_pagamento==='pendente').reduce((a,c)=>a+(+c.total_pago||0),0)
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:20 }}>
        {[
          { label: t('cashflow.totalPurchased'), value: fmtYen(total), color: 'var(--navy)' },
          { label: t('status.pago'), value: fmtYen(paid), color: 'var(--red)' },
          { label: t('cashflow.pendingPayment'), value: fmtYen(pending), color: pending > 0 ? 'var(--amber)' : 'var(--green)' },
        ].map(k=>(
          <div key={k.label} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'14px' }}>
            <div style={{ fontSize:22, fontWeight:800, color:k.color }}>{k.value}</div>
            <div style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:4 }}>{k.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {compras.map(c=>(
          <div key={c.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:13, fontWeight:700 }}>{c.fornecedor||t('common.supplier')}</div>
              <div style={{ fontSize:11, color:'var(--text2)' }}>
                {t('cashflow.purchaseLabel', { date: fmtDate(c.data) })}
                {c.data_pagamento && <span> · {t('cashflow.paidOn', { date: fmtDate(c.data_pagamento) })}</span>}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:15, fontWeight:800, color:'var(--red)' }}>{fmtYen(c.total_pago||0)}</div>
              <span style={{ fontSize:11, fontWeight:700, color:c.status_pagamento==='pendente'?'var(--amber)':'var(--green)' }}>
                {c.status_pagamento==='pendente' ? t('status.pendente') : t('status.pago')}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PurchasePayments() {
  const { t } = useI18n()
  const [compras, setCompras] = useState([])
  const [fornecedores, setFornecedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ data_pagamento:'', metodo:'Card', status_pagamento:'pago' })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [payItem, setPayItem] = useState(null)
  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  async function load() {
    const [{ data: c }, { data: f }] = await Promise.all([
      supabase.from('compras').select('*').order('data',{ascending:false}).limit(100),
      supabase.from('fornecedores').select('nome,pagamento'),
    ])
    setCompras(c||[]); setFornecedores(f||[]); setLoading(false)
  }
  const pagMap = pagamentoMap(fornecedores)
  const pagamentoForNome = nome => pagamentoFor(nome, pagMap)
  const pendingSplit = splitPendingCompras(compras, fornecedores)

  async function save() {
    if (!modal) return; setSaving(true)
    await supabase.from('compras').update({ data_pagamento:form.data_pagamento||null, metodo_pagamento_real:form.metodo, status_pagamento:form.status_pagamento }).eq('id',modal.id)
    setSaving(false); setModal(null); load()
  }

  async function uploadDoc(compra, file) {
    if (!file) return
    setUploading(true)
    try {
      await uploadCobrancaDoc(compra.id, file)
      load()
    } catch (e) {
      alert(e.message || t('common.uploadError'))
    }
    setUploading(false)
  }

  async function exportDoc(compra) {
    const { data: itens } = await supabase.from('compras_itens').select('*').eq('compra_id', compra.id)
    const text = buildCobrancaDocument(compra, itens || [])
    downloadTextFile(text, `cobranca-${(compra.fornecedor || 'fornecedor').replace(/\s+/g, '-')}-${compra.data || 'doc'}.txt`)
  }

  if (loading) return <Spinner text={t('common.loading')} />
  const pendingCount = compras.filter(c=>c.status_pagamento==='pendente').length
  const overdueCount = pendingSplit.overdue.length + pendingSplit.noDue.length

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12, marginBottom:16 }}>
        {[
          { label: t('status.atrasado'), value: fmtYen(pendingSplit.overdueTotal), color: 'var(--red)', sub: t('cashflow.overdueSub') },
          { label: t('cashflow.toPay'), value: fmtYen(pendingSplit.futureTotal), color: 'var(--amber)', sub: t('cashflow.toPaySubShort') },
          { label: t('common.pending'), value: String(pendingCount), color: 'var(--navy)', sub: t('cashflow.pendingNotes') },
        ].map(k=>(
          <PortalKpi key={k.label} label={k.label} value={k.value} color={k.color} sub={k.sub} />
        ))}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>{t('cashflow.purchasePayments')}</div>
        <div style={{ display:'flex', gap:12 }}>
          {overdueCount>0 && <div style={{ fontSize:12, color:'var(--red)', fontWeight:700 }}>{t('cashflow.overdueCount', { count: overdueCount })}</div>}
          {pendingCount>0 && <div style={{ fontSize:12, color:'var(--amber)', fontWeight:600 }}>{t('cashflow.pendingCount', { count: pendingCount })}</div>}
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {compras.map(c=>{
          const due = compraDueDate(c, pagamentoForNome(c.fornecedor))
          const overdue = isCompraOverdue(c, pagamentoForNome(c.fornecedor))
          return (
          <div
            key={c.id}
            style={{ background:'var(--bg2)', border:'1px solid', borderColor:overdue?'rgba(239,68,68,0.45)':c.status_pagamento==='pendente'?'rgba(255,149,0,0.3)':'var(--border)', borderRadius:12, padding:'12px 16px', display:'flex', alignItems:'center', gap:12, cursor: 'pointer' }}
            onClick={() => setPayItem({
              type: 'compra',
              id: c.id,
              label: c.fornecedor || t('common.supplier'),
              amount: +c.total_real || +c.total_pago || 0,
              dueDate: due,
              paid: c.status_pagamento === 'pago',
              paidDate: c.data_pagamento,
            })}
          >
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{c.fornecedor||t('common.supplier')} — {fmtDate(c.data)}</div>
              <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>
                {c.pagamento} · {fmtYen(c.total_pago||0)}
                {due && c.status_pagamento==='pendente' && <span> · {t('cashflow.dueOnDate', { date: fmtDate(due) })}</span>}
                {c.status_pagamento==='pago' && c.data_pagamento && <span> · {t('cashflow.paidOnDate', { date: fmtDate(c.data_pagamento) })}</span>}
                {c.metodo_pagamento_real&&<span> {t('cashflow.via', { method: c.metodo_pagamento_real })}</span>}
              </div>
              {c.foto_url && (
                <a href={c.foto_url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--blue)', marginTop:4, display:'inline-block' }}>
                  {t('cashflow.docSaved')}
                </a>
              )}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
              <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, background:overdue?'#fef2f2':c.status_pagamento==='pendente'?'#fffbeb':'#f0fdf4', color:overdue?'var(--red)':c.status_pagamento==='pendente'?'var(--amber)':'var(--green)' }}>
                {overdue ? t('status.atrasado') : c.status_pagamento==='pendente' ? t('cashflow.toPayStatus') : t('status.pago')}
              </span>
              {c.status_pagamento==='pendente' && (
                <>
                  <label style={{ padding:'5px 10px', fontSize:11, borderRadius:8, border:'1px solid var(--border)', cursor:uploading?'wait':'pointer' }}>
                    {uploading ? '…' : `📎 ${t('common.attach')}`}
                    <input type="file" accept="image/*,.pdf,.json,.txt" style={{ display:'none' }} disabled={uploading}
                      onChange={e=>{ e.stopPropagation(); uploadDoc(c, e.target.files?.[0]); e.target.value='' }} />
                  </label>
                  <button onClick={e=>{ e.stopPropagation(); exportDoc(c) }} style={{ padding:'5px 10px', fontSize:11, borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>{t('cashflow.generateDoc')}</button>
                </>
              )}
              <button onClick={e=>{ e.stopPropagation(); setModal(c); setForm({ data_pagamento:c.data_pagamento||due||new Date().toISOString().slice(0,10), metodo:c.metodo_pagamento_real||'Bank Transfer', status_pagamento:c.status_pagamento||'pago' }) }}
                style={{ padding:'5px 12px', fontSize:12, borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>✏️ {t('common.edit')}</button>
            </div>
          </div>
        )})}
      </div>

      {modal&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--bg2)', borderRadius:20, padding:'28px', width:'100%', maxWidth:380, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:4 }}>{modal.fornecedor||'Supplier'}</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:20 }}>{fmtDate(modal.data)} · {fmtYen(modal.total_pago||0)}</div>
            <div style={{ marginBottom:12 }}><label className="form-label">{t('cashflow.paymentStatus')}</label>
              <select value={form.status_pagamento} onChange={e=>setForm({...form,status_pagamento:e.target.value})}>
                <option value="pago">{t('status.pago')}</option>
                <option value="pendente">{t('status.pendente')}</option>
              </select>
            </div>
            <div style={{ marginBottom:12 }}><label className="form-label">{t('common.paymentDate')}</label>
              <input type="date" value={form.data_pagamento} onChange={e=>setForm({...form,data_pagamento:e.target.value})} />
            </div>
            <div style={{ marginBottom:20 }}><label className="form-label">{t('common.payment')}</label>
              <select value={form.metodo} onChange={e=>setForm({...form,metodo:e.target.value})}>
                {['Cash','Card','Bank Transfer'].map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:8 }}>
              <button onClick={()=>setModal(null)} style={{ padding:'11px', borderRadius:12, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={save} disabled={saving} style={{ padding:'11px', borderRadius:12 }}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
      {payItem && <MarkPaidPopup item={payItem} onClose={() => setPayItem(null)} onSaved={load} />}
    </div>
  )
}

function Caixa() {
  const { t } = useI18n()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ tipo:'entrada', valor:'', descricao:'', metodo:'Cash', data:new Date().toISOString().slice(0,10) })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  async function load() {
    const { data } = await supabase.from('caixa_movimentos').select('*').order('data',{ascending:false}).limit(100)
    setEntries(data||[])
    setLoading(false)
  }
  async function save() {
    setSaving(true)
    await supabase.from('caixa_movimentos').insert({ ...form, valor:+form.valor })
    setSaving(false); setModal(false); setForm({ tipo:'entrada', valor:'', descricao:'', metodo:'Cash', data:new Date().toISOString().slice(0,10) }); load()
  }

  const totalIn = entries.filter(e=>e.tipo==='entrada').reduce((a,e)=>a+(+e.valor||0),0)
  const totalOut = entries.filter(e=>e.tipo==='saida').reduce((a,e)=>a+(+e.valor||0),0)
  const balance = totalIn - totalOut

  if (loading) return <Spinner text={t('common.loading')} />
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
        {[
          { label: t('cashflow.totalIn'), value: fmtYen(totalIn), color: 'var(--green)', icon: '💚' },
          { label: t('cashflow.totalOut'), value: fmtYen(totalOut), color: 'var(--red)', icon: '🔴' },
          { label: t('cashflow.balance'), value: fmtYen(balance), color: balance >= 0 ? 'var(--green)' : 'var(--red)', icon: '💰' },
        ].map(k=>(
          <div key={k.label} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'16px' }}>
            <div style={{ fontSize:22, marginBottom:4 }}>{k.icon}</div>
            <div style={{ fontSize:22, fontWeight:800, color:k.color }}>{k.value}</div>
            <div style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', marginTop:4 }}>{k.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>{t('cashflow.cashMovements')}</div>
        <button className="btn-primary" onClick={()=>setModal(true)} style={{ padding:'8px 16px', fontSize:12, borderRadius:10 }}>{t('cashflow.addMovement')}</button>
      </div>
      {entries.length===0?<Empty text={t('cashflow.noMovements')} icon="💵" />:(
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {entries.map(e=>(
            <div key={e.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:12, padding:'12px 16px', display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:e.tipo==='entrada'?'#f0fdf4':'#fef2f2', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
                {e.tipo==='entrada'?'↑':'↓'}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{e.descricao}</div>
                <div style={{ fontSize:11, color:'var(--text2)' }}>{fmtDate(e.data)} · {e.metodo}</div>
              </div>
              <button onClick={async()=>{ if(!confirm(t('common.confirmDelete')))return; await supabase.from('caixa_movimentos').delete().eq('id',e.id); setEntries(prev=>prev.filter(x=>x.id!==e.id)) }} style={{padding:'4px 8px',fontSize:11,borderRadius:6,background:'#7f1d1d',color:'white',border:'none',cursor:'pointer',marginRight:8}}>🗑</button>
              <div style={{ fontSize:15, fontWeight:800, color:e.tipo==='entrada'?'var(--green)':'var(--red)' }}>
                {e.tipo==='entrada'?'+':'-'}{fmtYen(e.valor)}
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--bg2)', borderRadius:20, padding:'28px', width:'100%', maxWidth:380, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:20 }}>{t('cashflow.addCashMovement')}</div>
            <div style={{ marginBottom:12 }}>
              <label className="form-label">{t('cashflow.movementType')}</label>
              <select value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})}>
                <option value="entrada">{t('cashflow.typeIn')}</option>
                <option value="saida">{t('cashflow.typeOut')}</option>
              </select>
            </div>
            <div style={{ marginBottom:12 }}>
              <label className="form-label">{t('common.amount')} (¥)</label>
              <input type="number" value={form.valor} onChange={e=>setForm({...form,valor:e.target.value})} autoFocus />
            </div>
            <div style={{ marginBottom:12 }}>
              <label className="form-label">{t('cashflow.description')}</label>
              <input value={form.descricao} onChange={e=>setForm({...form,descricao:e.target.value})} placeholder={t('cashflow.descPlaceholder')} />
            </div>
            <div style={{ marginBottom:12 }}>
              <label className="form-label">{t('common.method')}</label>
              <select value={form.metodo} onChange={e=>setForm({...form,metodo:e.target.value})}>
                {['Cash','Bank Transfer','Card'].map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:20 }}>
              <label className="form-label">{t('common.date')}</label>
              <input type="date" value={form.data} onChange={e=>setForm({...form,data:e.target.value})} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:8 }}>
              <button onClick={()=>setModal(false)} style={{ padding:'11px', borderRadius:12, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={save} disabled={saving||!form.valor||!form.descricao} style={{ padding:'11px', borderRadius:12 }}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Calendario() {
  const { t } = useI18n()
  const [faturas, setFaturas] = useState([])
  const [compras, setCompras] = useState([])
  const [fornecedores, setFornecedores] = useState([])
  const [pagamentosPendentes, setPagamentosPendentes] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState(null)
  const [popup, setPopup] = useState(null)
  const [payItem, setPayItem] = useState(null)
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jbm_cash_agenda') || '[]') } catch { return [] }
  })
  const [noteForm, setNoteForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    title: '',
    kind: 'outro',
  })

  function saveNotes(next) {
    setNotes(next)
    try { localStorage.setItem('jbm_cash_agenda', JSON.stringify(next)) } catch {}
  }

  useEffect(() => { load(); const iv=setInterval(load,30000); return ()=>clearInterval(iv) }, [])
  async function load() {
    const [fR, cR, foR, pR] = await Promise.all([
      supabase.from('faturas').select('*, bars(nome)').order('data_vencimento'),
      supabase.from('compras').select('*').order('data'),
      supabase.from('fornecedores').select('nome,pagamento'),
      supabase.from('fatura_pagamentos').select('id,valor,confirmado,metodo,data').eq('confirmado', false),
    ])
    setFaturas(fR.data||[])
    setCompras(cR.data||[])
    setFornecedores(foR.data||[])
    setPagamentosPendentes(pR.data||[])
    setLoading(false)
  }

  const allEvents = useMemo(
    () => buildCashflowEvents({ faturas, compras, fornecedores, pagamentosPendentes }),
    [faturas, compras, fornecedores, pagamentosPendentes]
  )

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`
  const today = new Date()
  const todayStr = today.toISOString().slice(0,10)
  const isCurrentMonth = today.getMonth()===month && today.getFullYear()===year

  const eventsByDay = useMemo(() => {
    const map = {}
    for (const ev of allEvents) {
      if (!ev.date?.startsWith(monthStr)) continue
      const day = +ev.date.slice(8, 10)
      if (!map[day]) map[day] = []
      map[day].push(ev)
    }
    for (const n of notes) {
      if (!n.date?.startsWith(monthStr)) continue
      const day = +n.date.slice(8, 10)
      if (!map[day]) map[day] = []
      map[day].push({
        type: n.kind === 'receber' ? 'in' : n.kind === 'pagar' ? 'out' : 'note',
        amount: 0,
        label: n.title,
        note: t('cashflow.agendaNote'),
        status: 'agenda',
        date: n.date,
        agendaId: n.id,
      })
    }
    return map
  }, [allEvents, monthStr, notes, t])

  const overdueFaturas = allEvents.filter(e => e.status === 'atrasado' && e.type === 'in')
  const overdueCompras = allEvents.filter(e => e.status === 'atrasado' && e.type === 'out')
  const overdueEvents = allEvents.filter(e => e.status === 'atrasado')
  const upcomingEvents = allEvents.filter(e => e.date >= todayStr && e.status !== 'atrasado').slice(0, 8)

  if (loading) return <Spinner text={t('common.loading')} />

  const statusLabel = {
    atrasado: t('status.atrasado'),
    a_pagar: t('status.a_pagar'),
    a_receber: t('status.a_receber'),
    em_analise: t('status.em_analise'),
  }
  const calendarDays = t('cashflow.calendarDays')

  return (
    <div>
      <CashflowAi snapshot={{
        weekText: upcomingEvents.map(ev => `${fmtDate(ev.date)} ${ev.type === 'in' ? 'receber' : 'pagar'} ${fmtYen(ev.amount)} ${ev.label}`).join('\n'),
        collectText: overdueFaturas.map(ev => `${ev.label} ${fmtYen(ev.amount)}`).join('\n'),
        payText: overdueCompras.map(ev => `${ev.label} ${fmtYen(ev.amount)}`).join('\n'),
        netCash: 0, paidIn: 0, paidOut: 0, pendingIn: 0, pendingOut: 0,
      }} />

      <PortalSurface title={t('cashflow.agendaAddTitle')} sub={t('cashflow.agendaAddSub')} style={{ marginBottom: 16 }}>
        <form
          onSubmit={e => {
            e.preventDefault()
            if (!noteForm.title.trim() || !noteForm.date) return
            saveNotes([...notes, { id: Date.now(), ...noteForm, title: noteForm.title.trim() }])
            setNoteForm({ ...noteForm, title: '' })
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
        >
          <input type="date" value={noteForm.date} onChange={e => setNoteForm({ ...noteForm, date: e.target.value })} style={{ minWidth: 140 }} />
          <input value={noteForm.title} onChange={e => setNoteForm({ ...noteForm, title: e.target.value })} placeholder={t('cashflow.agendaPlaceholder')} style={{ flex: 1, minWidth: 180 }} />
          <select value={noteForm.kind} onChange={e => setNoteForm({ ...noteForm, kind: e.target.value })} style={{ minWidth: 120 }}>
            <option value="receber">{t('cashflow.agendaKindIn')}</option>
            <option value="pagar">{t('cashflow.agendaKindOut')}</option>
            <option value="outro">{t('cashflow.agendaKindOther')}</option>
          </select>
          <button type="submit" className="btn-primary" style={{ padding: '8px 14px', fontSize: 12 }}>{t('cashflow.agendaSave')}</button>
        </form>
        {notes.filter(n => n.date >= todayStr).slice(0, 6).length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {notes.filter(n => n.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8).map(n => (
              <div key={n.id} style={{ background: '#f6f3ee', borderRadius: 10, padding: '8px 10px', fontSize: 12 }}>
                <strong>{fmtDate(n.date)}</strong> · {n.title}
                <button type="button" onClick={() => saveNotes(notes.filter(x => x.id !== n.id))} style={{ marginLeft: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>×</button>
              </div>
            ))}
          </div>
        )}
      </PortalSurface>

      {overdueEvents.length > 0 && (
        <>
          {overdueFaturas.length > 0 && (
            <PortalSurface title={t('cashflow.overdueInvoicesTitle')} style={{ marginBottom: 16, borderColor: 'rgba(239,68,68,0.35)' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {overdueFaturas.map((ev, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPayItem({ type: ev.kind === 'compra' ? 'compra' : 'fatura', id: ev.id, label: ev.label, amount: ev.amount, dueDate: ev.date, paid: false })}
                    style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: '10px 14px', minWidth: 150, textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)' }}>{t('cashflow.toReceiveOverdue')}</div>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>{fmtYen(ev.amount)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)' }}>{ev.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{t('common.expiredOn', { date: fmtDate(ev.date) })}</div>
                  <div style={{ fontSize: 10, color: 'var(--navy)', marginTop: 6, fontWeight: 700 }}>{t('payMark.tap')}</div>
                  </button>
                ))}
              </div>
            </PortalSurface>
          )}
          {overdueCompras.length > 0 && (
            <PortalSurface title={t('cashflow.overduePaymentsTitle')} style={{ marginBottom: 16, borderColor: 'rgba(239,68,68,0.35)' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {overdueCompras.map((ev, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPayItem({ type: 'compra', id: ev.id, label: ev.label, amount: ev.amount, dueDate: ev.date, paid: false })}
                    style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: '10px 14px', minWidth: 150, textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)' }}>{t('cashflow.toPayOverdueLabel')}</div>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>{fmtYen(ev.amount)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)' }}>{ev.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{t('common.expiredOn', { date: fmtDate(ev.date) })}</div>
                    <div style={{ fontSize: 10, color: 'var(--navy)', marginTop: 6, fontWeight: 700 }}>{t('payMark.tap')}</div>
                  </button>
                ))}
              </div>
            </PortalSurface>
          )}
        </>
      )}

      {upcomingEvents.length > 0 && (
        <PortalSurface title={t('cashflow.upcomingDue')} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {upcomingEvents.map((ev, i) => {
              const daysLeft = Math.ceil((new Date(ev.date + 'T12:00:00') - today) / (1000 * 60 * 60 * 24))
              return (
                <div key={i} onClick={() => setCurrentMonth(new Date(ev.date + 'T12:00:00'))}
                  style={{ background: ev.type === 'in' ? '#f0fdf4' : '#fffbeb', border: '1px solid', borderColor: ev.type === 'in' ? '#86efac' : '#fcd34d', borderRadius: 12, padding: '10px 14px', minWidth: 140, cursor: 'pointer' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: ev.type === 'in' ? 'var(--green)' : 'var(--amber)' }}>{ev.type === 'in' ? t('cashflow.inflow') : t('cashflow.outflow')} · {statusLabel[ev.status] || ev.status}</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtYen(ev.amount)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>{ev.label}</div>
                  <div style={{ fontSize: 11, color: daysLeft <= 3 ? 'var(--red)' : 'var(--text2)', fontWeight: daysLeft <= 3 ? 700 : 400, marginTop: 4 }}>
                    {fmtDate(ev.date)} · {daysLeft === 0 ? t('common.today') : daysLeft === 1 ? t('common.tomorrow') : t('common.inDays', { count: daysLeft })}
                  </div>
                </div>
              )
            })}
          </div>
        </PortalSurface>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <button onClick={()=>setCurrentMonth(new Date(year,month-1,1))} style={{ padding:'8px 16px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer', fontSize:16 }}>←</button>
        <div style={{ fontSize:16, fontWeight:700 }}>{currentMonth.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</div>
        <button onClick={()=>{ setCurrentMonth(new Date(year,month+1,1)); setSelectedDay(null); setPopup(null) }} style={{ padding:'8px 16px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer', fontSize:16 }}>→</button>
      </div>

      <div style={{ display:'flex', gap:12, marginBottom:12, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}><div style={{ width:10,height:10,borderRadius:2,background:'#86efac' }}/> {t('cashflow.inflows')}</div>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}><div style={{ width:10,height:10,borderRadius:2,background:'#fca5a5' }}/> {t('cashflow.outflows')}</div>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}><div style={{ width:10,height:10,borderRadius:2,background:'#fcd34d' }}/> {t('cashflow.toPayFuture')}</div>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}><div style={{ width:10,height:10,borderRadius:2,background:'#ef4444' }}/> {t('status.atrasado')}</div>
      </div>

      <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', marginBottom:20 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', background:'var(--navy)' }}>
          {(Array.isArray(calendarDays) ? calendarDays : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']).map(d=>(
            <div key={d} style={{ padding:'10px', textAlign:'center', fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.7)' }}>{d}</div>
          ))}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
          {Array.from({length:firstDay}).map((_,i)=>(
            <div key={'e'+i} style={{ minHeight:78, borderRight:'1px solid var(--border)', borderBottom:'1px solid var(--border)', background:'var(--bg3)' }}/>
          ))}
          {Array.from({length:daysInMonth}).map((_,i)=>{
            const day = i+1
            const dayEvents = eventsByDay[day]||[]
            const isToday = isCurrentMonth && day===today.getDate()
            const hasOverdue = dayEvents.some(e=>e.status==='atrasado')
            return (
              <div key={day} onClick={()=>{ if(dayEvents.length>0){ setSelectedDay(day); setPopup(dayEvents) }}}
                style={{ minHeight:78, borderRight:'1px solid var(--border)', borderBottom:'1px solid var(--border)',
                  background: hasOverdue ? 'rgba(239,68,68,0.08)' : isToday ? 'rgba(193,156,86,0.1)' : 'transparent',
                  cursor:dayEvents.length>0?'pointer':'default',
                  transition:'background 0.15s' }}>
                <div style={{ padding:'6px 8px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:isToday?800:400, color:isToday?'var(--gold)':'var(--text)',
                      width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                      background:isToday?'var(--navy)':'transparent' }}>{day}</span>
                    {dayEvents.length>0 && <span style={{ fontSize:10, color: hasOverdue ? 'var(--red)' : 'var(--text3)' }}>{dayEvents.length}</span>}
                  </div>
                  {dayEvents.slice(0,3).map((ev,ei)=>(
                    <div key={ei} style={{ fontSize:9, padding:'2px 4px', borderRadius:3, marginTop:2,
                      background: ev.status==='atrasado' ? '#fef2f2' : ev.type==='in' ? '#f0fdf4' : ev.type==='note' ? '#eef2ff' : '#fffbeb',
                      color: ev.status==='atrasado' ? '#dc2626' : ev.type==='in' ? '#16a34a' : ev.type==='note' ? '#3730a3' : '#b45309',
                      fontWeight:600, lineHeight:1.3 }}>
                      {ev.type==='note' ? ev.label : `${ev.type==='in'?'↑':'↓'} ${Math.round(ev.amount/1000)}k`}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {popup && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={()=>setPopup(null)}>
          <div style={{ background:'var(--bg2)', borderRadius:20, padding:'24px', width:'100%', maxWidth:420, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:16 }}>
              {currentMonth.toLocaleDateString('pt-BR',{month:'long'})} {selectedDay}, {year}
            </div>
            {popup.map((ev,i)=>(
              <div
                key={i}
                role={(ev.kind === 'fatura' || ev.kind === 'compra') ? 'button' : undefined}
                onClick={() => {
                  if (ev.kind !== 'fatura' && ev.kind !== 'compra') return
                  setPopup(null)
                  setPayItem({ type: ev.kind, id: ev.id, label: ev.label, amount: ev.amount, dueDate: ev.date, paid: false })
                }}
                style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'12px 0', borderBottom:'1px solid var(--border)', cursor: (ev.kind === 'fatura' || ev.kind === 'compra') ? 'pointer' : 'default' }}
              >
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                    <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20,
                      background:ev.type==='in'?'#f0fdf4':ev.status==='atrasado'?'#fef2f2':'#fffbeb',
                      color:ev.type==='in'?'var(--green)':ev.status==='atrasado'?'var(--red)':'var(--amber)' }}>
                      {ev.type==='in'?t('cashflow.receive'):ev.type==='note'?t('cashflow.agendaNote'):t('cashflow.pay')}
                    </span>
                    <span style={{ fontSize:10, fontWeight:700, color: ev.status==='atrasado' ? 'var(--red)' : 'var(--text3)' }}>
                      {statusLabel[ev.status] || ev.status}
                    </span>
                  </div>
                  <div style={{ fontSize:13, fontWeight:600 }}>{ev.label}</div>
                  <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>{ev.note}</div>
                  {ev.docUrl && <a href={ev.docUrl} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--blue)', marginTop:4, display:'inline-block' }}>{t('cashflow.viewDocument')}</a>}
                </div>
                <div style={{ fontSize:16, fontWeight:800, color:ev.type==='in'?'var(--green)':ev.type==='note'?'var(--navy)':'var(--red)' }}>
                  {ev.type==='note' ? '' : `${ev.type==='in'?'+':'-'}${fmtYen(ev.amount)}`}
                </div>
              </div>
            ))}
            <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, marginTop:12, paddingTop:12, borderTop:'2px solid var(--border)' }}>
              <span>{t('cashflow.netDay')}</span>
              <span style={{ color:popup.reduce((a,e)=>a+(e.type==='in'?e.amount:-e.amount),0)>=0?'var(--green)':'var(--red)' }}>
                {fmtYen(popup.reduce((a,e)=>a+(e.type==='in'?e.amount:-e.amount),0))}
              </span>
            </div>
            <button onClick={()=>setPopup(null)} style={{ width:'100%', marginTop:16, padding:'12px', borderRadius:12, border:'1px solid var(--border)', background:'transparent', cursor:'pointer', fontSize:13 }}>{t('common.close')}</button>
          </div>
        </div>
      )}
      {payItem && <MarkPaidPopup item={payItem} onClose={() => setPayItem(null)} onSaved={load} />}
    </div>
  )
}
