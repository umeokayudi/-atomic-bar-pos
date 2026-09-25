import { fmtYen } from './utils'
import { billChecks } from '../lib/billMatch'
import { useI18n } from '../lib/i18n'

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

export default function BillMatch({ orders = [], notes = [], invoices = [], monthKey = '' }) {
  const { t } = useI18n()
  const { rows } = billChecks({ orders, notes, invoices, monthKey })
  const visible = rows.filter(r => r.status !== 'empty')
  if (!visible.length) return null
  return (
    <div className="bill-stack">
      {visible.map(row => (
        <section key={row.invoiceId || `${row.start}-${row.end}`} className={`bill-match is-${row.status}`}>
          <h3>{t('portal.bill.title')}</h3>
          <p className="desk-note">{row.start && row.end ? `${row.start} → ${row.end}` : ''}</p>
          <div className="bill-match-row"><span>{t('portal.bill.orders')}</span><b>{money(row.orders)}</b></div>
          <div className="bill-match-row"><span>{t('portal.bill.notes')}</span><b>{money(row.notes)}</b></div>
          <div className="bill-match-row"><span>{t('portal.bill.invoice')}</span><b>{row.invoice == null ? t('portal.bill.noInvoice') : money(row.invoice)}</b></div>
          <p className="bill-match-verdict">
            {row.status === 'match' && (row.invoice == null ? t('portal.bill.matchPending') : t('portal.bill.match'))}
            {row.status === 'waiting' && t('portal.bill.waiting')}
            {row.status === 'off' && t('portal.bill.off', { amount: money(Math.abs(row.delta)) })}
          </p>
        </section>
      ))}
    </div>
  )
}
