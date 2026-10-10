import { fmtYen, fmtDate } from './utils'
import { useI18n } from '../lib/i18n'
import { faturaSummary } from '../lib/faturaLedger'
import './invoicePayments.css'

/** One row per invoice: bar, total / received / left, and a button to log a payment. */
export default function OpenInvoicesList({ faturas, pagamentos, onOpen, emptyText }) {
  const { t } = useI18n()
  const rows = (faturas || [])
    .map(f => ({ f, s: faturaSummary(f, pagamentos) }))
    .sort((a, b) => (b.s.late - a.s.late) || String(a.f.data_vencimento || '').localeCompare(String(b.f.data_vencimento || '')))

  if (rows.length === 0) return <div style={{ fontSize: 13, color: 'var(--text3)' }}>{emptyText}</div>

  return (
    <div className="owe-list">
      {rows.map(({ f, s }) => (
        <button key={f.id} type="button" className={`owe-row${s.late > 0 ? ' is-late' : ''}`} onClick={() => onOpen(f)}>
          <div className="owe-who">
            <div className="owe-name">{f.bars?.nome || t('common.bar')}</div>
            <div className="owe-meta">
              {fmtDate(f.periodo_inicio || f.data_emissao)} → {fmtDate(f.periodo_fim || f.data_vencimento)}
            </div>
            {s.remaining > 0 && (
              <div className={`owe-meta${s.late > 0 ? ' is-late' : ''}`}>
                {s.late > 0 ? t('ledger.daysLate', { count: s.late }) : t('ledger.due', { date: fmtDate(f.data_vencimento) })}
              </div>
            )}
            {s.underReview > 0 && (
              <div className="owe-meta is-wait">{t('ledger.waiting')}: {fmtYen(s.underReview)}</div>
            )}
          </div>
          <div className="owe-num"><span>{t('ledger.total')}</span><b>{fmtYen(s.total)}</b></div>
          <div className="owe-num"><span>{t('ledger.received')}</span><b className="is-green">{fmtYen(s.received)}</b></div>
          <div className="owe-num"><span>{t('ledger.left')}</span><b className={s.remaining > 0 ? 'is-red' : 'is-green'}>{fmtYen(s.remaining)}</b></div>
          <span className="owe-btn">{s.remaining > 0 ? t('ledger.record') : t('ledger.open')}</span>
          <div className="owe-bar"><div style={{ width: s.pct + '%' }} /></div>
        </button>
      ))}
    </div>
  )
}
