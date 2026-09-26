import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate, Spinner, Empty, filterSupplierVendas, RowActions } from './utils'
import { AdminPage, PortalSurface } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'

const TAX_RATE = 0.10

export default function RyoshushoTab() {
  const { t } = useI18n()
  const [bars,      setBars]      = useState([])
  const [vendas,    setVendas]    = useState([])
  const [history,   setHistory]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [generating,setGenerating]= useState(false)
  const [editRyo, setEditRyo] = useState(null)
  const [ryoForm, setRyoForm] = useState({})

  const [barId,     setBarId]     = useState('')
  const [numero,    setNumero]    = useState('')
  const [dataEmis,  setDataEmis]  = useState(new Date().toISOString().slice(0,10))
  const [periodoIni,setPeriodoIni]= useState('')
  const [periodoFim,setPeriodoFim]= useState('')
  const [emitNome,  setEmitNome]  = useState('JBM')
  const [emitReg,   setEmitReg]   = useState('T1234567890123')
  const [emitEnd,   setEmitEnd]   = useState('')
  const [emitTel,   setEmitTel]   = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [bRes, vRes, hRes] = await Promise.all([
        supabase.from('bars').select('*').order('nome'),
        supabase.from('vendas').select('*, vendas_itens(*, produtos(*))').order('data'),
        supabase.from('ryoshusho').select('*, bars(nome)').order('criado_em', { ascending: false }).limit(50),
      ])
      const b = bRes.data || []
      const v = vRes.data || []
      const h = hRes.data || []
      setBars(b)
      setVendas(filterSupplierVendas(v))
      setHistory(h)
      if (b.length > 0 && !barId) setBarId(b[0].id)
      const y = new Date().getFullYear()
      const m = String(new Date().getMonth() + 1).padStart(2, '0')
      const n = String(h.length + 1).padStart(3, '0')
      setNumero('RY-' + y + m + '-' + n)
    } catch(e) {
      console.error('loadAll error:', e)
    } finally {
      setLoading(false)
    }
  }

  function getItems() {
    if (!barId || !periodoIni || !periodoFim) return []
    return vendas
      .filter(v => v.bar_id === barId && v.data >= periodoIni && v.data <= periodoFim)
      .flatMap(v => (v.vendas_itens || []).map(it => ({
        nome: it.produtos?.nome || '?',
        qtd: it.qtd,
        preco: it.preco_unitario || it.produtos?.preco_venda || 0
      })))
      .reduce((acc, it) => {
        const ex = acc.find(x => x.nome === it.nome)
        if (ex) { ex.qtd += it.qtd }
        else acc.push({...it})
        return acc
      }, [])
  }

  const items = getItems()
  // Preços cadastrados são 税込 (zeikomi)
  // Na nota: mostrar 税別 (zeibetsu) = preco / 1.1
  const totalZeikomi = items.reduce((a, it) => a + it.preco * it.qtd, 0)
  const subtotal = Math.round(totalZeikomi / 1.1)
  const tax = totalZeikomi - subtotal
  const total = totalZeikomi
  const bar = bars.find(b => b.id === barId)

  async function saveAndDownload() {
    if (!barId || !periodoIni || !periodoFim) return alert(t('ryoshusho.selectBarPeriod'))
    if (items.length === 0) return alert(t('ryoshusho.noSalesFound'))
    setGenerating(true)

    try {
      await supabase.from('ryoshusho').insert({
        numero, bar_id: barId,
        data_emissao: dataEmis,
        periodo_inicio: periodoIni,
        periodo_fim: periodoFim,
        subtotal, consumo_tax: tax, total,
        emitente_nome: emitNome,
        emitente_endereco: emitEnd,
        emitente_tel: emitTel,
        emitente_registro: emitReg,
        itens: items
      })
    } catch(e) {}

    const rows = items.map(it =>
      '<tr><td>' + it.nome + '</td><td style="text-align:center">' + it.qtd +
      '</td><td style="text-align:right">&#165;' + Number(Math.round(it.preco / 1.1)).toLocaleString('ja-JP') +
      '</td><td style="text-align:right">&#165;' + Number(Math.round(it.preco / 1.1 * it.qtd)).toLocaleString('ja-JP') + '</td></tr>'
    ).join('')

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + numero + '</title>' +
      '<style>' +
      'body{font-family:serif;padding:40px;max-width:680px;margin:0 auto;color:#111}' +
      'h1{text-align:center;font-size:26px;letter-spacing:10px;margin-bottom:24px}' +
      '.row{display:flex;justify-content:space-between;margin-bottom:16px;font-size:13px}' +
      '.client{font-size:18px;font-weight:bold;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:14px}' +
      '.box{border:2px solid #111;padding:14px;text-align:center;margin:16px 0;font-size:20px;font-weight:bold}' +
      'table{width:100%;border-collapse:collapse;margin:16px 0}' +
      'th{background:#001028;color:white;padding:8px;text-align:left;font-size:12px}' +
      'td{padding:7px 8px;border-bottom:1px solid #ddd;font-size:13px}' +
      '.totals td{font-size:13px;padding:5px 8px}' +
      '.footer{text-align:center;margin-top:24px;font-size:12px;color:#666}' +
      '@page{size:A4;margin:15mm}' +
      '@media print{body{padding:0}}' +
      '</style></head><body>' +
      '<h1>&#9領&#12288;収&#12288;書</h1>' +
      '<div class="row"><span>No. <strong>' + numero + '</strong></span>' +
      '<span>&#30330;&#34892;&#26085;&#65306;<strong>' + new Date(dataEmis + 'T12:00').toLocaleDateString('ja-JP') + '</strong></span></div>' +
      '<div class="client">' + (bar ? bar.nome : '') + '&#12288;&#24481;&#20013;</div>' +
      (periodoIni ? '<div style="font-size:12px;color:#666;margin-bottom:14px">&#23550;&#35937;&#26399;&#38291;&#65306;' + periodoIni + '&#12288;&#65374;&#12288;' + periodoFim + '</div>' : '') +
      '<div class="box">&#21512;&#35336;&#37329;&#39069;&#12288;&#165; ' + Number(total).toLocaleString('ja-JP') + '&#12288;&#65288;&#31税;&#36796;&#65289;</div>' +
      '<table><thead><tr><th>&#21697;&#30446;</th><th>&#25968;&#37327;</th><th>&#21333;&#20385;</th><th>&#37329;&#39069;</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<table class="totals"><tr><td>&#23567;&#35336;</td><td style="text-align:right">&#165;' + Number(subtotal).toLocaleString('ja-JP') + '</td></tr>' +
      '<tr><td>&#28040;&#36027;&#31290;&#65288;10%&#65289;</td><td style="text-align:right">&#165;' + Number(tax).toLocaleString('ja-JP') + '</td></tr>' +
      '<tr><td><strong>&#21512;&#35336;</strong></td><td style="text-align:right"><strong>&#165;' + Number(total).toLocaleString('ja-JP') + '</strong></td></tr></table>' +
      '<div class="footer">&#19978;&#35352;&#12398;&#37329;&#39069;&#12434;&#27491;&#12395;&#9領;&#21463;&#12356;&#12383;&#12375;&#12414;&#12375;&#12383;<br><br>' +
      emitNome + (emitEnd ? '&#12288;' + emitEnd : '') + (emitTel ? '&#12288;TEL:' + emitTel : '') +
      '</div></body></html>'

    const printWin = window.open('', '_blank', 'width=800,height=600')
    printWin.document.write(html)
    printWin.document.close()
    printWin.focus()
    setTimeout(() => {
      printWin.print()
    }, 500)

    setGenerating(false)
    loadAll()
  }

  async function saveEdit() {
    if (!editRyo) return
    await supabase.from('ryoshusho').update({
      numero: ryoForm.numero,
      periodo_inicio: ryoForm.periodo_inicio,
      periodo_fim: ryoForm.periodo_fim,
      total: +ryoForm.total,
      subtotal: Math.round(+ryoForm.total / 1.1),
      consumo_tax: +ryoForm.total - Math.round(+ryoForm.total / 1.1),
      data_emissao: ryoForm.data_emissao,
    }).eq('id', editRyo.id)
    setEditRyo(null)
    loadAll()
  }

  if (loading) return <Spinner text={t('common.loading')} />

  return (
    <AdminPage title={t('nav.ryoshusho')} subtitle={t('ryoshusho.subtitle')}>
      <PortalSurface title={t('ryoshusho.issueTitle')}>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
          <div>
            <label className="form-label">{t('ryoshusho.barClient')}</label>
            <select value={barId} onChange={e => setBarId(e.target.value)}>
              {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">{t('ryoshusho.issueDate')}</label>
            <input type="date" value={dataEmis} onChange={e => setDataEmis(e.target.value)} />
          </div>
          <div>
            <label className="form-label">{t('ryoshusho.docNumber')}</label>
            <input type="text" value={numero} onChange={e => setNumero(e.target.value)} />
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
          <div>
            <label className="form-label">{t('ryoshusho.periodStart')}</label>
            <input type="date" value={periodoIni} onChange={e => setPeriodoIni(e.target.value)} />
          </div>
          <div>
            <label className="form-label">{t('ryoshusho.periodEnd')}</label>
            <input type="date" value={periodoFim} onChange={e => setPeriodoFim(e.target.value)} />
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:12 }}>
          <div>
            <label className="form-label">{t('ryoshusho.companyName')}</label>
            <input type="text" value={emitNome} onChange={e => setEmitNome(e.target.value)} />
          </div>
          <div>
            <label className="form-label">{t('ryoshusho.regNumber')}</label>
            <input type="text" value={emitReg} onChange={e => setEmitReg(e.target.value)} />
          </div>
          <div>
            <label className="form-label">{t('ryoshusho.address')}</label>
            <input type="text" value={emitEnd} onChange={e => setEmitEnd(e.target.value)} />
          </div>
          <div>
            <label className="form-label">{t('common.phone')}</label>
            <input type="text" value={emitTel} onChange={e => setEmitTel(e.target.value)} />
          </div>
        </div>

        {periodoIni && periodoFim && (
          <div style={{ background:'var(--bg3)', borderRadius:8, padding:'12px 14px', marginBottom:12, fontSize:13 }}>
            <div style={{ fontWeight:600, marginBottom:8, fontSize:11, color:'var(--text2)', textTransform:'uppercase' }}>
              {t('ryoshusho.periodItems')}
            </div>
            {items.length === 0
              ? <span style={{ color:'var(--text2)' }}>{t('ryoshusho.noSalesPeriod')}</span>
              : items.map((it, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span>{it.nome} &times; {it.qtd}</span>
                  <span>{fmtYen(Math.round(it.preco / 1.1) * it.qtd)}</span>
                </div>
              ))
            }
            {items.length > 0 && (
              <div style={{ borderTop:'0.5px solid var(--border)', marginTop:8, paddingTop:8, fontWeight:700 }}>
                {t('ryoshusho.totalWithTax', { amount: fmtYen(total) })}
              </div>
            )}
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button className="btn-primary" onClick={saveAndDownload} disabled={generating}>
            {generating ? <><span className="spinner"/> {t('common.saving')}</> : t('ryoshusho.saveAndDownload')}
          </button>
        </div>
      </PortalSurface>

      <PortalSurface title={t('ryoshusho.issuedReceipts')}>
        {history.length === 0
          ? <Empty text={t('ryoshusho.noReceipts')} />
          : (
            <table>
              <thead>
                <tr><th>No.</th><th>{t('common.bar')}</th><th>{t('common.date')}</th><th>{t('ryoshusho.colPeriod')}</th><th>{t('common.total')}</th><th></th></tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight:600, fontFamily:'monospace', fontSize:12 }}>{r.numero}</td>
                    <td>{r.bars?.nome || '—'}</td>
                    <td>{fmtDate(r.data_emissao)}</td>
                    <td style={{ fontSize:12, color:'var(--text2)' }}>
                      {r.periodo_inicio && r.periodo_fim
                        ? fmtDate(r.periodo_inicio) + ' ~ ' + fmtDate(r.periodo_fim)
                        : '—'}
                    </td>
                    <td style={{ fontWeight:700 }}>{fmtYen(r.total)}</td>
                    <td>
                      <RowActions
                        onEdit={() => { setEditRyo(r); setRyoForm({ numero: r.numero, periodo_inicio: r.periodo_inicio, periodo_fim: r.periodo_fim, total: r.total, data_emissao: r.data_emissao }) }}
                        onDelete={async()=>{ if(!confirm(t('ryoshusho.confirmDelete')))return; await supabase.from('ryoshusho').delete().eq('id',r.id); setHistory(prev=>prev.filter(x=>x.id!==r.id)) }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </PortalSurface>

      {editRyo && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--bg2)', borderRadius:16, padding:24, width:'100%', maxWidth:420 }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:16 }}>{t('report.editRyoshusho')}</div>
            <div style={{ display:'grid', gap:10, marginBottom:16 }}>
              <div><label className="form-label">{t('common.number')}</label><input value={ryoForm.numero||''} onChange={e=>setRyoForm(f=>({...f,numero:e.target.value}))} /></div>
              <div><label className="form-label">{t('ryoshusho.issueLabel')}</label><input type="date" value={ryoForm.data_emissao||''} onChange={e=>setRyoForm(f=>({...f,data_emissao:e.target.value}))} /></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div><label className="form-label">{t('common.start')}</label><input type="date" value={ryoForm.periodo_inicio||''} onChange={e=>setRyoForm(f=>({...f,periodo_inicio:e.target.value}))} /></div>
                <div><label className="form-label">{t('common.end')}</label><input type="date" value={ryoForm.periodo_fim||''} onChange={e=>setRyoForm(f=>({...f,periodo_fim:e.target.value}))} /></div>
              </div>
              <div><label className="form-label">{t('common.total')} (¥)</label><input type="number" value={ryoForm.total||''} onChange={e=>setRyoForm(f=>({...f,total:e.target.value}))} /></div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={()=>setEditRyo(null)} style={{ flex:1, padding:10, borderRadius:10, border:'1px solid var(--border)', background:'transparent', cursor:'pointer' }}>{t('common.cancel')}</button>
              <button className="btn-gold" onClick={saveEdit} style={{ flex:2, padding:10, borderRadius:10 }}>{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  )
}
