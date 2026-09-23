export function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--white60)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

export function Modal({ title, children, onClose, width = 420 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,10,28,0.9)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--navy2)', border: '0.5px solid var(--gold-border)', borderRadius: 12, padding: 24, width, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--gold)' }}>{title}</div>
          {onClose && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--white60)', fontSize: 18, lineHeight: 1 }}>×</button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

export function GoldButton({ children, onClick, disabled, type = 'button' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500,
      background: 'var(--gold-dim)', border: '0.5px solid var(--gold-border)', color: 'var(--gold)',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1
    }}>{children}</button>
  )
}

export function GhostButton({ children, onClick, disabled, flex }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex, padding: 10, borderRadius: 8, border: '0.5px solid var(--gold-border)',
      background: 'none', color: 'var(--white90)', fontSize: 13, cursor: 'pointer'
    }}>{children}</button>
  )
}

export function SolidButton({ children, onClick, disabled, flex }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex, padding: 10, borderRadius: 8, background: 'var(--gold)', color: 'var(--navy)',
      border: 'none', fontWeight: 600, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1
    }}>{children}</button>
  )
}

export function Chip({ active, onClick, children, danger }) {
  const color = danger ? 'var(--danger)' : 'var(--gold)'
  const bg = danger ? 'var(--danger-dim)' : 'var(--gold-dim)'
  return (
    <button onClick={onClick} style={{
      padding: '5px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
      background: active ? bg : 'none',
      color: active ? color : 'var(--white60)',
      border: `0.5px solid ${active ? color : 'var(--gold-border)'}`,
    }}>{children}</button>
  )
}

export function Empty({ children }) {
  return <div style={{ textAlign: 'center', color: 'var(--white30)', padding: 24, fontSize: 13 }}>{children}</div>
}
