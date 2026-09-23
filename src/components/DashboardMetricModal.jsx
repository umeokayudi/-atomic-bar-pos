import ModalShell from './ModalShell'
import { fmtYen, fmtDate } from './utils'
import { useI18n } from '../lib/i18n'

function VendaRow({ v }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)', borderRadius: 12,
        padding: '12px 14px', marginBottom: 8, background: 'var(--bg3)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>
            {fmtDate(v.data)}
            {v.barNome && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: v.barCor || 'var(--text2)' }}>
                {v.barNome}
              </span>
            )}
          </div>
          {v.obs && (
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.obs}
            </div>
          )}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--navy)', flexShrink: 0 }}>
          {fmtYen(v.receita)}
        </div>
      </div>
    </div>
  )
}

export default function DashboardMetricModal({ open, onClose, type, monthLabel: monthLbl, stats }) {
  const { t } = useI18n()
  if (!open || !stats || type !== 'receita') return null

  const entregas = stats.entregasDetalhe || stats.vendasDetalhe || []
  const total = stats.faturamento ?? stats.receitaMes ?? entregas.reduce((a, v) => a + (+v.receita || 0), 0)

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('dashboardModal.deliveriesTitle', { month: monthLbl })}
      subtitle={t('dashboardModal.deliveriesSubtitle', { count: entregas.length, amount: fmtYen(total) })}
    >
      {entregas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text3)', fontSize: 13 }}>{t('dashboardModal.noDeliveries')}</div>
      ) : entregas.map(v => (
        <VendaRow key={v.id} v={v} />
      ))}
    </ModalShell>
  )
}
