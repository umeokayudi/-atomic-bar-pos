import { fmtYen } from './utils'
import { useI18n } from '../lib/i18n'

/** One bar order in a popup: each item with its unit price and line total, then the order total. */
export default function OrderDetailPopup({ pedido, date, onClose }) {
  const { t } = useI18n()
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
        </div>
        <div className="pay-pop-actions" style={{ gridTemplateColumns: '1fr' }}>
          <button type="button" className="btn-primary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  )
}
