import { useEffect, useState } from 'react'
import { fmtYen, fmtDate } from './utils'
import { useI18n } from '../lib/i18n'

const kindOf = url => {
  const path = String(url || '').split('?')[0].toLowerCase()
  if (path.startsWith('data:image') || /\.(png|jpe?g|gif|webp|heic)$/.test(path)) return 'image'
  if (path.startsWith('data:application/pdf') || path.endsWith('.pdf')) return 'pdf'
  if (/\.(json|txt)$/.test(path)) return 'text'
  return 'other'
}

/** Read the file as UTF-8 ourselves: Storage serves JSON without a charset, so Safari shows Japanese as garbage. */
async function loadText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = new TextDecoder('utf-8').decode(await res.arrayBuffer())
  try {
    return { json: JSON.parse(text) }
  } catch {
    return { text }
  }
}

const num = v => (v === '' || v == null || isNaN(+v) ? null : +v)

function InvoiceJson({ doc }) {
  const { t } = useI18n()
  const items = Array.isArray(doc.produtos) ? doc.produtos : Array.isArray(doc.itens) ? doc.itens : []
  const total = num(doc.total_zeikomi ?? doc.total ?? doc.total_pago)
  const head = [
    [t('docView.number'), doc.numero],
    [t('common.supplier'), doc.fornecedor],
    [t('docView.client'), doc.cliente],
    [t('docView.issued'), doc.data_emissao && fmtDate(doc.data_emissao)],
    [t('docView.due'), doc.vencimento && fmtDate(doc.vencimento)],
    [t('docView.beforeTax'), num(doc.zeibetsu) != null && fmtYen(num(doc.zeibetsu))],
    [t('docView.tax'), num(doc.consumo) != null && fmtYen(num(doc.consumo))],
  ].filter(([, v]) => v)
  return (
    <>
      {total != null && <div className="doc-view-total">{fmtYen(total)}</div>}
      <dl className="doc-view-head">
        {head.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {items.length > 0 && (
        <table className="doc-view-items">
          <thead><tr><th>{t('common.product')}</th><th>{t('common.qty')}</th><th>{t('docView.unit')}</th><th>{t('docView.amount')}</th></tr></thead>
          <tbody>
            {items.map((it, i) => {
              const qtd = num(it.qtd) ?? 0
              const unit = num(it.zeikomi ?? it.custo_unitario ?? it.preco) ?? 0
              return (
                <tr key={i}>
                  <td>{it.nome || '—'}</td>
                  <td>{qtd}</td>
                  <td>{fmtYen(unit)}</td>
                  <td>{fmtYen(qtd * unit)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {doc.notas && <p className="doc-view-notes">{doc.notas}</p>}
    </>
  )
}

/** Shows a saved supplier document inside the app (invoice JSON as a table, images and PDFs as they are). */
export default function DocViewer({ url, title, onClose }) {
  const { t } = useI18n()
  const kind = kindOf(url)
  const [state, setState] = useState({ loading: kind === 'text' })

  useEffect(() => {
    if (kind !== 'text') return
    let alive = true
    loadText(url)
      .then(r => alive && setState(r))
      .catch(e => alive && setState({ error: e.message }))
    return () => { alive = false }
  }, [url, kind])

  return (
    <div className="pay-pop-back" onClick={onClose} role="presentation">
      <div className="pay-pop doc-view" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="pay-pop-kicker">{t('docView.kicker')}</div>
        {title && <div className="pay-pop-title">{title}</div>}
        <div className="doc-view-body">
          {kind === 'image' && <img src={url} alt="" />}
          {kind === 'pdf' && <iframe src={url} title={title || 'PDF'} />}
          {kind === 'text' && state.loading && <div className="doc-view-muted">{t('common.loading')}</div>}
          {kind === 'text' && state.error && <div className="pay-pop-err">{t('docView.error')}</div>}
          {kind === 'text' && state.json && <InvoiceJson doc={state.json} />}
          {kind === 'text' && state.text != null && <pre className="doc-view-pre">{state.text}</pre>}
          {kind === 'other' && <div className="doc-view-muted">{t('docView.noPreview')}</div>}
        </div>
        <div className="pay-pop-actions">
          <a className="doc-view-open" href={url} target="_blank" rel="noreferrer">{t('docView.openFile')}</a>
          <button type="button" className="btn-primary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  )
}
