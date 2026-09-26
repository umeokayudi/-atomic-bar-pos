import { fmtYen } from './utils'
import { billChecks } from '../lib/billMatch'
import { useI18n } from '../lib/i18n'

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

export default function BillMatch({ orders = [], notes = [], invoices = [], monthKey = '', variant = 'full' }) {
  const { t } = useI18n()
  const slip = variant === 'slip'
  const { rows } = billChecks({ orders, notes, invoices, monthKey })
  const visible = rows.filter(r => (slip ? r.invoice != null : r.status !== 'empty'))
  if (!visible.length) return null
  return (
    <div className="bill-stack">
      {visible.map(row => {
        const tone = slip ? (row.open > 0 ? 'off' : 'match') : row.status
        return (
          <section key={row.invoiceId || `${row.start}-${row.end}`} className={`bill-match is-${tone}`}>
            <h3>{slip ? t('portal.bill.slipTitle') : t('portal.bill.title')}</h3>
            <p className="desk-note">{row.start && row.end ? `${row.start} → ${row.end}` : ''}</p>
            {!slip && <div className="bill-match-row"><span>{t('portal.bill.orders')}</span><b>{money(row.orders)}</b></div>}
            {!slip && <div className="bill-match-row"><span>{t('portal.bill.notes')}</span><b>{money(row.notes)}</b></div>}
            <div className="bill-match-row"><span>{t('portal.bill.invoice')}</span><b>{row.invoice == null ? t('portal.bill.noInvoice') : money(row.invoice)}</b></div>
            {row.paid > 0 && (
              <>
                <div className="bill-match-row is-paid"><span>{t('portal.bill.paid')}</span><b>{money(row.paid)}</b></div>
                <div className="bill-match-row is-open"><span>{t('portal.bill.open')}</span><b>{money(row.open)}</b></div>
              </>
            )}
            <p className="bill-match-verdict">
              {slip && row.open > 0 && row.paid > 0 && t('portal.bill.paidLine', { paid: money(row.paid), open: money(row.open) })}
              {slip && row.open > 0 && !(row.paid > 0) && t('portal.bill.slipOpen', { open: money(row.open) })}
              {slip && row.open === 0 && t('portal.bill.slipPaidFull')}
              {!slip && row.status === 'match' && row.invoice == null && t('portal.bill.matchPending')}
              {!slip && row.status === 'match' && row.invoice != null && row.paid > 0 && row.open > 0 && t('portal.bill.partPaid', { paid: money(row.paid), open: money(row.open) })}
              {!slip && row.status === 'match' && row.invoice != null && !(row.paid > 0 && row.open > 0) && t('portal.bill.match')}
              {!slip && row.status === 'waiting' && t('portal.bill.waiting')}
              {!slip && row.status === 'paid-gap' && t('portal.bill.gapPaid', { amount: money(row.gapPaid), invoice: money(row.invoice) })}
              {slip && row.status === 'paid-gap' && t('portal.bill.gapPaid', { amount: money(row.gapPaid), invoice: money(row.invoice) })}
              {!slip && row.status === 'off' && t('portal.bill.off', { amount: money(Math.abs(row.delta)) })}
              {!slip && row.status === 'off' && row.paid > 0 && ` ${t('portal.bill.paidLine', { paid: money(row.paid), open: money(row.open) })}`}
            </p>
          </section>
        )
      })}
    </div>
  )
}
