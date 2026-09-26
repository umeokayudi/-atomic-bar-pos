import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { schemaMissing } from '../lib/fulfillment'
import { AlertCard, AssignmentActions, IssueModal, OrderTimeline, StatusBadge } from './fulfillment/FulfillmentWidgets'

export default function SupplierPortal({ onSignOut }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [alerts, setAlerts] = useState([])
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)
  const [linked, setLinked] = useState(true)
  const [open, setOpen] = useState(null)
  const [track, setTrack] = useState(null)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState(false)
  const [taskCodes, setTaskCodes] = useState({})

  async function load() {
    setErr('')
    const link = await supabase.from('supplier_users').select('supplier_id').eq('user_id', user.id).eq('active', true)
    if (link.error && schemaMissing(link.error)) {
      setMissing(true)
      return
    }
    if (link.error) {
      setErr(link.error.message)
      return
    }
    if (!link.data?.length) {
      setLinked(false)
      setRows([])
      return
    }
    setLinked(true)
    const ids = link.data.map(r => r.supplier_id)
    const [aR, nR] = await Promise.all([
      supabase.from('order_supplier_assignments').select('id,order_id,status,expected_delivery_at,supplier_id').in('supplier_id', ids).order('assigned_at', { ascending: false }),
      supabase.from('fulfillment_alerts').select('*').eq('audience', 'supplier').in('supplier_id', ids).is('read_at', null).limit(20),
    ])
    if (aR.error) setErr(aR.error.message)
    setRows(aR.data || [])
    setAlerts(nR.data || [])
    const idsOnPage = (aR.data || []).map(row => row.id)
    if (idsOnPage.length) {
      const codes = await supabase.from('procurement_tasks').select('assignment_id,task_number').in('assignment_id', idsOnPage)
      if (!codes.error) {
        const map = {}
        for (const row of codes.data || []) map[row.assignment_id] = row.task_number
        setTaskCodes(map)
      }
    } else {
      setTaskCodes({})
    }
  }

  useEffect(() => { if (user?.id) load() }, [user?.id])

  async function openRow(row) {
    setOpen(row)
    setTrack(null)
    const { data, error } = await supabase.rpc('get_order_tracking', { p_order_id: row.order_id })
    if (error) setErr(error.message)
    else setTrack(data)
  }

  async function act(action, payload = {}, note = null) {
    if (!open) return
    setBusy(true)
    const { error } = await supabase.rpc('supplier_advance', {
      p_assignment_id: open.id,
      p_action: action,
      p_note: note,
      p_payload: payload,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else {
      setIssue(false)
      await load()
      openRow({ ...open, status: action })
    }
  }

  const mine = (track?.assignments || []).find(a => a.id === open?.id)

  return (
    <div className="ff-portal">
      <header className="ff-portal-bar">
        <strong>{t('fulfillment.supplierTitle')}</strong>
        <button type="button" onClick={onSignOut}>{t('common.signOut')}</button>
      </header>
      {missing && <p className="ff-miss">{t('fulfillment.schemaMissing')}</p>}
      {err && <p className="ff-miss">{err}</p>}
      {!linked && <p>{t('fulfillment.notLinked')}</p>}
      {alerts.map(a => <AlertCard key={a.id} alert={a} />)}
      <div className="ff-list">
        {rows.length === 0 && linked && !missing ? <p>{t('fulfillment.supplierEmpty')}</p> : rows.map(r => (
          <button key={r.id} type="button" className="ff-card" onClick={() => openRow(r)}>
            <strong>{taskCodes[r.id] || `#${String(r.order_id).slice(0, 8)}`}</strong>
            <StatusBadge status={r.status} />
            <em>{r.expected_delivery_at ? new Date(r.expected_delivery_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : ''}</em>
          </button>
        ))}
      </div>
      {open && track && (
        <section className="ff-detail">
          <StatusBadge status={mine?.status || open.status} />
          <OrderTimeline events={track.events} audience="supplier" />
          <ul>{(mine?.items || []).map(it => (
            <li key={it.order_item_id}>{it.product} · {it.quantity_requested}{it.quantity_confirmed != null ? ` → ${it.quantity_confirmed}` : ''}</li>
          ))}</ul>
          <AssignmentActions status={mine?.status || open.status} busy={busy} onAction={id => act(id)} />
          <button type="button" className="ord-ghost" onClick={() => setIssue(true)}>{t('fulfillment.issue')}</button>
          {(mine?.status || open.status) === 'pending' && (
            <button type="button" className="ord-ghost" onClick={() => act('reject')}>{t('fulfillment.reject')}</button>
          )}
        </section>
      )}
      {issue && mine && (
        <IssueModal
          items={mine.items || []}
          busy={busy}
          onClose={() => setIssue(false)}
          onSubmit={payload => act('issue', { lines: payload.lines, expected_delivery_at: payload.expected_delivery_at }, payload.note)}
        />
      )}
    </div>
  )
}
