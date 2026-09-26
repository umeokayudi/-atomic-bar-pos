import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { schemaMissing } from '../lib/fulfillment'
import { tokyoDateKey } from '../lib/tokyo'
import { routeItems } from '../lib/supplierRouting'
import { AdminPage, PortalKpi, PortalSurface } from './ui/PageLayout'
import {
  AlertCard, AssignmentActions, IssueModal, OrderTimeline, RoutingPreview, StatusBadge, SupplierSelector,
} from './fulfillment/FulfillmentWidgets'

const BUCKETS = [
  ['today', s => s.criado_em && tokyoDateKey(new Date(s.criado_em)) === tokyoDateKey()],
  ['waiting', s => s.ff === 'supplier_pending'],
  ['preparing', s => ['in_fulfillment', 'supplier_confirmed', 'ready_for_delivery'].includes(s.ff)],
  ['transit', s => s.ff === 'in_transit'],
  ['late', s => s.late],
  ['problems', s => s.ff === 'exception'],
  ['delivered', s => ['delivered', 'completed', 'partially_delivered'].includes(s.ff)],
]

export default function FulfillmentHq() {
  const { t } = useI18n()
  const [orders, setOrders] = useState([])
  const [alerts, setAlerts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [rules, setRules] = useState([])
  const [catalog, setCatalog] = useState([])
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [track, setTrack] = useState(null)
  const [busy, setBusy] = useState(false)
  const [issueFor, setIssueFor] = useState(null)
  const [ruleForm, setRuleForm] = useState({ product_id: '', supplier_id: '', is_primary: true })
  const [linkForm, setLinkForm] = useState({ email: '', supplier_id: '' })

  async function load() {
    setLoading(true)
    setErr('')
    const [pR, fR, aR, sR, ruleR, spR, prodR] = await Promise.all([
      supabase.from('pedidos').select('id,bar_id,status,total_estimado,criado_em,data_entrega_prevista,pedidos_itens(id,produto_id,qtd,produtos(nome))').order('criado_em', { ascending: false }).limit(80),
      supabase.from('pedido_fulfillment').select('pedido_id,status,updated_at'),
      supabase.from('fulfillment_alerts').select('*').eq('audience', 'jbm').is('read_at', null).order('created_at', { ascending: false }).limit(20),
      supabase.from('fornecedores').select('id,nome,email,ativo,default_lead_time_hours').order('nome'),
      supabase.from('supplier_routing_rules').select('*'),
      supabase.from('supplier_products').select('*'),
      supabase.from('produtos').select('id,nome').eq('ativo', true).order('nome').limit(200),
    ])
    const failed = [pR, fR, aR, sR, ruleR, spR].find(r => r.error)
    if (failed?.error && schemaMissing(failed.error)) {
      setMissing(true)
      setLoading(false)
      return
    }
    if (pR.error) {
      setErr(t('fulfillment.loadError', { message: pR.error.message }))
      setLoading(false)
      return
    }
    if (fR.error && !schemaMissing(fR.error)) setErr(t('fulfillment.loadError', { message: fR.error.message }))
    const ff = new Map((fR.data || []).map(r => [r.pedido_id, r.status]))
    setOrders((pR.data || []).map(o => ({
      ...o,
      ff: ff.get(o.id) || 'submitted',
      late: false,
    })))
    setAlerts(aR.error ? [] : (aR.data || []))
    setSuppliers(sR.data || [])
    setRules(ruleR.data || [])
    setCatalog(spR.data || [])
    setProducts(prodR.data || [])
    setMissing(false)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function open(id) {
    setOpenId(id)
    setTrack(null)
    const { data, error } = await supabase.rpc('get_order_tracking', { p_order_id: id })
    if (error) setErr(schemaMissing(error) ? t('fulfillment.schemaMissing') : error.message)
    else setTrack(data)
  }

  async function route(id) {
    setBusy(true)
    const { error } = await supabase.rpc('route_pedido', { p_order_id: id })
    setBusy(false)
    if (error) setErr(schemaMissing(error) ? t('fulfillment.schemaMissing') : error.message)
    else { await load(); if (openId === id) open(id) }
  }

  async function scan() {
    setBusy(true)
    const { error } = await supabase.rpc('scan_fulfillment_alerts')
    setBusy(false)
    if (error) setErr(schemaMissing(error) ? t('fulfillment.schemaMissing') : error.message)
    else load()
  }

  async function saveRule() {
    if (!ruleForm.product_id || !ruleForm.supplier_id) return
    setBusy(true)
    const { error } = await supabase.from('supplier_routing_rules').upsert({
      product_id: ruleForm.product_id,
      supplier_id: ruleForm.supplier_id,
      is_primary: !!ruleForm.is_primary,
      is_backup: !ruleForm.is_primary,
      active: true,
      priority: ruleForm.is_primary ? 10 : 20,
    }, { onConflict: 'product_id,supplier_id' })
    setBusy(false)
    if (error) setErr(error.message)
    else load()
  }

  async function linkUser() {
    setBusy(true)
    setErr('')
    const { data: perfil, error: pErr } = await supabase.from('perfis').select('id,role,email').eq('email', linkForm.email.trim()).maybeSingle()
    if (pErr || !perfil) {
      setErr(pErr?.message || t('fulfillment.linkHint'))
      setBusy(false)
      return
    }
    const { error } = await supabase.from('supplier_users').upsert({
      supplier_id: linkForm.supplier_id,
      user_id: perfil.id,
      role: 'staff',
      active: true,
    }, { onConflict: 'supplier_id,user_id' })
    setBusy(false)
    if (error) setErr(error.message)
  }

  const counts = useMemo(() => Object.fromEntries(BUCKETS.map(([id, pred]) => [id, orders.filter(pred).length])), [orders])
  const opened = orders.find(o => o.id === openId)
  const preview = opened ? routeItems({
    items: (opened.pedidos_itens || []).map(it => ({ ...it, nome: it.produtos?.nome })),
    rules, products: catalog, suppliers,
  }) : null

  if (missing) {
    return <AdminPage title={t('fulfillment.title')} subtitle={t('fulfillment.subtitle')}><p className="ff-miss">{t('fulfillment.schemaMissing')}</p></AdminPage>
  }

  return (
    <AdminPage title={t('fulfillment.title')} subtitle={t('fulfillment.subtitle')}>
      <p className="ff-note">{t('fulfillment.externalOff')}</p>
      {err && <p className="ff-miss">{err}</p>}
      <div className="ff-kpis">
        {BUCKETS.map(([id]) => <PortalKpi key={id} label={t(`fulfillment.${id}`)} value={String(counts[id] || 0)} />)}
      </div>
      <div className="ff-toolbar">
        <button type="button" className="btn-primary" disabled={busy} onClick={scan}>{t('fulfillment.scan')}</button>
      </div>
      {alerts.map(a => <AlertCard key={a.id} alert={a} />)}
      {loading ? <p>{t('common.loading')}</p> : orders.length === 0 ? <p>{t('fulfillment.noOrders')}</p> : (
        <div className="ff-list">
          {orders.map(o => (
            <button key={o.id} type="button" className="ff-card" onClick={() => open(o.id)}>
              <strong>#{o.id.slice(0, 8)}</strong>
              <StatusBadge status={o.ff} />
              <em>{o.data_entrega_prevista || ''}</em>
            </button>
          ))}
        </div>
      )}

      {opened && (
        <PortalSurface title={`#${opened.id.slice(0, 8)}`} style={{ marginTop: 16 }}>
          <StatusBadge status={track?.status || opened.ff} />
          <RoutingPreview plan={preview} />
          <button type="button" className="btn-primary" disabled={busy} onClick={() => route(opened.id)}>
            {busy ? t('fulfillment.routing') : t('fulfillment.route')}
          </button>
          {track && <OrderTimeline events={track.events} audience="jbm" />}
          {(track?.assignments || []).map(a => (
            <div key={a.id} className="ff-assign">
              <strong>{a.supplier_name}</strong>
              <StatusBadge status={a.status} />
              <ul>{(a.items || []).map(it => <li key={it.order_item_id}>{it.product} × {it.quantity_requested}{it.purchase_price != null ? ` · ¥${it.purchase_price}` : ''}</li>)}</ul>
              <AssignmentActions status={a.status} busy={busy} onAction={async (action) => {
                setBusy(true)
                const { error } = await supabase.rpc('supplier_advance', { p_assignment_id: a.id, p_action: action, p_note: null, p_payload: {} })
                setBusy(false)
                if (error) setErr(error.message)
                else open(opened.id)
              }} />
              <button type="button" className="ord-ghost" onClick={() => setIssueFor(a)}>{t('fulfillment.issue')}</button>
            </div>
          ))}
        </PortalSurface>
      )}

      <PortalSurface title={t('fulfillment.saveRule')} style={{ marginTop: 16 }}>
        <div className="ff-form">
          <select value={ruleForm.product_id} onChange={e => setRuleForm({ ...ruleForm, product_id: e.target.value })}>
            <option value="">—</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          <SupplierSelector suppliers={suppliers} value={ruleForm.supplier_id} onChange={id => setRuleForm({ ...ruleForm, supplier_id: id })} />
          <label className="ff-radio"><input type="checkbox" checked={ruleForm.is_primary} onChange={e => setRuleForm({ ...ruleForm, is_primary: e.target.checked })} /> {t('fulfillment.primary')}</label>
          <button type="button" className="btn-primary" disabled={busy} onClick={saveRule}>{t('fulfillment.saveRule')}</button>
        </div>
        <ul className="ff-rules">
          {rules.map(r => {
            const name = suppliers.find(s => s.id === r.supplier_id)?.nome || r.supplier_id.slice(0, 8)
            const prod = products.find(p => p.id === r.product_id)?.nome || r.product_id.slice(0, 8)
            return <li key={r.id}>{prod} · {name} · {r.is_primary ? t('fulfillment.primary') : t('fulfillment.backup')}</li>
          })}
        </ul>
      </PortalSurface>

      <PortalSurface title={t('fulfillment.linkUser')} style={{ marginTop: 16 }}>
        <p className="ff-note">{t('fulfillment.linkHint')}</p>
        <div className="ff-form">
          <input value={linkForm.email} placeholder="email" onChange={e => setLinkForm({ ...linkForm, email: e.target.value })} />
          <SupplierSelector suppliers={suppliers} value={linkForm.supplier_id} onChange={id => setLinkForm({ ...linkForm, supplier_id: id })} />
          <button type="button" className="btn-primary" disabled={busy} onClick={linkUser}>{t('fulfillment.linkUser')}</button>
        </div>
      </PortalSurface>

      {issueFor && (
        <IssueModal
          items={issueFor.items || []}
          busy={busy}
          onClose={() => setIssueFor(null)}
          onSubmit={async (payload) => {
            setBusy(true)
            const { error } = await supabase.rpc('supplier_advance', {
              p_assignment_id: issueFor.id,
              p_action: 'issue',
              p_note: payload.note,
              p_payload: { lines: payload.lines, expected_delivery_at: payload.expected_delivery_at },
            })
            setBusy(false)
            if (error) setErr(error.message)
            else { setIssueFor(null); open(opened.id) }
          }}
        />
      )}
    </AdminPage>
  )
}
