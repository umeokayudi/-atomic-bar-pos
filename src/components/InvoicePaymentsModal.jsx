import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate } from './utils'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { faturaSummary, addFaturaPayment, confirmFaturaPayment, removeFaturaPayment } from '../lib/faturaLedger'

const METHODS = ['Transfer', 'Cash', 'Card', 'Stripe']

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * One place to see and log what a bar paid on an invoice:
 * total / received / left, the payment log, and a form for a new (partial) payment.
 */
export default function InvoicePaymentsModal({ faturaId, onClose, onSaved }) {
  const { t } = useI18n()
  const [fatura, setFatura] = useState(null)
  const [pagamentos, setPagamentos] = useState([])
  const [form, setForm] = useState({ valor: '', data: todayStr(), metodo: 'Transfer', notas: '', waiting: false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    const [fR, pR] = await Promise.all([
      supabase.from('faturas').select('*, bars(nome)').eq('id', faturaId).single(),
      supabase.from('fatura_pagamentos').select('*').eq('fatura_id', faturaId),
    ])
    if (fR.error) { setErr(errText(fR.error, t('ledger.loadError'))); return }
    setFatura(fR.data)
    setPagamentos(pR.data || [])
  }

  useEffect(() => { load() }, [faturaId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action) {
    setErr('')
    setBusy(true)
    try {
      await action()
      await load()
      onSaved?.()
      return true
    } catch (e) {
      setErr(errText(e, t('payMark.error')))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const ok = await run(() => addFaturaPayment(supabase, faturaId, {
      valor: form.valor,
      data: form.data,
      metodo: form.metodo,
      notas: form.notas,
      confirmado: !form.waiting,
    }))
    if (ok) setForm(f => ({ ...f, valor: '', notas: '', waiting: false }))
  }

  const s = fatura ? faturaSummary(fatura, pagamentos) : null
  const amount = +form.valor || 0
  const after = s ? Math.max(0, s.remaining - (form.waiting ? 0 : amount)) : 0

  return (
    <div className="ledger-back" onClick={onClose} role="presentation">
      <div className="ledger" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="ledger-head">
          <div>
            <div className="ledger-kicker">{t('ledger.kicker')}</div>
            <div className="ledger-title">{fatura?.bars?.nome || '…'}</div>
            {fatura && (
              <div className="ledger-sub">
                {fmtDate(fatura.periodo_inicio || fatura.data_emissao)} → {fmtDate(fatura.periodo_fim || fatura.data_vencimento)}
                {' · '}{t('ledger.due', { date: fmtDate(fatura.data_vencimento) })}
                {s?.late > 0 && <span className="ledger-late"> · {t('ledger.daysLate', { count: s.late })}</span>}
              </div>
            )}
          </div>
          <button type="button" className="ledger-x" onClick={onClose} aria-label={t('common.close')}>×</button>
        </div>

        {!s ? (
          <div className="ledger-body">{err ? <div className="pay-pop-err">{asReactText(err)}</div> : t('common.loading')}</div>
        ) : (
          <div className="ledger-body">
            <div className="ledger-sum">
              <div><span>{t('ledger.total')}</span><b>{fmtYen(s.total)}</b></div>
              <div><span>{t('ledger.received')}</span><b className="is-green">{fmtYen(s.received)}</b></div>
              <div><span>{t('ledger.left')}</span><b className={s.remaining > 0 ? 'is-red' : 'is-green'}>{fmtYen(s.remaining)}</b></div>
            </div>
            <div className="ledger-bar"><div style={{ width: s.pct + '%' }} /></div>

            {s.remaining > 0 && (
              <div className="ledger-form">
                <div className="ledger-form-title">{t('ledger.newPayment')}</div>
                <label className="ledger-field">
                  <span>{t('ledger.amount')}</span>
                  <input type="number" inputMode="numeric" min="0" value={form.valor} placeholder="0"
                    onChange={e => setForm({ ...form, valor: e.target.value })} autoFocus />
                </label>
                <div className="ledger-quick">
                  <button type="button" onClick={() => setForm({ ...form, valor: String(s.remaining) })}>{t('ledger.all', { amount: fmtYen(s.remaining) })}</button>
                  <button type="button" onClick={() => setForm({ ...form, valor: String(Math.round(s.remaining / 2)) })}>{t('ledger.half')}</button>
                </div>
                <div className="ledger-row2">
                  <label className="ledger-field">
                    <span>{t('ledger.date')}</span>
                    <input type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} />
                  </label>
                  <label className="ledger-field">
                    <span>{t('ledger.method')}</span>
                    <select value={form.metodo} onChange={e => setForm({ ...form, metodo: e.target.value, waiting: e.target.value === 'Stripe' ? true : form.waiting })}>
                      {METHODS.map(m => <option key={m} value={m}>{t(`ledger.method${m}`)}</option>)}
                    </select>
                  </label>
                </div>
                <label className="ledger-field">
                  <span>{t('ledger.note')}</span>
                  <input value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder={t('ledger.notePlaceholder')} />
                </label>
                <label className="ledger-check">
                  <input type="checkbox" checked={form.waiting} onChange={e => setForm({ ...form, waiting: e.target.checked })} />
                  {t('ledger.waitingCheck')}
                </label>
                {amount > 0 && (
                  <div className="ledger-preview">
                    {form.waiting
                      ? t('ledger.previewWaiting', { amount: fmtYen(amount) })
                      : after > 0
                        ? t('ledger.previewPartial', { amount: fmtYen(amount), left: fmtYen(after) })
                        : t('ledger.previewFull', { amount: fmtYen(amount) })}
                  </div>
                )}
                {err && <div className="pay-pop-err">{asReactText(err)}</div>}
                <button type="button" className="btn-primary ledger-save" onClick={save} disabled={busy || amount <= 0}>
                  {busy ? t('common.saving') : t('ledger.save')}
                </button>
              </div>
            )}

            <div className="ledger-log-title">{t('ledger.log')}</div>
            {s.payments.length === 0 && s.unrecorded === 0 ? (
              <div className="ledger-empty">{t('ledger.noPayments')}</div>
            ) : (
              <div className="ledger-log">
                {s.payments.map(p => (
                  <div key={p.id} className={`ledger-item${p.confirmado ? '' : ' is-waiting'}`}>
                    <div className="ledger-item-main">
                      <div className="ledger-item-amt">{fmtYen(p.valor)}</div>
                      <div className="ledger-item-meta">
                        {fmtDate(p.data)} · {p.metodo}{p.notas ? ` · ${p.notas}` : ''}
                        {p.comprovante_url && <> · <a href={p.comprovante_url} target="_blank" rel="noreferrer">{t('ledger.receipt')}</a></>}
                      </div>
                      {!p.confirmado && <div className="ledger-item-flag">{t('ledger.waiting')}</div>}
                    </div>
                    <div className="ledger-item-actions">
                      {!p.confirmado && (
                        <button type="button" className="is-ok" disabled={busy} onClick={() => run(() => confirmFaturaPayment(supabase, p))}>
                          {t('ledger.confirm')}
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => {
                        if (!confirm(t('ledger.removeConfirm', { amount: fmtYen(p.valor) }))) return
                        run(() => removeFaturaPayment(supabase, p))
                      }}>{t('ledger.remove')}</button>
                    </div>
                  </div>
                ))}
                {s.unrecorded > 0 && (
                  <div className="ledger-item is-old">
                    <div className="ledger-item-main">
                      <div className="ledger-item-amt">{fmtYen(s.unrecorded)}</div>
                      <div className="ledger-item-meta">{t('ledger.unrecorded')}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
