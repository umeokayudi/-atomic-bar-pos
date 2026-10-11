import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { schemaMissing } from '../lib/fulfillment'
import { SOURCE_TYPES } from '../lib/procurementCore'
import { fmtYen } from './utils'
import { AdminPage, PortalSurface, PortalKpi, PortalPills } from './ui/PageLayout'
import Icon from './ui/Icon'

const LANES = [
  ['late', 'late'],
  ['due_today', 'dueToday'],
  ['due_tomorrow', 'dueTomorrow'],
  ['waiting_purchase', 'waitingPurchase'],
  ['waiting_supplier', 'waitingSupplier'],
  ['waiting_employee', 'waitingEmployee'],
  ['purchased', 'purchased'],
  ['in_transit', 'inTransit'],
  ['awaiting_receipt', 'awaitingReceipt'],
  ['problem', 'problem'],
  ['delivery_today', 'deliveryToday'],
  ['incomplete', 'incomplete'],
]

// Lanes that need someone to act: highlighted when they hold anything.
const ALERT_LANES = new Set(['late', 'problem', 'incomplete'])

// ISO weekdays, as stored in procurement_sources.delivery_days ("1,2,3,4,5").
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

function count(board, key) {
  const value = board?.[key]
  return Array.isArray(value) ? value.length : 0
}

export default function ProcurementBoard() {
  const { perfil } = useAuth()
  if (perfil?.role === 'funcionario') return <MyTasks />
  return <HqBoard />
}

function MyTasks() {
  const { t } = useI18n()
  const [pack, setPack] = useState({ tasks: [], locations: [] })
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)
  const [open, setOpen] = useState(null)
  const [form, setForm] = useState({ quantity: '', external_reference: '', receipt_note: '' })
  const [locationId, setLocationId] = useState('')
  const [receiveQty, setReceiveQty] = useState('')

  async function load() {
    const { data, error } = await supabase.rpc('get_my_procurement_tasks')
    if (error && schemaMissing(error)) {
      setMissing(true)
      return
    }
    if (error) {
      setErr(error.message)
      return
    }
    setPack(data || { tasks: [], locations: [] })
  }

  useEffect(() => { load() }, [])

  async function buy(task) {
    setErr('')
    const { error } = await supabase.rpc('record_purchase', {
      p_task_id: task.id,
      p_payload: {
        quantity: +form.quantity || undefined,
        external_reference: form.external_reference,
        receipt_note: form.receipt_note,
        purchased_at: new Date().toISOString(),
      },
    })
    if (error) setErr(error.message)
    else {
      setOpen(null)
      load()
    }
  }

  async function receive(task) {
    setErr('')
    const { error } = await supabase.rpc('receive_procurement', {
      p_task_id: task.id,
      p_location_id: locationId,
      p_qty: +receiveQty,
      p_note: null,
    })
    if (error) setErr(error.message)
    else load()
  }


  const tasks = pack.tasks || []
  return (
    <AdminPage title={t('procurement.myTasks')} subtitle={missing ? undefined : t('procurement.myTasksSub')}>
      {missing ? <ProcEmpty /> : (
        <>
          {err && <ProcError>{err}</ProcError>}
          {tasks.length === 0 ? (
            <div className="ui-empty">
              <Icon name="procurement" size={22} />
              <div className="ui-empty-title">{t('procurement.noTasks')}</div>
            </div>
          ) : (
            <div className="proc-stack">
              {tasks.map(task => (
                <PortalSurface
                  key={task.id}
                  title={task.task_number}
                  sub={`${task.source_name || '—'} · ${task.method || '—'}`}
                  headerRight={<StatusBadge status={task.status} />}
                >
                  <div className="proc-stats">
                    <Stat label={t('procurement.bought')} value={`${task.quantity_purchased ?? 0} / ${task.quantity_allocated ?? 0}`} />
                    <Stat label={t('procurement.expectedCost')} value={task.expected_unit_cost == null ? '—' : fmtYen(task.expected_unit_cost)} />
                  </div>

                  <div className="proc-actions">
                    {task.purchase_url && (
                      <a className="ui-btn" href={task.purchase_url} target="_blank" rel="noreferrer">
                        <Icon name="next" size={16} />{t('procurement.openLink')}
                      </a>
                    )}
                    <button type="button" className="ui-btn is-primary" aria-pressed={open?.id === task.id} onClick={() => setOpen(task)}>
                      {t('procurement.recordPurchase')}
                    </button>
                  </div>

                  {open?.id === task.id && (
                    <div className="proc-step">
                      <div className="proc-step-title">{t('procurement.purchaseStep')}</div>
                      <div className="grid3">
                        <Field label={t('procurement.qty')}>
                          <input type="number" inputMode="decimal" min="0" step="any" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
                        </Field>
                        <Field label={t('procurement.reference')}>
                          <input value={form.external_reference} onChange={e => setForm({ ...form, external_reference: e.target.value })} />
                        </Field>
                        <Field label={t('procurement.receipt')}>
                          <input value={form.receipt_note} onChange={e => setForm({ ...form, receipt_note: e.target.value })} />
                        </Field>
                      </div>
                      <div className="proc-actions">
                        <button type="button" className="btn-primary" onClick={() => buy(task)}>{t('procurement.savePurchase')}</button>
                      </div>
                    </div>
                  )}

                  <div className="proc-step">
                    <div className="proc-step-title">{t('procurement.receiveStep')}</div>
                    <div className="grid2">
                      <Field label={t('procurement.location')}>
                        <select value={locationId} onChange={e => setLocationId(e.target.value)}>
                          <option value="">{t('procurement.choose')}</option>
                          {(pack.locations || []).map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                        </select>
                      </Field>
                      <Field label={t('procurement.qty')}>
                        <input type="number" inputMode="decimal" min="0" step="any" value={receiveQty} onChange={e => setReceiveQty(e.target.value)} />
                      </Field>
                    </div>
                    <div className="proc-actions">
                      <button type="button" className="ui-btn" onClick={() => receive(task)}>
                        <Icon name="warehouse" size={16} />{t('procurement.receiveWarehouse')}
                      </button>
                    </div>
                  </div>
                </PortalSurface>
              ))}
            </div>
          )}
        </>
      )}
    </AdminPage>
  )
}

