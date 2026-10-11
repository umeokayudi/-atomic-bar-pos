import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate, compraDate } from './utils'
import { compraPendingAmount } from '../lib/compraPagamentos'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'

const METHODS = ['Bank Transfer', 'Cash', 'Card']

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * One payment to a supplier that covers several open purchases (e.g. Le Vin on the 10th, for July and some of August).
 * Ticked purchases are marked paid on the chosen date; the rest stay "to pay".
 */
export default function PaySupplierPopup({ compras, onClose, onSaved }) {
  const { t } = useI18n()
  const open = useMemo(() => compras.filter(c => c.status_pagamento === 'pendente'), [compras])
  const suppliers = useMemo(() => [...new Set(open.map(c => c.fornecedor).filter(Boolean))].sort(), [open])
  const [supplier, setSupplier] = useState(suppliers[0] || '')
  const rows = open
    .filter(c => c.fornecedor === supplier)
    .sort((a, b) => compraDate(a).localeCompare(compraDate(b)))
  const [picked, setPicked] = useState(() => new Set(rows.map(c => c.id)))
  const [date, setDate] = useState(todayStr())
  const [method, setMethod] = useState(METHODS[0])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const total = rows.filter(c => picked.has(c.id)).reduce((a, c) => a + compraPendingAmount(c), 0)

  function pickSupplier(name) {
    setSupplier(name)
    setPicked(new Set(open.filter(c => c.fornecedor === name).map(c => c.id)))
  }
  function toggle(id) {
    const next = new Set(picked)
    next.has(id) ? next.delete(id) : next.add(id)
    setPicked(next)
  }

  async function save() {
    const ids = rows.filter(c => picked.has(c.id)).map(c => c.id)
    if (!ids.length) return
    setErr('')
    setBusy(true)
    const { error } = await supabase
      .from('compras')
      .update({ status_pagamento: 'pago', data_pagamento: date, metodo_pagamento_real: method })
      .in('id', ids)
    setBusy(false)
    if (error) return setErr(errText(error, t('payMark.error')))
    onSaved?.()
    onClose?.()
  }

  return (
    <div className="pay-pop-back" onClick={onClose} role="presentation">
      <div className="pay-pop" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="pay-pop-kicker">{t('paySupplier.kicker')}</div>
        {!suppliers.length ? (
          <div className="pay-pop-due is-muted" style={{ marginTop: 8 }}>{t('paySupplier.none')}</div>
        ) : (
          <>
            <label className="pay-pop-date" style={{ marginTop: 8 }}>
              <span>{t('common.supplier')}</span>
              <select value={supplier} onChange={e => pickSupplier(e.target.value)}>
                {suppliers.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <div className="pay-pop-due is-muted" style={{ marginBottom: 6 }}>{t('paySupplier.hint')}</div>
            <div className="pay-pop-pick">
              {rows.map(c => (
                <label key={c.id}>
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                  <span>{fmtDate(compraDate(c))}</span>
                  <b>{fmtYen(compraPendingAmount(c))}</b>
                </label>
              ))}
            </div>
            <div className="pay-pop-amt">{fmtYen(total)}</div>
            <label className="pay-pop-date">
              <span>{t('common.paymentDate')}</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </label>
            <label className="pay-pop-date">
              <span>{t('common.payment')}</span>
              <select value={method} onChange={e => setMethod(e.target.value)}>
                {METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
          </>
        )}
        {err && <div className="pay-pop-err">{asReactText(err)}</div>}
        <div className="pay-pop-actions">
          <button type="button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy || !total}>
            {busy ? t('common.saving') : t('paySupplier.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
