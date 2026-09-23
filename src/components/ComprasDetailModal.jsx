import ModalShell from './ModalShell'
import { fmtYen, fmtDate } from './utils'

export default function ComprasDetailModal({ open, onClose, compras, monthLabel: monthLbl, creditoBar }) {
  if (!open) return null

  const totalCompras = (compras || []).reduce((a, c) => a + (+c.total_real || 0), 0)
  const sorted = [...(compras || [])].sort((a, b) => (a.data || '').localeCompare(b.data || ''))

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={`Compras — ${monthLbl}`}
      subtitle={
        <>
          {sorted.length} nota(s) · Total pago {fmtYen(totalCompras)}
          {creditoBar > 0 && <> · Crédito bar {fmtYen(creditoBar)}</>}
        </>
      }
    >
          {sorted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text3)', fontSize: 13 }}>
              Nenhuma compra neste mês
            </div>
          ) : sorted.map(c => (
            <div
              key={c.id}
              style={{
                border: '1px solid var(--border)', borderRadius: 12,
                padding: '14px 16px', marginBottom: 10, background: 'var(--bg3)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)' }}>{c.fornecedor || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                    {fmtDate(c.data)} · {c.pagamento || '—'}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--red)', flexShrink: 0 }}>
                  {fmtYen(c.total_real)}
                </div>
              </div>
              {(c.compras_itens || []).length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                  {(c.compras_itens || []).map((it, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 3 }}>
                      <span>{it.nome || '?'}{it.qtd ? ` · ${it.qtd} un.` : ''}</span>
                      <span>{fmtYen(it.custo_unitario)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
    </ModalShell>
  )
}