function HqBoard() {
  const { t } = useI18n()
  const [board, setBoard] = useState(null)
  const [tasks, setTasks] = useState([])
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [bars, setBars] = useState([])
  const [sources, setSources] = useState([])
  const [locations, setLocations] = useState([])
  const [shipments, setShipments] = useState([])
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)
  const [view, setView] = useState('work')
  const [sourceForm, setSourceForm] = useState({ name: '', type: 'ONLINE', purchase_url: '', default_lead_time_hours: '', cutoff_time: '', delivery_days: '1,2,3,4,5' })
  const [linkForm, setLinkForm] = useState({ source_id: '', product_id: '', purchase_price: '', minimum_quantity: '1', available_qty: '', lead_time_hours: '', is_primary: true })
  const [priceForm, setPriceForm] = useState({ bar_id: '', product_id: '', sale_price: '', minimum_quantity: '1' })
  const [placeForm, setPlaceForm] = useState({ name: '', type: 'WAREHOUSE' })
  const [settings, setSettings] = useState({ safety_buffer_hours: '0', default_transport_hours: '0', default_warehouse_hours: '0', default_prep_hours: '0' })
  const [ship, setShip] = useState({ from_location_id: '', to_location_id: '', task_id: '', quantity: '', carrier: '' })
  const [econ, setEcon] = useState(null)

  async function load() {
    const boardRes = await supabase.rpc('get_procurement_board')
    if (boardRes.error && schemaMissing(boardRes.error)) {
      setMissing(true)
      return
    }
    if (boardRes.error) setErr(boardRes.error.message)
    else setBoard(boardRes.data)
    const taskRes = await supabase.rpc('get_procurement_tasks_hq')
    if (taskRes.error && !schemaMissing(taskRes.error)) setErr(taskRes.error.message)
    setTasks(Array.isArray(taskRes.data) ? taskRes.data : [])
    const [orderRes, productRes, barRes, sourceRes, locRes, setRes, shipRes] = await Promise.all([
      supabase.from('pedidos').select('id,public_code,status,bar_id').order('criado_em', { ascending: false }).limit(20),
      supabase.from('produtos').select('id,nome').eq('ativo', true).order('nome').limit(200),
      supabase.from('bars').select('id,nome').order('nome'),
      supabase.from('procurement_sources').select('id,name,type,active').order('name'),
      supabase.from('locations').select('id,name,type').eq('active', true).order('name'),
      supabase.from('procurement_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('shipments').select('id,public_code,status,order_id').order('created_at', { ascending: false }).limit(20),
    ])
    setOrders(orderRes.data || [])
    setProducts(productRes.data || [])
    setBars(barRes.data || [])
    setSources(sourceRes.data || [])
    setLocations(locRes.data || [])
    setShipments(shipRes.data || [])
    if (setRes.data) {
      setSettings({
        safety_buffer_hours: String(setRes.data.safety_buffer_hours ?? 0),
        default_transport_hours: String(setRes.data.default_transport_hours ?? 0),
        default_warehouse_hours: String(setRes.data.default_warehouse_hours ?? 0),
        default_prep_hours: String(setRes.data.default_prep_hours ?? 0),
      })
    }
  }

  useEffect(() => { load() }, [])

  async function addSource(e) {
    e.preventDefault()
    const { error } = await supabase.from('procurement_sources').insert({
      name: sourceForm.name.trim(),
      type: sourceForm.type,
      purchase_url: sourceForm.purchase_url || null,
      default_lead_time_hours: sourceForm.default_lead_time_hours === '' ? null : +sourceForm.default_lead_time_hours,
      cutoff_time: sourceForm.cutoff_time || null,
      delivery_days: sourceForm.delivery_days || null,
      active: true,
    })
    if (error) setErr(error.message)
    else load()
  }

  async function linkProduct(e) {
    e.preventDefault()
    const { error: productError } = await supabase.from('procurement_source_products').upsert({
      source_id: linkForm.source_id,
      product_id: linkForm.product_id,
      purchase_price: linkForm.purchase_price === '' ? null : +linkForm.purchase_price,
      minimum_quantity: +linkForm.minimum_quantity || 1,
      available_qty: linkForm.available_qty === '' ? null : +linkForm.available_qty,
      lead_time_hours: linkForm.lead_time_hours === '' ? null : +linkForm.lead_time_hours,
      available: true,
      active: true,
    }, { onConflict: 'source_id,product_id' })
    if (productError) {
      setErr(productError.message)
      return
    }
    const { error } = await supabase.from('procurement_routing_rules').upsert({
      source_id: linkForm.source_id,
      product_id: linkForm.product_id,
      is_primary: !!linkForm.is_primary,
      is_backup: !linkForm.is_primary,
      active: true,
    }, { onConflict: 'product_id,source_id' })
    if (error) setErr(error.message)
    else load()
  }

  async function savePrice(e) {
    e.preventDefault()
    const { error } = await supabase.from('bar_product_prices').insert({
      bar_id: priceForm.bar_id,
      product_id: priceForm.product_id,
      sale_price: +priceForm.sale_price,
      minimum_quantity: +priceForm.minimum_quantity || 1,
      active: true,
    })
    if (error) setErr(error.message)
    else load()
  }

  async function addPlace(e) {
    e.preventDefault()
    const { error } = await supabase.from('locations').insert({ name: placeForm.name.trim(), type: placeForm.type, active: true })
    if (error) setErr(error.message)
    else load()
  }

  async function saveSettings(e) {
    e.preventDefault()
    const { error } = await supabase.from('procurement_settings').update({
      safety_buffer_hours: +settings.safety_buffer_hours || 0,
      default_transport_hours: +settings.default_transport_hours || 0,
      default_warehouse_hours: +settings.default_warehouse_hours || 0,
      default_prep_hours: +settings.default_prep_hours || 0,
      updated_at: new Date().toISOString(),
    }).eq('id', 1)
    if (error) setErr(error.message)
  }

  async function plan(orderId) {
    setErr('')
    const { error } = await supabase.rpc('plan_procurement', { p_order_id: orderId, p_need: null })
    if (error) setErr(error.message)
    else load()
  }

  async function act(name, args) {
    setErr('')
    const { error } = await supabase.rpc(name, args)
    if (error) setErr(error.message)
    else load()
  }


  if (missing) {
    return (
      <AdminPage title={t('procurement.title')} subtitle={t('procurement.subtitle')}>
        <ProcEmpty />
      </AdminPage>
    )
  }

  const economics = board?.economics
  const realCost = economics
    ? (+economics.purchase_cost || 0) + (+economics.freight || 0) + (+economics.fees || 0) + (+economics.logistics_cost || 0)
    : 0
  const margin = +economics?.margin || 0

  return (
    <AdminPage
      wide
      title={t('procurement.title')}
      subtitle={t('procurement.subtitle')}
      actions={(
        <button type="button" className="ui-btn" onClick={() => load()}>
          <Icon name="refresh" size={16} />{t('procurement.refresh')}
        </button>
      )}
    >
      {err && <ProcError>{err}</ProcError>}

      {economics && (
        <div className="proc-kpis">
          <PortalKpi icon="trendUp" tone="success" label={t('procurement.revenue')} value={fmtYen(economics.revenue)} sub={t('procurement.revenueSub')} />
          <PortalKpi icon="trendDown" tone="danger" label={t('procurement.realCost')} value={fmtYen(realCost)} sub={t('procurement.realCostSub')} />
          <PortalKpi
            icon="coins"
            tone={margin >= 0 ? 'success' : 'danger'}
            label={t('procurement.margin')}
            value={fmtYen(margin)}
            color={margin >= 0 ? 'var(--green)' : 'var(--red)'}
            sub={t('procurement.marginSub')}
          />
        </div>
      )}

      {board && (
        <PortalSurface title={t('procurement.board')} sub={t('procurement.boardSub')} style={{ marginBottom: 16 }}>
          <div className="proc-lane-grid">
            {LANES.map(([key, label]) => {
              const n = count(board, key)
              const hot = n > 0 && ALERT_LANES.has(key)
              return (
                <div key={key} className={`proc-lane${n === 0 ? ' is-zero' : ''}${hot ? ' is-hot' : ''}`}>
                  <span className="proc-lane-label">{t(`procurement.lane.${label}`)}</span>
                  <strong className="proc-lane-value">{n}</strong>
                </div>
              )
            })}
          </div>
        </PortalSurface>
      )}

      <div className="proc-tabs">
        <PortalPills
          value={view}
          onChange={setView}
          options={[['work', t('procurement.viewWork')], ['setup', t('procurement.viewSetup')]]}
        />
      </div>

      {view === 'work' && (
        <div className="proc-stack">
          <PortalSurface title={t('procurement.orders')} sub={t('procurement.ordersSub')}>
            {orders.length === 0 ? <ProcNone>{t('procurement.noOrders')}</ProcNone> : (
              <div className="proc-rows">
                {orders.map(order => (
                  <div key={order.id} className="proc-row">
                    <div className="proc-row-main">
                      <strong>{order.public_code || String(order.id).slice(0, 8)}</strong>
                      <StatusBadge status={order.status} />
                    </div>
                    <button type="button" className="ui-btn is-sm" onClick={() => plan(order.id)}>{t('procurement.plan')}</button>
                  </div>
                ))}
              </div>
            )}
          </PortalSurface>

          <PortalSurface title={t('procurement.tasks')} sub={t('procurement.tasksSub')}>
            {tasks.length === 0 ? <ProcNone>{t('procurement.noTasksHq')}</ProcNone> : (
              <div className="proc-task-list">
                {tasks.map(task => (
                  <article key={task.id} className="proc-task">
                    <div className="proc-task-head">
                      <div className="proc-task-title">
                        <strong>{task.task_number}</strong>
                        <span className="proc-muted">{task.source_company || task.procurement_method}</span>
                      </div>
                      <div className="proc-badges">
                        {task.late && <span className="ui-badge is-danger">{t('procurement.lateBadge')}</span>}
                        <StatusBadge status={task.status} />
                      </div>
                    </div>
                    <div className="proc-stats">
                      <Stat label={t('procurement.bought')} value={`${task.quantity_purchased ?? 0} / ${task.quantity_allocated ?? 0}`} />
                      <Stat label={t('procurement.receivedQty')} value={task.quantity_received ?? 0} />
                      <Stat label={t('procurement.atBar')} value={task.quantity_at_bar ?? 0} />
                      {econ?.task_id === task.id && (
                        <>
                          <Stat label={t('procurement.realCost')} value={fmtYen(econ.real_cost)} />
                          <Stat label={t('procurement.margin')} value={fmtYen(econ.margin)} tone={+econ.margin >= 0 ? 'good' : 'bad'} />
                        </>
                      )}
                    </div>
                    {['delivered', 'in_transit', 'partial'].includes(task.supplier_assignment_status) && task.quantity_received === 0 && (
                      <div className="proc-note"><Icon name="warning" size={14} />{t('procurement.supplierMarkedNotStock')}</div>
                    )}
                    <div className="proc-actions">
                      <button type="button" className="ui-btn is-sm" onClick={async () => {
                        const { data, error } = await supabase.rpc('task_economics', { p_task_id: task.id })
                        if (error) setErr(error.message)
                        else setEcon(data)
                      }}><Icon name="coins" size={14} />{t('procurement.margin')}</button>
                      <button type="button" className="ui-btn is-sm" onClick={() => act('fallback_task', { p_task_id: task.id })}>{t('procurement.fallback')}</button>
                      {(task.quantity_allocated - task.quantity_purchased) > 0 && (
                        <button type="button" className="ui-btn is-sm" onClick={() => act('release_open_quantity', { p_task_id: task.id, p_qty: task.quantity_allocated - task.quantity_purchased })}>{t('procurement.releaseOpen')}</button>
                      )}
                      <button type="button" className="ui-btn is-sm is-danger" onClick={() => act('flag_deadline_exception', { p_task_id: task.id, p_note: null })}>{t('procurement.flagLate')}</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </PortalSurface>

          <PortalSurface title={t('procurement.shipments')} sub={t('procurement.shipmentsSub')}>
            {shipments.length === 0 ? <ProcNone>{t('procurement.noShipments')}</ProcNone> : (
              <div className="proc-rows">
                {shipments.map(row => (
                  <div key={row.id} className="proc-row">
                    <div className="proc-row-main">
                      <strong>{row.public_code}</strong>
                      <StatusBadge status={row.status} />
                    </div>
                    {row.status === 'planned' && <button type="button" className="ui-btn is-sm" onClick={() => act('advance_shipment', { p_shipment_id: row.id, p_action: 'depart' })}>{t('procurement.depart')}</button>}
                    {row.status === 'in_transit' && <button type="button" className="ui-btn is-sm is-primary" onClick={() => act('advance_shipment', { p_shipment_id: row.id, p_action: 'deliver' })}>{t('procurement.deliver')}</button>}
                  </div>
                ))}
              </div>
            )}
          </PortalSurface>

          <PortalSurface title={t('procurement.shipment')} sub={t('procurement.shipmentSub')}>
            <form className="proc-form-grid" onSubmit={e => {
              e.preventDefault()
              act('create_shipment', {
                p_payload: {
                  from_location_id: ship.from_location_id,
                  to_location_id: ship.to_location_id,
                  carrier: ship.carrier,
                  items: [{ task_id: ship.task_id, quantity: +ship.quantity }],
                },
              })
            }}>
              <div className="grid2">
                <Field label={t('procurement.from')}>
                  <select required value={ship.from_location_id} onChange={e => setShip({ ...ship, from_location_id: e.target.value })}>
                    <option value="">{t('procurement.choose')}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
                <Field label={t('procurement.to')}>
                  <select required value={ship.to_location_id} onChange={e => setShip({ ...ship, to_location_id: e.target.value })}>
                    <option value="">{t('procurement.choose')}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid3">
                <Field label={t('procurement.task')}>
                  <select required value={ship.task_id} onChange={e => setShip({ ...ship, task_id: e.target.value })}>
                    <option value="">{t('procurement.choose')}</option>
                    {tasks.map(task => <option key={task.id} value={task.id}>{task.task_number}</option>)}
                  </select>
                </Field>
                <Field label={t('procurement.qty')}>
                  <input required type="number" inputMode="decimal" min="0" step="any" value={ship.quantity} onChange={e => setShip({ ...ship, quantity: e.target.value })} />
                </Field>
                <Field label={t('procurement.carrier')}>
                  <input value={ship.carrier} onChange={e => setShip({ ...ship, carrier: e.target.value })} />
                </Field>
              </div>
              <div className="proc-actions is-end">
                <button type="submit" className="btn-primary">{t('procurement.createShipment')}</button>
              </div>
            </form>
          </PortalSurface>
        </div>
      )}

      {view === 'setup' && (
        <div className="proc-stack">
          <PortalSurface title={t('procurement.sources')} sub={t('procurement.sourcesSub')}>
            {sources.length === 0 ? <ProcNone>{t('procurement.noSources')}</ProcNone> : (
              <div className="proc-chips-list">
                {sources.map(s => (
                  <span key={s.id} className={`proc-tag${s.active === false ? ' is-off' : ''}`}>
                    <strong>{s.name}</strong>
                    <span className="proc-muted">{s.type}{s.active === false ? ` · ${t('procurement.inactive')}` : ''}</span>
                  </span>
                ))}
              </div>
            )}
          </PortalSurface>

          <PortalSurface title={t('procurement.addSource')}>
            <form className="proc-form-grid" onSubmit={addSource}>
              <div className="grid2">
                <Field label={t('procurement.name')}>
                  <input required value={sourceForm.name} onChange={e => setSourceForm({ ...sourceForm, name: e.target.value })} />
                </Field>
                <Field label={t('procurement.sourceType')}>
                  <select value={sourceForm.type} onChange={e => setSourceForm({ ...sourceForm, type: e.target.value })}>
                    {SOURCE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </Field>
              </div>
              <Field label={t('procurement.url')}>
                <input type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://" value={sourceForm.purchase_url} onChange={e => setSourceForm({ ...sourceForm, purchase_url: e.target.value })} />
              </Field>
              <div className="grid2">
                <Field label={t('procurement.lead')}>
                  <input type="number" inputMode="decimal" min="0" step="any" value={sourceForm.default_lead_time_hours} onChange={e => setSourceForm({ ...sourceForm, default_lead_time_hours: e.target.value })} />
                </Field>
                <Field label={t('procurement.cutoff')}>
                  <input type="time" value={sourceForm.cutoff_time} onChange={e => setSourceForm({ ...sourceForm, cutoff_time: e.target.value })} />
                </Field>
              </div>
              <div>
                <span className="form-label">{t('procurement.deliveryDays')}</span>
                <DayPicker value={sourceForm.delivery_days} onChange={v => setSourceForm({ ...sourceForm, delivery_days: v })} />
                <div className="proc-hint">{t('procurement.deliveryDaysHint')}</div>
              </div>
              <div className="proc-actions is-end">
                <button type="submit" className="btn-primary">{t('procurement.save')}</button>
              </div>
            </form>
          </PortalSurface>

          <PortalSurface title={t('procurement.linkProduct')} sub={t('procurement.linkSub')}>
            <form className="proc-form-grid" onSubmit={linkProduct}>
              <div className="grid2">
                <Field label={t('procurement.source')}>
                  <select required value={linkForm.source_id} onChange={e => setLinkForm({ ...linkForm, source_id: e.target.value })}>
                    <option value="">{t('procurement.choose')}</option>
                    {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label={t('procurement.product')}>
                  <select required value={linkForm.product_id} onChange={e => setLinkForm({ ...linkForm, product_id: e.target.value })}>
                    <option value="">{t('procurement.choose')}</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid4">
                <Field label={t('procurement.unitCost')}>
                  <input type="number" inputMode="decimal" min="0" step="any" placeholder="¥" value={linkForm.purchase_price} onChange={e => setLinkForm({ ...linkForm, purchase_price: e.target.value })} />
                </Field>
                <Field label={t('procurement.moq')}>
                  <input type="number" inputMode="numeric" min="1" step="1" value={linkForm.minimum_quantity} onChange={e => setLinkForm({ ...linkForm, minimum_quantity: e.target.value })} />
                </Field>
                <Field label={t('procurement.availableQty')}>
                  <input type="number" inputMode="numeric" min="0" step="any" value={linkForm.available_qty} onChange={e => setLinkForm({ ...linkForm, available_qty: e.target.value })} />
                </Field>
                <Field label={t('procurement.leadLink')}>
                  <input type="number" inputMode="decimal" min="0" step="any" value={linkForm.lead_time_hours} onChange={e => setLinkForm({ ...linkForm, lead_time_hours: e.target.value })} />
                </Field>
              </div>
              <label className="proc-check">
                <input type="checkbox" checked={linkForm.is_primary} onChange={e => setLinkForm({ ...linkForm, is_primary: e.target.checked })} />
                <span>
                  <strong>{linkForm.is_primary ? t('procurement.primary') : t('procurement.backup')}</strong>
                  <span className="proc-muted">{t('procurement.primaryHint')}</span>
                </span>
              </label>
              <div className="proc-actions is-end">
                <button type="submit" className="btn-primary">{t('procurement.save')}</button>
              </div>
            </form>
          </PortalSurface>

          <PortalSurface title={t('procurement.barPrice')} sub={t('procurement.barPriceSub')}>
            <form className="proc-form-grid" onSubmit={savePrice}>
              <div className="grid3">
                <Field label={t('procurement.bar')}>
                  <select required value={priceForm.bar_id} onChange={e => setPriceForm({ ...priceForm, bar_id: e.target.value })}>
                    <option value="">{t('procurement.choose')}</option>
                    {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
                  </select>
                </Field>
                <Field label={t('procurement.product')}>
                  <select required value={priceForm.product_id} onChange={e => setPriceForm({ ...priceForm, product_id: e.target.value })}>
                    <option value="">{t('procurement.choose')}</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </Field>
                <Field label={t('procurement.salePrice')}>
                  <input required type="number" inputMode="decimal" min="0" step="any" placeholder="¥" value={priceForm.sale_price} onChange={e => setPriceForm({ ...priceForm, sale_price: e.target.value })} />
                </Field>
              </div>
              <div className="proc-actions is-end">
                <button type="submit" className="btn-primary">{t('procurement.save')}</button>
              </div>
            </form>
          </PortalSurface>

          <PortalSurface title={t('procurement.locations')} sub={t('procurement.locationsSub')}>
            {locations.length === 0 ? <ProcNone>{t('procurement.noLocations')}</ProcNone> : (
              <div className="proc-chips-list" style={{ marginBottom: 16 }}>
                {locations.map(l => (
                  <span key={l.id} className="proc-tag">
                    <strong>{l.name}</strong>
                    <span className="proc-muted">{l.type}</span>
                  </span>
                ))}
              </div>
            )}
            <form className="proc-form-grid" onSubmit={addPlace}>
              <div className="grid2">
                <Field label={t('procurement.name')}>
                  <input required value={placeForm.name} onChange={e => setPlaceForm({ ...placeForm, name: e.target.value })} />
                </Field>
                <Field label={t('procurement.locationType')}>
                  <select value={placeForm.type} onChange={e => setPlaceForm({ ...placeForm, type: e.target.value })}>
                    {['WAREHOUSE', 'STORE', 'OTHER'].map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </Field>
              </div>
              <div className="proc-actions is-end">
                <button type="submit" className="btn-primary">{t('procurement.save')}</button>
              </div>
            </form>
          </PortalSurface>

          <PortalSurface title={t('procurement.timing')} sub={t('procurement.timingSub')}>
            <form className="proc-form-grid" onSubmit={saveSettings}>
              <div className="grid4">
                <Field label={t('procurement.buffer')}>
                  <input type="number" inputMode="decimal" min="0" step="any" value={settings.safety_buffer_hours} onChange={e => setSettings({ ...settings, safety_buffer_hours: e.target.value })} />
                </Field>
                <Field label={t('procurement.transport')}>
                  <input type="number" inputMode="decimal" min="0" step="any" value={settings.default_transport_hours} onChange={e => setSettings({ ...settings, default_transport_hours: e.target.value })} />
                </Field>
                <Field label={t('procurement.warehouseHours')}>
                  <input type="number" inputMode="decimal" min="0" step="any" value={settings.default_warehouse_hours} onChange={e => setSettings({ ...settings, default_warehouse_hours: e.target.value })} />
                </Field>
                <Field label={t('procurement.prep')}>
                  <input type="number" inputMode="decimal" min="0" step="any" value={settings.default_prep_hours} onChange={e => setSettings({ ...settings, default_prep_hours: e.target.value })} />
                </Field>
              </div>
              <div className="proc-actions is-end">
                <button type="submit" className="btn-primary">{t('procurement.save')}</button>
              </div>
            </form>
          </PortalSurface>
        </div>
      )}
    </AdminPage>
  )
}

/* ── Small presentational helpers ─────────────────────────────────────────── */

function ProcEmpty() {
  const { t } = useI18n()
  return (
    <div className="ui-empty proc-empty">
      <span className="ui-empty-icon"><Icon name="procurement" size={22} /></span>
      <div className="ui-empty-title">{t('procurement.emptyTitle')}</div>
      <div>{t('procurement.emptyBody')}</div>
    </div>
  )
}

function ProcError({ children }) {
  return <div className="proc-error" role="alert"><Icon name="warning" size={16} /><span>{children}</span></div>
}

function ProcNone({ children }) {
  return <div className="proc-none">{children}</div>
}

function Field({ label, children }) {
  return (
    <label className="proc-field">
      <span className="form-label">{label}</span>
      {children}
    </label>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className={`proc-stat${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const STATUS_TONE = {
  completed: 'success', delivered: 'success', received: 'success', entregue: 'success', purchased: 'info',
  in_transit: 'info', planned: 'accent', partial: 'warning', partially_received: 'warning',
  late: 'danger', problem: 'danger', cancelled: 'danger', cancelado: 'danger',
}

function StatusBadge({ status }) {
  if (!status) return null
  const tone = STATUS_TONE[status]
  return <span className={`ui-badge${tone ? ` is-${tone}` : ''}`}>{String(status).replace(/_/g, ' ')}</span>
}

/** Weekday chips that read and write the same "1,2,3,4,5" ISO string the text field used to take. */
function DayPicker({ value, onChange }) {
  const { t } = useI18n()
  const picked = new Set(String(value || '').split(/[^0-9]+/).map(Number).filter(n => n >= 1 && n <= 7))
  function toggle(day) {
    const next = new Set(picked)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    onChange([...next].sort((a, b) => a - b).join(','))
  }
  return (
    <div className="proc-days" role="group">
      {WEEKDAYS.map(day => (
        <button
          key={day}
          type="button"
          className={`proc-day${picked.has(day) ? ' is-on' : ''}`}
          aria-pressed={picked.has(day)}
          onClick={() => toggle(day)}
        >
          {t(`procurement.days.${day}`)}
        </button>
      ))}
    </div>
  )
}
