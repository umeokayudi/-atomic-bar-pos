export default function ModalShell({ open, onClose, title, subtitle, children, wide }) {
  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,16,40,0.55)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', borderRadius: 16, width: '100%',
          maxWidth: wide ? 720 : 640,
          maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,16,40,0.3)',
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--navy)' }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6, lineHeight: 1.6 }}>{subtitle}</div>
          )}
        </div>

        <div style={{ overflowY: 'auto', padding: '12px 16px 20px', flex: 1 }}>
          {children}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontWeight: 600 }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
