import { useState } from 'react'
import { fmtYen, fmtDate } from './utils'
import { savePaidMark } from '../lib/markPaid'
import { useI18n } from '../lib/i18n'

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function MarkPaidPopup({ item, onClose, onSaved }) {
  const { t } = useI18n()
  const [paid, setPaid] = useState(item?.paid ? false : true)
  const [date, setDate] = useState(item?.paidDate || todayStr())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!item) return null

  async function save() {
    setErr('')
    setBusy(true)
    try {
      await savePaidMark(item, { paid, date: paid ? date : null })
      onSaved?.()
      onClose?.()
    } catch (e) {
      setErr(e.message || t('payMark.error'))
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
        {item.dueDate && (
          <div className="pay-pop-due">{t('common.expiredOn', { date: fmtDate(item.dueDate) })}</div>
        )}

        <div className="pay-pop-toggle">
          <button type="button" className={paid ? 'is-on paid' : ''} onClick={() => setPaid(true)}>
            {t('payMark.paid')}
          </button>
          <button type="button" className={!paid ? 'is-on pending' : ''} onClick={() => setPaid(false)}>
            {t('payMark.notPaid')}
          </button>
        </div>

        {paid && (
          <label className="pay-pop-date">
            <span>{t('common.paymentDate')}</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>
        )}

        {err && <div className="pay-pop-err">{err}</div>}

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
