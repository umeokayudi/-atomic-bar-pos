import { useEffect, useRef } from 'react'
import { fmtYen } from '../utils'
import { productCodes, productProblem } from '../../lib/posEngine'

export function PosSearch({ t, query, onQuery, onScan }) {
  return (
    <div className="pos-search-row">
      <input
        className="pos-search-input"
        value={query}
        placeholder={t('posFloor.searchPlaceholder')}
        onChange={event => onQuery(event.target.value)}
        autoComplete="off"
        enterKeyHint="search"
      />
      <button type="button" className="pos-scan" onClick={onScan}>{t('posFloor.scan')}</button>
    </div>
  )
}

export function ProductButton({ product, onAdd }) {
  const code = productCodes(product)[0]
  const problem = productProblem(product)
  return (
    <button type="button" className="pos-product-card" onClick={() => onAdd(product)} disabled={!!problem}>
      <span>{product.nome}</span>
      {code && <small>{code}</small>}
      <strong>{problem ? '' : fmtYen(product.preco_venda || product.preco_drink || 0)}</strong>
    </button>
  )
}

export function ProductGrid({ products, onAdd, empty }) {
  if (!products.length) return <p className="pos-floor-empty">{empty}</p>
  return (
    <div className="pos-product-grid">
      {products.map(product => (
        <ProductButton key={`${product.kind || 'drink'}-${product.id}`} product={product} onAdd={onAdd} />
      ))}
    </div>
  )
}

export function ChipRow({ label, children }) {
  if (!children) return null
  return (
    <div className="pos-chip-block">
      {label && <div className="pos-chip-label">{label}</div>}
      <div className="pos-chip-row">{children}</div>
    </div>
  )
}

export function RecommendRow({ t, items, onAdd, why, setWhy }) {
  if (!items?.length) return null
  return (
    <ChipRow label={t('posFloor.recommended')}>
      {items.map(item => (
        <div key={`${item.product.kind}-${item.product.id}`} className="pos-rec">
          <button type="button" onClick={() => onAdd(item.product)}>
            <span>{item.product.nome}</span>
            <strong>{fmtYen(item.product.preco_venda || 0)}</strong>
          </button>
          <button type="button" className="pos-why" onClick={() => setWhy(why === item.reason ? '' : item.reason)}>
            {t('posFloor.why')}
          </button>
        </div>
      ))}
      {why && <p className="pos-why-text">{why}</p>}
    </ChipRow>
  )
}

export function QuoteLines({ t, quote }) {
  if (!quote?.ok) return null
  return (
    <div className="pos-quote">
      <div><span>{t('posFloor.subtotal')}</span><span>{fmtYen(quote.subtotal)}</span></div>
      {quote.service > 0 && <div><span>{t('posFloor.service')}</span><span>{fmtYen(quote.service)}</span></div>}
      {quote.tax > 0 && <div><span>{t('posFloor.tax')}</span><span>{fmtYen(quote.tax)}</span></div>}
      {quote.surcharge > 0 && <div><span>{t('posFloor.surcharge')}</span><span>{fmtYen(quote.surcharge)}</span></div>}
      <div className="pos-quote-total"><span>{t('posFloor.total')}</span><strong>{fmtYen(quote.total)}</strong></div>
    </div>
  )
}

export function ConfirmPay({ t, quote, busy, onCancel, onConfirm }) {
  return (
    <div className="pos-mode-picker" role="dialog" aria-modal="true">
      <div className="pos-mode-card pos-confirm-card">
        <h2>{t('posFloor.confirmTitle')}</h2>
        <QuoteLines t={t} quote={quote} />
        <div className="pos-mode-choices">
          <button type="button" onClick={onCancel} disabled={busy}>{t('posFloor.confirmCancel')}</button>
          <button type="button" className="is-suggested" onClick={onConfirm} disabled={busy}>
            {busy ? t('posFloor.saving') : t('posFloor.confirmPay', { amount: fmtYen(quote?.total || 0) })}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PosScanner({ t, onCode, onClose }) {
  const videoRef = useRef(null)
  useEffect(() => {
    const Detector = typeof window !== 'undefined' ? window.BarcodeDetector : null
    if (!Detector || !navigator.mediaDevices?.getUserMedia) return undefined
    let stop = false
    let stream
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'code_128', 'qr_code'] })
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(next => {
      stream = next
      if (stop || !videoRef.current) {
        next.getTracks().forEach(track => track.stop())
        return
      }
      videoRef.current.srcObject = next
      videoRef.current.play()
      const tick = async () => {
        if (stop || !videoRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          if (codes[0]?.rawValue) {
            onCode(codes[0].rawValue)
            return
          }
        } catch {
          /* keep trying until the camera closes */
        }
        if (!stop) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }).catch(() => {})
    return () => {
      stop = true
      stream?.getTracks().forEach(track => track.stop())
    }
  }, [onCode])

  const supported = typeof window !== 'undefined' && window.BarcodeDetector && navigator.mediaDevices?.getUserMedia
  return (
    <div className="pos-mode-picker" role="dialog" aria-modal="true">
      <div className="pos-mode-card">
        <h2>{t('posFloor.scan')}</h2>
        {supported ? <video ref={videoRef} className="pos-scan-video" muted playsInline /> : <p>{t('posFloor.scanType')}</p>}
        <button type="button" onClick={onClose}>{t('posFloor.confirmCancel')}</button>
      </div>
    </div>
  )
}
