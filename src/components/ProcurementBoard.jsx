import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { schemaMissing } from '../lib/fulfillment'
import { SOURCE_TYPES } from '../lib/procurementCore'

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
    <div className="ff-portal">
      <h2>{t('procurement.myTasks')}</h2>
      {missing && <p className="ff-miss">{t('procurement.schemaMissing')}</p>}
      {err && <p className="ff-miss">{err}</p>}
      {tasks.length === 0 && !missing ? <p>{t('procurement.noTasks')}</p> : null}
      {tasks.map(task => (
        <article key={task.id} className="ff-card">
          <strong>{task.task_number}</strong>
          <span>{task.source_name} · {task.method}</span>
          <span>{task.quantity_purchased}/{task.quantity_allocated} · {task.status}</span>
          <span>{t('procurement.expectedCost')} {task.expected_unit_cost ?? '—'}</span>
          {task.purchase_url && <a href={task.purchase_url} target="_blank" rel="noreferrer">{t('procurement.openLink')}</a>}
          <button type="button" onClick={() => setOpen(task)}>{t('procurement.recordPurchase')}</button>
          {open?.id === task.id && (
            <div className="proc-form">
              <input placeholder={t('procurement.qty')} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
              <input placeholder={t('procurement.reference')} value={form.external_reference} onChange={e => setForm({ ...form, external_reference: e.target.value })} />
              <input placeholder={t('procurement.receipt')} value={form.receipt_note} onChange={e => setForm({ ...form, receipt_note: e.target.value })} />
              <button type="button" onClick={() => buy(task)}>{t('procurement.savePurchase')}</button>
            </div>
          )}
          <div className="proc-form">
            <select value={locationId} onChange={e => setLocationId(e.target.value)}>
              <option value="">{t('procurement.location')}</option>
              {(pack.locations || []).map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
            <input placeholder={t('procurement.qty')} value={receiveQty} onChange={e => setReceiveQty(e.target.value)} />
            <button type="button" onClick={() => receive(task)}>{t('procurement.receiveWarehouse')}</button>
          </div>
        </article>
      ))}
    </div>
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

  return (
    <div className="ff-portal">
      <h2>{t('procurement.title')}</h2>
      <p>{t('procurement.subtitle')}</p>
      {missing && <p className="ff-miss">{t('procurement.schemaMissing')}</p>}
      {err && <p className="ff-miss">{err}</p>}
      {board?.economics && (
        <p>
          {t('procurement.revenue')} {board.economics.revenue}
          {' · '}{t('procurement.realCost')} {(+board.economics.purchase_cost || 0) + (+board.economics.freight || 0) + (+board.economics.fees || 0) + (+board.economics.logistics_cost || 0)}
          {' · '}{t('procurement.margin')} {board.economics.margin}
        </p>
      )}
      {board && (
        <div className="proc-lanes">
          {LANES.map(([key, label]) => (
            <div key={key} className="ff-card">
              <em>{t(`procurement.lane.${label}`)}</em>
              <strong>{count(board, key)}</strong>
            </div>
          ))}
        </div>
      )}

      <section>
        <h3>{t('procurement.orders')}</h3>
        {orders.map(order => (
          <div key={order.id} className="ff-card">
            <strong>{order.public_code || String(order.id).slice(0, 8)}</strong>
            <span>{order.status}</span>
            <button type="button" onClick={() => plan(order.id)}>{t('procurement.plan')}</button>
          </div>
        ))}
      </section>

      <section>
        <h3>{t('procurement.shipments')}</h3>
        {shipments.map(row => (
          <div key={row.id} className="ff-card">
            <strong>{row.public_code}</strong>
            <span>{row.status}</span>
            {row.status === 'planned' && <button type="button" onClick={() => act('advance_shipment', { p_shipment_id: row.id, p_action: 'depart' })}>{t('procurement.depart')}</button>}
            {row.status === 'in_transit' && <button type="button" onClick={() => act('advance_shipment', { p_shipment_id: row.id, p_action: 'deliver' })}>{t('procurement.deliver')}</button>}
          </div>
        ))}
      </section>

      <section>
        <h3>{t('procurement.tasks')}</h3>
        {tasks.map(task => (
          <article key={task.id} className="ff-card">
            <strong>{task.task_number}</strong>
            <span>{task.source_company || task.procurement_method} · {task.status}{task.late ? ' · late' : ''}</span>
            <span>{task.quantity_purchased}/{task.quantity_allocated} · {t('procurement.atBar')} {task.quantity_at_bar}</span>
            <button type="button" onClick={async () => {
              const { data, error } = await supabase.rpc('task_economics', { p_task_id: task.id })
              if (error) setErr(error.message)
              else setEcon(data)
            }}>{t('procurement.margin')}</button>
            {econ?.task_id === task.id && (
              <span>
                {t('procurement.realCost')} {econ.real_cost} · {t('procurement.margin')} {econ.margin}
              </span>
            )}
            <button type="button" onClick={() => act('fallback_task', { p_task_id: task.id })}>{t('procurement.fallback')}</button>
            {(task.quantity_allocated - task.quantity_purchased) > 0 && (
              <button type="button" onClick={() => act('release_open_quantity', { p_task_id: task.id, p_qty: task.quantity_allocated - task.quantity_purchased })}>{t('procurement.releaseOpen')}</button>
            )}
            <button type="button" onClick={() => act('flag_deadline_exception', { p_task_id: task.id, p_note: null })}>{t('procurement.flagLate')}</button>
          </article>
        ))}
      </section>

      <form className="proc-form" onSubmit={addSource}>
        <h3>{t('procurement.addSource')}</h3>
        <input required placeholder={t('procurement.name')} value={sourceForm.name} onChange={e => setSourceForm({ ...sourceForm, name: e.target.value })} />
        <select value={sourceForm.type} onChange={e => setSourceForm({ ...sourceForm, type: e.target.value })}>
          {SOURCE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
        <input placeholder={t('procurement.url')} value={sourceForm.purchase_url} onChange={e => setSourceForm({ ...sourceForm, purchase_url: e.target.value })} />
        <input placeholder={t('procurement.lead')} value={sourceForm.default_lead_time_hours} onChange={e => setSourceForm({ ...sourceForm, default_lead_time_hours: e.target.value })} />
        <input placeholder="15:00" value={sourceForm.cutoff_time} onChange={e => setSourceForm({ ...sourceForm, cutoff_time: e.target.value })} />
        <input placeholder="1,2,3,4,5" value={sourceForm.delivery_days} onChange={e => setSourceForm({ ...sourceForm, delivery_days: e.target.value })} />
        <button type="submit">{t('procurement.save')}</button>
      </form>

      <form className="proc-form" onSubmit={linkProduct}>
        <h3>{t('procurement.linkProduct')}</h3>
        <select required value={linkForm.source_id} onChange={e => setLinkForm({ ...linkForm, source_id: e.target.value })}>
          <option value="">{t('procurement.source')}</option>
          {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select required value={linkForm.product_id} onChange={e => setLinkForm({ ...linkForm, product_id: e.target.value })}>
          <option value="">{t('procurement.product')}</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <input placeholder={t('procurement.unitCost')} value={linkForm.purchase_price} onChange={e => setLinkForm({ ...linkForm, purchase_price: e.target.value })} />
        <input placeholder={t('procurement.moq')} value={linkForm.minimum_quantity} onChange={e => setLinkForm({ ...linkForm, minimum_quantity: e.target.value })} />
        <input placeholder={t('procurement.availableQty')} value={linkForm.available_qty} onChange={e => setLinkForm({ ...linkForm, available_qty: e.target.value })} />
        <label><input type="checkbox" checked={linkForm.is_primary} onChange={e => setLinkForm({ ...linkForm, is_primary: e.target.checked })} /> {t('procurement.primary')}</label>
        <button type="submit">{t('procurement.save')}</button>
      </form>

      <form className="proc-form" onSubmit={savePrice}>
        <h3>{t('procurement.barPrice')}</h3>
        <select required value={priceForm.bar_id} onChange={e => setPriceForm({ ...priceForm, bar_id: e.target.value })}>
          <option value="">{t('procurement.bar')}</option>
          {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
        </select>
        <select required value={priceForm.product_id} onChange={e => setPriceForm({ ...priceForm, product_id: e.target.value })}>
          <option value="">{t('procurement.product')}</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <input required placeholder={t('procurement.salePrice')} value={priceForm.sale_price} onChange={e => setPriceForm({ ...priceForm, sale_price: e.target.value })} />
        <button type="submit">{t('procurement.save')}</button>
      </form>

      <form className="proc-form" onSubmit={addPlace}>
        <h3>{t('procurement.addLocation')}</h3>
        <input required placeholder={t('procurement.name')} value={placeForm.name} onChange={e => setPlaceForm({ ...placeForm, name: e.target.value })} />
        <select value={placeForm.type} onChange={e => setPlaceForm({ ...placeForm, type: e.target.value })}>
          {['WAREHOUSE', 'STORE', 'OTHER'].map(type => <option key={type} value={type}>{type}</option>)}
        </select>
        <button type="submit">{t('procurement.save')}</button>
      </form>

      <form className="proc-form" onSubmit={saveSettings}>
        <h3>{t('procurement.timing')}</h3>
        <input placeholder={t('procurement.buffer')} value={settings.safety_buffer_hours} onChange={e => setSettings({ ...settings, safety_buffer_hours: e.target.value })} />
        <input placeholder={t('procurement.transport')} value={settings.default_transport_hours} onChange={e => setSettings({ ...settings, default_transport_hours: e.target.value })} />
        <input placeholder={t('procurement.warehouseHours')} value={settings.default_warehouse_hours} onChange={e => setSettings({ ...settings, default_warehouse_hours: e.target.value })} />
        <input placeholder={t('procurement.prep')} value={settings.default_prep_hours} onChange={e => setSettings({ ...settings, default_prep_hours: e.target.value })} />
        <button type="submit">{t('procurement.save')}</button>
      </form>

      <form className="proc-form" onSubmit={e => {
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
        <h3>{t('procurement.shipment')}</h3>
        <select required value={ship.from_location_id} onChange={e => setShip({ ...ship, from_location_id: e.target.value })}>
          <option value="">{t('procurement.from')}</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select required value={ship.to_location_id} onChange={e => setShip({ ...ship, to_location_id: e.target.value })}>
          <option value="">{t('procurement.to')}</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select required value={ship.task_id} onChange={e => setShip({ ...ship, task_id: e.target.value })}>
          <option value="">{t('procurement.tasks')}</option>
          {tasks.map(task => <option key={task.id} value={task.id}>{task.task_number}</option>)}
        </select>
        <input required placeholder={t('procurement.qty')} value={ship.quantity} onChange={e => setShip({ ...ship, quantity: e.target.value })} />
        <input placeholder={t('procurement.carrier')} value={ship.carrier} onChange={e => setShip({ ...ship, carrier: e.target.value })} />
        <button type="submit">{t('procurement.createShipment')}</button>
      </form>
    </div>
  )
}
