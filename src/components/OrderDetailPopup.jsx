import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtYen, fmtDate } from './utils'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { pathForTab } from '../lib/navigation'
import { invoicePeriod } from '../lib/money'

/** An order rebuilt from other records (script/AI/fix), not placed by the bar. */
export function isRebuiltOrder(p) {
  return /reconstru|rebuilt|rebuild|recreated|\bfix\b|movido de|\bAI\b/i.test(`${p?.origem || ''} ${p?.obs || ''}`)
}

/** Sale and invoice linked to one order: the automatic sale names the order id; the invoice covers its bar and date. */
function useOrderLinks(pedido, date) {
  const [links, setLinks] = useState(null)
  useEffect(() => {
    let alive = true
    const id8 = String(pedido?.id || '').slice(0, 8)
    const day = String(date || pedido?.data_entrega_prevista || pedido?.data_pedido || '').slice(0, 10)
    Promise.all([
      supabase.from('vendas').select('id,data,total,obs').eq('bar_id', pedido.bar_id).ilike('obs', `%${id8}%`).limit(3),
      supabase.from('faturas').select('id,total,valor,pago,status,periodo_inicio,periodo_fim,data_emissao,data_vencimento').eq('bar_id', pedido.bar_id),
    ]).then(([v, f]) => {
      if (!alive) return
      const fatura = (f.data || []).find(x => { const pr = invoicePeriod(x); return day && pr.start <= day && day <= pr.end }) || null
      setLinks({ vendas: v.data || [], fatura })
    }).catch(() => alive && setLinks({ vendas: [], fatura: null }))
    return () => { alive = false }
  }, [pedido?.id, pedido?.bar_id, date]) // eslint-disable-line react-hooks/exhaustive-deps
  return links
}

/** One bar order in a popup: each item with its unit price and line total, then the order total. */
export default function OrderDetailPopup({ pedido, date, onClose }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const links = useOrderLinks(pedido, date)
  const go = tab => { onClose?.(); navigate(pathForTab('hq', tab)) }
  const items = (pedido.pedidos_itens || [])
    .map(it => {
      const qtd = +it.qtd || 0
      const unit = +it.preco_unitario || 0
      return { id: it.id, nome: it.produtos?.nome || '?', qtd, unit, total: Math.round(qtd * unit) }
    })
    .sort((a, b) => b.total - a.total)
  const sum = items.reduce((a, it) => a + it.total, 0)
  const units = items.reduce((a, it) => a + it.qtd, 0)
  const estimated = Math.round(+pedido.total_estimado || 0)

  return (
    <div className="pay-pop-back" onClick={onClose} role="presentation">
      <div className="pay-pop doc-view" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="pay-pop-kicker">{t('orderDetail.kicker')}</div>
        <div className="pay-pop-title">{pedido.bars?.nome} — {date}</div>
        {pedido.obs && <div className="doc-view-muted" style={{ marginTop: 4 }}>{pedido.obs}</div>}
        {isRebuiltOrder(pedido) && <div className="doc-view-muted" style={{ marginTop: 4, color: 'var(--amber)', fontWeight: 700 }}>{t('orderLinks.rebuilt')}</div>}
        <div className="doc-view-body">
          <table className="doc-view-items">
            <thead>
              <tr><th>{t('common.product')}</th><th>{t('common.qty')}</th><th>{t('docView.unit')}</th><th>{t('docView.amount')}</th></tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>{it.nome}</td>
                  <td>{it.qtd}</td>
                  <td>{fmtYen(it.unit)}</td>
                  <td>{fmtYen(it.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t('orderDetail.total', { count: items.length })}</th>
                <th>{units}</th>
                <th />
                <th>{fmtYen(sum)}</th>
              </tr>
            </tfoot>
          </table>
          {estimated > 0 && estimated !== sum && (
            <div className="doc-view-muted" style={{ marginTop: 10 }}>{t('orderDetail.orderTotal', { amount: fmtYen(estimated) })}</div>
          )}
          <div className="doc-view-muted" style={{ marginTop: 12, display: 'grid', gap: 4 }}>
            <b>{t('orderLinks.title')}</b>
            {!links ? <span>{t('common.loading')}</span> : (
              <>
                {links.vendas.length
                  ? links.vendas.map(v => <button key={v.id} type="button" className="ui-link" onClick={() => go('sales')} style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-text)', textDecoration: 'underline' }}>{t('orderLinks.sale', { date: fmtDate(v.data), amount: fmtYen(v.total) })}</button>)
                  : <span>{t('orderLinks.noSale')}</span>}
                {links.fatura
                  ? <button type="button" onClick={() => go('faturas')} style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-text)', textDecoration: 'underline' }}>{t('orderLinks.invoice', { from: fmtDate(invoicePeriod(links.fatura).start), to: fmtDate(invoicePeriod(links.fatura).end), amount: fmtYen(links.fatura.total || links.fatura.valor || 0) })}</button>
                  : <span>{t('orderLinks.noInvoice')}</span>}
                <button type="button" onClick={() => go('purchases')} style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-text)', textDecoration: 'underline' }}>{t('orderLinks.purchases')}</button>
              </>
            )}
          </div>
        </div>
        <div className="pay-pop-actions" style={{ gridTemplateColumns: '1fr' }}>
          <button type="button" className="btn-primary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  )
}
