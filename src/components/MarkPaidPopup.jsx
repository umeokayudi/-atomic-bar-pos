import { useState } from 'react'
import { fmtYen, fmtDate } from './utils'
import { savePaidMark } from '../lib/markPaid'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import InvoicePaymentsModal from './InvoicePaymentsModal'
import { askConfirm, notify } from './ui/ConfirmDialog'
import { DIRECT_METHOD } from '../lib/money'

const PAY_METHODS = ['Transfer', 'Cash', 'Card', DIRECT_METHOD]

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function MarkPaidPopup({ item, onClose, onSaved }) {
  // Bar invoices can be paid in parts: open the payment log instead of a paid/unpaid toggle.
  if (item?.type === 'fatura') return <InvoicePaymentsModal faturaId={item.id} onClose={onClose} onSaved={onSaved} />
  return <SupplierPaidPopup item={item} onClose={onClose} onSaved={onSaved} />
}

function SupplierPaidPopup({ item, onClose, onSaved }) {
  const { t } = useI18n()
  // Opening a bill is almost always to mark it paid; an already paid bill stays paid unless "Not paid" is tapped.
  const [paid, setPaid] = useState(true)
  const [date, setDate] = useState(item?.paidDate || todayStr())
  // No default: marking a supplier bill paid needs an explicit method (a one-tap "paid" is not allowed).
  const [metodo, setMetodo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!item) return null

  async function save() {
    setErr('')
    if (paid) {
      if (!metodo) { setErr(t('payMark.pickMethod')); return }
      if (!date) { setErr(t('payMark.pickDate')); return }
      const ok = await askConfirm({
        title: t('payMark.confirmTitle'),
        details: [
          [t('confirm.who'), item.label || '—'],
          [t('confirm.amount'), fmtYen(item.amount || 0)],
          [t('confirm.method'), t(`payMark.m_${PAY_METHODS.indexOf(metodo)}`)],
          [t('confirm.date'), fmtDate(date)],
        ],
        confirmLabel: t('payMark.confirmOk'),
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      await savePaidMark(item, { paid, date: paid ? date : null, metodo: paid ? metodo : null })
      notify(t('confirm.saved'))
      onSaved?.()
      onClose?.()
    } catch (e) {
      setErr(errText(e, t('payMark.error')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pay-pop-back" onClick={onClose} role="presentation">
      <div className="pay-pop" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="pay-pop-kicker">{item.type === 'compra' ? t('payMark.supplier') : t('payMark.invoice')}</div>
        <div className="pay-pop-title">{item.label}</div>
        <div className="pay-pop-amt">{fmtYen(item.amount || 0)}</div>
        {item.paid && item.paidDate ? (
          <div className="pay-pop-due is-muted">{t('cashflow.paidOnDate', { date: fmtDate(item.paidDate) })}</div>
        ) : item.dueDate ? (
          <div className={item.dueDate < todayStr() ? 'pay-pop-due' : 'pay-pop-due is-muted'}>
            {t(item.dueDate < todayStr() ? 'common.expiredOn' : 'cashflow.dueOnDate', { date: fmtDate(item.dueDate) })}
          </div>
        ) : null}

        <div className="pay-pop-toggle">
          <button type="button" className={paid ? 'is-on paid' : ''} onClick={() => setPaid(true)}>
            {t('payMark.paid')}
          </button>
          <button type="button" className={!paid ? 'is-on pending' : ''} onClick={() => setPaid(false)}>
            {t('payMark.notPaid')}
          </button>
        </div>

        {paid && (
          <>
            <label className="pay-pop-date">
              <span>{t('common.paymentDate')}</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </label>
            <label className="pay-pop-date">
              <span>{t('payMark.method')}</span>
              <select value={metodo} onChange={e => setMetodo(e.target.value)}>
                <option value="">{t('payMark.pickMethod')}</option>
                {PAY_METHODS.map((m, i) => <option key={m} value={m}>{t(`payMark.m_${i}`)}</option>)}
              </select>
            </label>
          </>
        )}

        {err && <div className="pay-pop-err">{asReactText(err)}</div>}

        <div className="pay-pop-actions">
          <button type="button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
