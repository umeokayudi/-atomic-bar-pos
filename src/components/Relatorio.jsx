import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, monthKey, monthLabel, fmtDate, Spinner, Empty, filterSupplierVendas, saleMonthKey, compraMonthKey, RowActions } from './utils'
import { aggregateComprasItens } from '../lib/marginCost'
import { barCreditsForMonth, barCreditsList } from '../lib/barCredits'
import { aReceberForMonth, faturasAbertasMes } from '../lib/faturasMonth'
import { ryoshushoForMonth, ryoshushoMonthShare, ryoshushoPeriodSplit } from '../lib/reportPeriod'
import { loadAllCompras } from '../lib/loadCompras'
import { loadDashboard } from '../lib/loadDashboard'
import ComprasNotasSection from './ComprasNotasSection'
import { AdminPage, PortalKpi, PortalSurface } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'

export default function RelatorioTab() {
  const { t } = useI18n()
  const [bars, setBars] = useState([])
  const [compras, setCompras] = useState([])
  const [vendas, setVendas] = useState([])
  const [ryoshusho, setRyoshusho] = useState([])
  const [faturas, setFaturas] = useState([])
  const [dashByMonth, setDashByMonth] = useState({})
  const [dashMonths, setDashMonths] = useState([])
  const [loading, setLoading] = useState(true)
  const [selMonth, setSelMonth] = useState('')
  const [editRyo, setEditRyo] = useState(null)
  const [ryoForm, setRyoForm] = useState({ numero: '', periodo_inicio: '', periodo_fim: '', total: '' })

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [bR, vR, rR, fR, cData, dash] = await Promise.all([
      supabase.from('bars').select('id, nome, cor'),
      supabase.from('vendas').select('id, data, data_venda, total, bar_id, obs, origem, cast_id'),
      supabase.from('ryoshusho').select('*'),
      supabase.from('faturas').select('*, bars(nome)').order('data_vencimento', { ascending: false }),
      loadAllCompras(),
      loadDashboard().catch(() => null),
    ])
    setBars(bR.data || [])
    setCompras(cData || [])
    setVendas(filterSupplierVendas(vR.data || []))
    setRyoshusho(rR.data || [])
    setFaturas(fR.data || [])
    setDashByMonth(dash?.byMonth || {})
    setDashMonths(dash?.months || [])

    const months = [...new Set([
      ...(dash?.months || []),
      ...(cData || []).map(compraMonthKey),
      ...(vR.data || []).map(v => monthKey(v.data)),
    ])].filter(Boolean).sort().reverse()

    let initialMonth = months[0] || ''
    try {
      const saved = sessionStorage.getItem('relatorioMonth')
      if (saved && months.includes(saved)) initialMonth = saved
      sessionStorage.removeItem('relatorioMonth')
    } catch {}
    if (initialMonth) setSelMonth(initialMonth)
    setLoading(false)
  }

  const allMonths = [...new Set([
    ...dashMonths,
    ...compras.map(compraMonthKey),
    ...vendas.map(v => monthKey(v.data)),
  ])].filter(Boolean).sort().reverse()

  const dash = dashByMonth[selMonth] || {}
  const comprasMes = compras.filter(c => compraMonthKey(c) === selMonth)
  const vendasMes = vendas.filter(v => saleMonthKey(v) === selMonth)
  const ryoMes = ryoshushoForMonth(ryoshusho, selMonth)

  const custoCompras = dash.compras ?? comprasMes.reduce((a, c) => a + (+c.total_real || 0), 0)
  const descontoTotal = comprasMes.reduce((a, c) => a + (+c.desconto_pontos || 0), 0)
  const creditoBar = barCreditsForMonth(selMonth)
  const creditosBar = barCreditsList(selMonth)

  const receitaTotal = dash.receita ?? vendasMes.reduce((a, v) => a + (+v.total || 0), 0)
  const faturamento = dash.faturamento ?? receitaTotal
  const lucroTotal = dash.lucroProjetado ?? dash.lucro ?? (receitaTotal - custoCompras)
  const margemGeral = dash.margem ?? (faturamento > 0 ? Math.round(lucroTotal / faturamento * 100) : 0)
  const aReceber = dash.aReceber ?? aReceberForMonth(faturas, selMonth)
  const faturasMes = faturasAbertasMes(faturas, selMonth)
  const ryoTotal = ryoMes.reduce((a, r) => a + ryoshushoMonthShare(r, selMonth), 0)

  const porProdutoComprado = aggregateComprasItens(comprasMes)

  const vendasDetalhe = vendasMes
    .map(v => {
      const bar = bars.find(b => b.id === v.bar_id)
      return {
        id: v.id,
        data: v.data,
        barNome: bar?.nome || '—',
        barCor: bar?.cor,
        receita: +v.total || 0,
        obs: v.obs,
      }
    })
    .sort((a, b) => String(a.data).localeCompare(String(b.data)))

  if (loading) return <Spinner text={t('report.loading')} />

  async function saveRyoshusho() {
    if (!editRyo) return
    await supabase.from('ryoshusho').update({
      numero: ryoForm.numero,
      periodo_inicio: ryoForm.periodo_inicio,
      periodo_fim: ryoForm.periodo_fim,
      total: +ryoForm.total,
      subtotal: Math.round(+ryoForm.total / 1.1),
      consumo_tax: +ryoForm.total - Math.round(+ryoForm.total / 1.1),
    }).eq('id', editRyo.id)
    setEditRyo(null)
    loadAll()
  }

  async function deleteRyoshusho(r) {
    if (!confirm(t('report.confirmDeleteRyoshusho', { num: r.numero }))) return
    await supabase.from('ryoshusho').delete().eq('id', r.id)
    loadAll()
  }

  return (
    <AdminPage
      title={t('nav.report')}
      actions={
        <>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('report.monthLabel')}</span>
          <select value={selMonth} onChange={e => setSelMonth(e.target.value)} style={{ width: 'auto' }}>
            {allMonths.length === 0 && <option>{t('report.noDataMonth')}</option>}
            {allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <PortalKpi label={t('report.purchasesNotes')} value={fmtYen(custoCompras)} color="var(--red)"
          sub={dash.comprasEstimadas ? t('report.purchasesSubEst', { count: comprasMes.length }) : t('report.purchasesSub', { count: comprasMes.length })} />
        <PortalKpi label={t('report.billing')} value={fmtYen(faturamento)} color="var(--navy)"
          sub={t('report.billingSub', { count: vendasMes.length, type: dash.comprasEstimadas ? t('report.billingTypeOrders') : t('report.billingTypeCharge') })} />
        <PortalKpi label={t('report.projectedProfit')} value={fmtYen(lucroTotal)} color="var(--green)"
          sub={t('report.profitSub', { margin: margemGeral })} />
        <PortalKpi label={t('report.toReceive')} value={fmtYen(aReceber)} color={aReceber > 0 ? 'var(--amber)' : 'var(--green)'}
          sub={faturasMes.length ? t('report.openInvoices', { count: faturasMes.length }) : t('report.nothingPending')} />
      </div>

      {(creditoBar > 0 || descontoTotal > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: creditoBar > 0 && descontoTotal > 0 ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 18 }}>
          {creditoBar > 0 && (
            <PortalKpi label={t('report.barDirectPay')} value={fmtYen(creditoBar)} color="var(--navy)"
              sub={t('report.barDirectPaySub')} />
          )}
          {descontoTotal > 0 && (
            <PortalKpi label={t('report.points')} value={fmtYen(descontoTotal)} color="var(--gold)"
              sub={t('report.pointsSub')} />
          )}
        </div>
      )}

      <ComprasNotasSection
        comprasMes={comprasMes}
        totalCompras={custoCompras}
        creditoBar={creditoBar}
        creditosBar={creditosBar}
        onChanged={loadAll}
      />

      <PortalSurface title={t('report.monthSales')}>
        {vendasDetalhe.length === 0 ? <Empty text={t('report.noSalesMonth')} /> : (
          <table>
            <thead>
              <tr><th>{t('common.date')}</th><th>{t('common.bar')}</th><th>{t('common.obs')}</th><th style={{ textAlign: 'right' }}>{t('common.revenue')}</th></tr>
            </thead>
            <tbody>
              {vendasDetalhe.map(v => (
                <tr key={v.id}>
                  <td>{fmtDate(v.data)}</td>
                  <td style={{ color: v.barCor || 'var(--navy)', fontWeight: 600 }}>{v.barNome}</td>
                  <td style={{ fontSize: 11, color: 'var(--text2)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.obs || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtYen(v.receita)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ fontWeight: 700 }}>{t('common.total')} ({vendasDetalhe.length})</td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--navy)' }}>{fmtYen(receitaTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </PortalSurface>

      <PortalSurface title={t('report.purchasedItems')}>
        {porProdutoComprado.length === 0 ? <Empty text={t('report.noItems')} /> : (
          <table>
            <thead>
              <tr><th>{t('common.product')}</th><th style={{ textAlign: 'right' }}>{t('common.qty')}</th><th style={{ textAlign: 'right' }}>{t('common.total')}</th><th style={{ textAlign: 'right' }}>{t('report.avgPrice')}</th></tr>
            </thead>
            <tbody>
              {porProdutoComprado.map(p => (
                <tr key={p.nome}>
                  <td>{p.nome}</td>
                  <td style={{ textAlign: 'right' }}>{p.qtd}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>{fmtYen(p.custoTotal)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{p.qtd ? fmtYen(Math.round(p.custoTotal / p.qtd)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PortalSurface>

      <PortalSurface title={t('report.ryoshushoSection', { month: monthLabel(selMonth) })}>
        {ryoMes.length === 0 ? (
          <Empty text={t('report.noRyoshusho', { month: monthLabel(selMonth) })} />
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12, fontSize: 13 }}>
              <span>{t('report.totalReceipts', { amount: fmtYen(ryoTotal) })}</span>
              <span>{t('report.billing')}: <strong>{fmtYen(faturamento)}</strong></span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text2)', margin: '0 0 12px', lineHeight: 1.55 }}>
              {t('report.ryoshushoHint')}
            </p>
            {ryoMes.map(r => {
              const split = ryoshushoPeriodSplit(r, selMonth)
              const bar = bars.find(b => b.id === r.bar_id)
              return (
                <div key={r.id} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, fontWeight: 700 }}>
                    <span>{bar?.nome || '—'} · {r.numero || '—'}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--gold)' }}>{fmtYen(split.share)}</span>
                      <RowActions
                        onEdit={() => { setEditRyo(r); setRyoForm({ numero: r.numero || '', periodo_inicio: r.periodo_inicio || '', periodo_fim: r.periodo_fim || '', total: r.total || '' }) }}
                        onDelete={() => deleteRyoshusho(r)}
                      />
                    </span>
                  </div>
                  <div style={{ color: 'var(--text2)', marginTop: 2 }}>
                    {fmtDate(r.periodo_inicio)} – {fmtDate(r.periodo_fim)}
                    {split.multiMonth && split.share !== split.total && (
                      <> · {t('report.receiptTotal', { amount: fmtYen(split.total), overlap: split.overlapDays, total: split.periodDays })}</>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </PortalSurface>

      {editRyo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg2)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{t('report.editRyoshusho')}</div>
            <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
              <div><label className="form-label">{t('common.number')}</label><input value={ryoForm.numero} onChange={e => setRyoForm(f => ({ ...f, numero: e.target.value }))} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label className="form-label">{t('common.start')}</label><input type="date" value={ryoForm.periodo_inicio} onChange={e => setRyoForm(f => ({ ...f, periodo_inicio: e.target.value }))} /></div>
                <div><label className="form-label">{t('common.end')}</label><input type="date" value={ryoForm.periodo_fim} onChange={e => setRyoForm(f => ({ ...f, periodo_fim: e.target.value }))} /></div>
              </div>
              <div><label className="form-label">{t('common.total')} (¥)</label><input type="number" value={ryoForm.total} onChange={e => setRyoForm(f => ({ ...f, total: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditRyo(null)} style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={saveRyoshusho} style={{ flex: 2, padding: 10, borderRadius: 10 }}>{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  )
}
