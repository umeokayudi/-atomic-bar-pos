/**
 * Collection e-mail text for one client bar (CRM → "Collect"): its open invoices with total, already settled,
 * what is left and the due date, overdue ones first. Pure: no sending, the user copies it or opens their e-mail.
 */
import { invoiceMoney, invoicePeriod, invoiceTotal } from './money.js'

const PAID = ['pago', 'paga', 'paid']

/** Billing e-mail of the bar: its file (HQ → Bars) first, then the owner login of that bar. */
export function billingEmailFor(barId, { profiles = [], logins = [] } = {}) {
  const file = (profiles || []).find(p => (p.bar_id || p.id) === barId)
  const fromFile = String(file?.email_cobranca || '').trim()
  if (fromFile) return fromFile
  const owner = (logins || []).find(l => l.bar_id === barId && l.role === 'cliente' && l.email)
    || (logins || []).find(l => l.bar_id === barId && l.role === 'gerente' && l.email)
  return String(owner?.email || '').trim()
}

/** Open invoices of a bar with total / settled / left / due, overdue first then by due date. */
export function openInvoicesFor(barId, invoices = [], pagamentos = [], today) {
  return (invoices || [])
    .filter(f => f.bar_id === barId && !PAID.includes(f.status))
    .map(f => {
      const m = invoiceMoney(f, pagamentos)
      const due = String(f.vencimento || f.data_vencimento || '').slice(0, 10)
      const { start, end } = invoicePeriod(f)
      return { id: f.id, start, end, due, total: invoiceTotal(f), settled: m.paid, left: m.remaining, overdue: !!due && due < today }
    })
    .filter(r => r.left > 0)
    .sort((a, b) => (a.overdue === b.overdue ? String(a.due).localeCompare(String(b.due)) : a.overdue ? -1 : 1))
}

/**
 * { to, subject, body, rows, totalLeft, overdueLeft }. `t` is the i18n function, `yen` formats amounts.
 */
export function buildCollectionEmail({ bar, email, invoices = [], pagamentos = [], today, t, yen }) {
  const rows = openInvoicesFor(bar.id, invoices, pagamentos, today)
  const totalLeft = rows.reduce((a, r) => a + r.left, 0)
  const overdueLeft = rows.filter(r => r.overdue).reduce((a, r) => a + r.left, 0)
  const lines = rows.map(r => t('collect.line', {
    period: r.start && r.end ? `${r.start} ~ ${r.end}` : '—',
    total: yen(r.total),
    settled: yen(r.settled),
    left: yen(r.left),
    due: r.due || '—',
    flag: r.overdue ? ` ${t('collect.overdueFlag')}` : '',
  }))
  const body = [
    t('collect.greeting', { bar: bar.nome }),
    '',
    rows.some(r => r.overdue) ? t('collect.introOverdue') : t('collect.intro'),
    '',
    ...lines,
    '',
    t('collect.totalLeft', { amount: yen(totalLeft) }) + (overdueLeft > 0 ? ` · ${t('collect.overdueLeft', { amount: yen(overdueLeft) })}` : ''),
    '',
    t('collect.closing'),
    t('collect.signature'),
  ].join('\n')
  return { to: email || '', subject: t('collect.subject', { bar: bar.nome, amount: yen(totalLeft) }), body, rows, totalLeft, overdueLeft }
}

export function mailtoHref({ to, subject, body }) {
  return `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`
}
