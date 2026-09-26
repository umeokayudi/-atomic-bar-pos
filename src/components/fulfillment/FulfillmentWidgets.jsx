import { useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { BAR_STEPS, ISSUE_TYPES, actionsFor, stepState } from '../../lib/fulfillment'
import { fmtYen } from '../utils'

const ACTION_KEY = {
  accept: 'fulfillment.confirm',
  start_purchase: 'fulfillment.startPurchase',
  purchased: 'fulfillment.purchased',
  received: 'fulfillment.received',
  preparing: 'fulfillment.preparingBtn',
  ready: 'fulfillment.preparingBtn',
  in_transit: 'fulfillment.ship',
  delivered: 'fulfillment.deliveredBtn',
  reject: 'fulfillment.issue',
  partial: 'fulfillment.receivedPartial',
  issue: 'fulfillment.issue',
}

export function StatusBadge({ status }) {
  const { t } = useI18n()
  const key = `fulfillment.status.${status}`
  const label = t(key) === key ? (status || '—') : t(key)
  return <span className={`ff-badge ff-${status || 'submitted'}`}>{label}</span>
}

export function OrderTimeline({ events = [], audience = 'bar' }) {
  const { t } = useI18n()
  return (
    <ol className="ff-timeline">
      {BAR_STEPS.map(step => {
        const state = stepState(events, step)
        const hit = (events || []).find(e => e.event_type === step || (step === 'routed' && e.event_type === 'assigned'))
        return (
          <li key={step} className={`ff-step is-${state}`}>
            <span>{state === 'done' ? '✓' : state === 'now' ? '●' : '○'}</span>
            <div>
              <strong>{t(`fulfillment.step.${step}`)}</strong>
              {hit?.created_at && <em>{new Date(hit.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</em>}
              {audience !== 'bar' && hit?.note && <em>{hit.note}</em>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function FulfillmentProgress({ status }) {
  const at = Math.max(0, BAR_STEPS.indexOf(status === 'supplier_pending' ? 'routed' : status))
  const pct = Math.round((at / Math.max(BAR_STEPS.length - 1, 1)) * 100)
  return (
    <div className="ff-progress" aria-hidden="true">
      <i style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

export function OrderCard({ order, onOpen }) {
  const { t } = useI18n()
  return (
    <button type="button" className="ff-card" onClick={onOpen}>
      <div>
        <strong>#{String(order.id || '').slice(0, 8)}</strong>
        <StatusBadge status={order.fulfillment_status || order.status} />
      </div>
      <div>{order.total != null ? fmtYen(order.total) : ''}</div>
      <em>{order.data_entrega_prevista || t('fulfillment.track')}</em>
    </button>
  )
}

export function SupplierCard({ supplier, onEdit }) {
  return (
    <button type="button" className="ff-card" onClick={onEdit}>
      <strong>{supplier.nome}</strong>
      <em>{supplier.email || supplier.telefone || '—'}</em>
    </button>
  )
}

export function AlertCard({ alert }) {
  return (
    <article className="ff-alert">
      <strong>{alert.title}</strong>
      {alert.body && <p>{alert.body}</p>}
    </article>
  )
}

export function RoutingPreview({ plan }) {
  const { t } = useI18n()
  if (!plan) return null
  return (
    <div className="ff-preview">
      <div className="ff-kicker">{t('fulfillment.preview')}</div>
      {(plan.assignments || []).map(a => (
        <div key={a.supplier_id}>
          <strong>{a.supplier_name || a.supplier_id.slice(0, 8)}</strong>
          <ul>{a.items.map(it => <li key={it.order_item_id || it.produto_id}>{it.nome || it.produto_id} × {it.quantity}</li>)}</ul>
        </div>
      ))}
      {(plan.missed || []).map(it => (
        <p key={it.id || it.produto_id} className="ff-miss">{it.nome || t('fulfillment.noRule')}</p>
      ))}
    </div>
  )
}

export function SupplierSelector({ suppliers, value, onChange }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">—</option>
      {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
    </select>
  )
}

export function IssueModal({ items = [], onClose, onSubmit, busy }) {
  const { t } = useI18n()
  const [itemId, setItemId] = useState(items[0]?.order_item_id || '')
  const [qty, setQty] = useState('')
  const [issueType, setIssueType] = useState('out_of_stock')
  const [note, setNote] = useState('')
  const [eta, setEta] = useState('')
  const item = items.find(i => i.order_item_id === itemId)
  return (
    <div className="ord-modal-bg" onClick={onClose}>
      <div className="ord-modal" onClick={e => e.stopPropagation()}>
        <div className="ord-modal-title">{t('fulfillment.issueTitle')}</div>
        <label>{t('fulfillment.issue')}
          <select value={itemId} onChange={e => setItemId(e.target.value)}>
            {items.map(it => <option key={it.order_item_id} value={it.order_item_id}>{it.product} · {it.quantity_requested}</option>)}
          </select>
        </label>
        <p>{item ? `${item.quantity_requested}` : ''}</p>
        <label>{t('fulfillment.availableQty')}
          <input type="number" min="0" value={qty} onChange={e => setQty(e.target.value)} />
        </label>
        <label>{t('fulfillment.issueTitle')}
          <select value={issueType} onChange={e => setIssueType(e.target.value)}>
            {ISSUE_TYPES.map(id => <option key={id} value={id}>{t(`fulfillment.issueType.${id}`)}</option>)}
          </select>
        </label>
        <label>{t('fulfillment.issueNote')}
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <label>{t('fulfillment.newEta')}
          <input type="datetime-local" value={eta} onChange={e => setEta(e.target.value)} />
        </label>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => onSubmit({
          lines: [{
            order_item_id: itemId,
            quantity: qty === '' ? null : +qty,
            issue_type: issueType,
            issue_note: note,
          }],
          note,
          expected_delivery_at: eta ? new Date(eta).toISOString() : null,
        })}>{t('fulfillment.sendIssue')}</button>
      </div>
    </div>
  )
}

export function DeliveryConfirmation({ expected, onConfirm, busy, error }) {
  const { t } = useI18n()
  const [mode, setMode] = useState('received_all')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  return (
    <div className="ff-confirm">
      <div className="ff-kicker">{t('fulfillment.confirmReceipt')}</div>
      {[['received_all', 'fulfillment.receivedAll'], ['partial', 'fulfillment.receivedPartial'], ['not_received', 'fulfillment.receivedNone']].map(([id, key]) => (
        <label key={id} className="ff-radio"><input type="radio" checked={mode === id} onChange={() => setMode(id)} /> {t(key)}</label>
      ))}
      {mode === 'partial' && (
        <label>{t('fulfillment.receivedCount')}
          <input type="number" min="0" max={expected || undefined} value={qty} onChange={e => setQty(e.target.value)} />
          {expected != null && <em> / {expected}</em>}
        </label>
      )}
      <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={t('fulfillment.issueNote')} />
      {error && <p className="ff-miss">{error}</p>}
      <button type="button" className="btn-primary" disabled={busy} onClick={() => onConfirm({ status: mode, received: qty === '' ? null : +qty, note })}>
        {t('fulfillment.confirmReceipt')}
      </button>
    </div>
  )
}

export function AssignmentActions({ status, onAction, busy }) {
  const { t } = useI18n()
  const actions = actionsFor(status).filter(id => id !== 'issue' && id !== 'reject' && id !== 'partial')
  return (
    <div className="ff-actions">
      {actions.map(id => (
        <button key={id} type="button" className="btn-primary" disabled={busy} onClick={() => onAction(id)}>
          {t(ACTION_KEY[id] || id)}
        </button>
      ))}
    </div>
  )
}

export function actionLabelKey(id) {
  return ACTION_KEY[id] || id
}
