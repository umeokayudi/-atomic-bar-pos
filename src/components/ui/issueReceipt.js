import { issuePaymentReceipt } from '../../lib/receipts'
import { fmtDate, fmtYen } from '../utils'
import { askConfirm, notify } from './ConfirmDialog'
import { t } from '../../lib/i18n'

/**
 * Issue the receipt for one payment. If that payment already has a receipt (same invoice + amount + date),
 * no second receipt is made: the user is told which one exists and may print that same one again.
 */
export async function issueReceiptChecked(supabase, { bar, item, dataEmissao, company }) {
  const res = await issuePaymentReceipt(supabase, { bar, item, dataEmissao, company })
  if (!res.duplicate) {
    notify(t('confirm.saved'))
    return res
  }
  const ex = res.existing || {}
  const again = await askConfirm({
    title: t('receipts.alreadyTitle', { numero: res.numero }),
    details: [[t('common.number'), ex.numero || res.numero], [t('confirm.amount'), fmtYen(ex.total || item.valor)], [t('confirm.date'), fmtDate(ex.data_emissao || item.data)]],
    confirmLabel: t('receipts.printSame'),
  })
  if (!again) return res
  const out = await issuePaymentReceipt(supabase, { bar, item, dataEmissao, company, reprint: true })
  notify(t('receipts.reused', { numero: out.numero }), 'info')
  return out
}
