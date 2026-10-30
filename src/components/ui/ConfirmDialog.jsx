import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { t } from '../../lib/i18n'

/**
 * The system's own confirm dialog and toast (instead of window.confirm / alert, which some browsers and
 * embedded views block silently, so the delete button looked like it did nothing).
 *
 *   if (!(await askConfirm({ title, message, details: [['Amount', '¥300,000']], danger: true }))) return
 *   notify('Deleted', 'ok')
 */

function mount(render) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const close = () => { root.unmount(); host.remove() }
  root.render(render(close))
}

function Dialog({ title, message, details, confirmLabel, cancelLabel, danger, typeToConfirm, onDone }) {
  const [typed, setTyped] = useState('')
  const okRef = useRef(null)
  const needTyped = !!typeToConfirm
  const canOk = !needTyped || typed.trim().toLowerCase() === String(typeToConfirm).trim().toLowerCase()

  useEffect(() => {
    if (!needTyped) okRef.current?.focus()
    const onKey = e => { if (e.key === 'Escape') onDone(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [needTyped, onDone])

  return (
    <div className="sys-confirm-back" role="presentation" onClick={() => onDone(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'color-mix(in srgb, var(--c-text, #000) 50%, transparent)' }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="sys-confirm-title" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 420, background: 'var(--bg2, #fff)', color: 'var(--c-text, #111)', borderRadius: 16, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div id="sys-confirm-title" style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{title}</div>
        {message && <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55, marginBottom: details?.length ? 10 : 14 }}>{message}</div>}
        {details?.length > 0 && (
          <dl style={{ margin: '0 0 14px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 }}>
            {details.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt style={{ color: 'var(--text2)' }}>{k}</dt><dd style={{ margin: 0, fontWeight: 700 }}>{v}</dd></div>
            ))}
          </dl>
        )}
        {needTyped && (
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
            {t('confirm.typeToConfirm', { word: typeToConfirm })}
            <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} style={{ marginTop: 6, width: '100%' }} />
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => onDone(false)} style={{ padding: '9px 16px', borderRadius: 10 }}>{cancelLabel || t('common.cancel')}</button>
          <button type="button" ref={okRef} disabled={!canOk} onClick={() => onDone(true)}
            className={danger ? 'btn-danger' : 'btn-primary'} style={{ padding: '9px 16px', borderRadius: 10, fontWeight: 700 }}>
            {confirmLabel || (danger ? t('confirm.delete') : t('confirm.ok'))}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Resolves true when the person confirms. `typeToConfirm` asks them to type a word first (protected actions). */
export function askConfirm(opts = {}) {
  if (typeof document === 'undefined') return Promise.resolve(false)
  return new Promise(resolve => {
    mount(close => <Dialog {...opts} onDone={ok => { close(); resolve(!!ok) }} />)
  })
}

/** Short feedback after an action ('ok' | 'error' | 'info'). */
export function notify(text, tone = 'ok') {
  if (typeof document === 'undefined' || !text) return
  mount(close => <Toast text={String(text)} tone={tone} onDone={close} />)
}

function Toast({ text, tone, onDone }) {
  useEffect(() => { const id = setTimeout(onDone, tone === 'error' ? 6000 : 3000); return () => clearTimeout(id) }, [onDone, tone])
  const bg = tone === 'error' ? 'var(--red, #c0392b)' : tone === 'info' ? 'var(--navy, #1f2a44)' : 'var(--green, #1e8e5a)'
  return (
    <div role="status" aria-live="polite" onClick={onDone}
      style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 5001, maxWidth: 'calc(100vw - 32px)', padding: '10px 16px', borderRadius: 12, background: bg, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
      {text}
    </div>
  )
}
