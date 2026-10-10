import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate, Spinner, isSupplierProduct, filterSupplierVendas, PedidoItemChip } from './utils'
import { fetchAllStockMovements, isRestockPedido } from '../lib/posSupply'
import { coalesceStockMoves, decorateStockList, deliveryNoteMoves, posPourMoves } from '../lib/barStock'
import { openOrders, receivedByProduct, receivedTimeline, restockSuggestions, supplyOverview } from '../lib/drinkSupply'
import { useI18n } from '../lib/i18n'
import { orderDetailsFromObs } from '../lib/orderMeta'
import { tokyoDateKey, tokyoMonthKey, tokyoWallToUtcMs } from '../lib/tokyo'
import { resolveSalePrice } from '../lib/procurementCore'
import { schemaMissing } from '../lib/fulfillment'
import { DeliveryConfirmation, OrderTimeline } from './fulfillment/FulfillmentWidgets'
import { shiftMonth } from '../lib/barCalendar'
import { PageHeader } from './ui/PageLayout'
import Icon from './ui/Icon'

const STATUS_PEDIDO = {
  pendente:   { labelKey: 'orderStatus.pendente',   color: 'var(--amber)', bg: 'var(--amber-bg)' },
  confirmado: { labelKey: 'orderStatus.confirmado', color: 'var(--blue)', bg: 'var(--blue-bg)' },
  entregue:   { labelKey: 'orderStatus.entregue',   color: 'var(--green)', bg: 'var(--green-bg)' },
  cancelado:  { labelKey: 'orderStatus.cancelado',  color: 'var(--red)', bg: 'var(--red-bg)' },
}
const TRACK = ['pendente', 'confirmado', 'entregue']

function Badge({ status }) {
  const { t } = useI18n()
  const s = STATUS_PEDIDO[status] || STATUS_PEDIDO.pendente
  return <span className="ord-badge" style={{ background: s.bg, color: s.color }}>{t(s.labelKey)}</span>
}

/** Sent → Confirmed by JBM → Arrived, so nobody has to read status names. */
function OrderProgress({ status }) {
  const { t } = useI18n()
  const at = TRACK.indexOf(status)
  return (
    <ol className="sup-progress" aria-label={t(STATUS_PEDIDO[status]?.labelKey || 'orderStatus.pendente')}>
      {TRACK.map((s, i) => (
        <li key={s} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
          <span aria-hidden="true">{i < at ? <Icon name="check" size={11} /> : i + 1}</span>{t(`supply.track.${s}`)}
        </li>
      ))}
    </ol>
  )
}

/**
 * Drink supply: the one place a bar orders drinks from JBM, follows them on the way and checks what arrived.
 * Replaces the separate Orders and Deliveries pages; /bar/entregas opens this on "Received".
 */
export default function BarOrdersTab({ bar, section: startAt = 'order', manager = true }) {
  const { t } = useI18n()
  const [step, setStep] = useState(startAt)
  const [produtos, setProdutos] = useState([])
  const [pedidos, setPedidos] = useState([])
  const [notes, setNotes] = useState([])
  const [stockList, setStockList] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [orderErr, setOrderErr] = useState('')
  const [sentMsg, setSentMsg] = useState('')
  const [qtyPopup, setQtyPopup] = useState(null)
  const [orderPreview, setOrderPreview] = useState(null)
  const [track, setTrack] = useState(null)
  const [trackErr, setTrackErr] = useState('')
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [qtyInput, setQtyInput] = useState('')
  const [items, setItems] = useState([])
  const [obs, setObs] = useState('')
  const [entrega, setEntrega] = useState('')
  const [entregaHora, setEntregaHora] = useState('18:00')
  const [barPrices, setBarPrices] = useState([])
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('all')
  const [mes, setMes] = useState(() => tokyoMonthKey())
  const [byProduct, setByProduct] = useState(false)

  useEffect(() => { setStep(startAt) }, [startAt])
  useEffect(() => { load() }, [bar]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const [pR, pedR, priceR, noteR] = await Promise.all([
      supabase.from('produtos_public').select('*').eq('ativo', true).order('categoria').order('nome'),
      supabase.from('pedidos').select('*, pedidos_itens(*, produtos(nome,preco_venda,categoria,volume_ml))').eq('bar_id', bar.id).order('criado_em', { ascending: false }).limit(120),
      supabase.from('bar_product_prices').select('product_id,sale_price,minimum_quantity,valid_from,valid_until,active').eq('bar_id', bar.id).eq('active', true),
      manager
        ? supabase.from('vendas').select('*, vendas_itens(*, produtos(*))').eq('bar_id', bar.id).order('data', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])
    const prods = (pR.data || []).filter(isSupplierProduct)
    const supplierNotes = filterSupplierVendas(noteR.data || [])
    setProdutos(prods)
    setPedidos(pedR.data || [])
    setNotes(supplierNotes)
    if (!priceR.error) setBarPrices(priceR.data || [])
    setLoading(false)
    if (manager) loadStock(prods, supplierNotes)
  }

  // Same stock count as the Stock page, only to suggest what to reorder; never blocks the page.
  async function loadStock(prods, supplierNotes) {
    try {
      const [moves, rR, pourR, pricingR] = await Promise.all([
        fetchAllStockMovements(supabase, bar.id, '*').catch(() => []),
        supabase.from('estoque_regras').select('*').eq('bar_id', bar.id),
        supabase.from('pos_vendas_itens').select('produto_id,nome,qtd,pos_venda_id'),
        supabase.from('bar_pricing').select('produto_id,drinks_por_garrafa').eq('bar_id', bar.id),
      ])
      const regras = {}
      ;(rR.data || []).forEach(r => { regras[r.produto_id] = r.minimo })
      const pricing = {}
      ;(pricingR.data || []).forEach(r => { pricing[r.produto_id] = { drinks_por_garrafa: +r.drinks_por_garrafa || 0 } })
      const all = coalesceStockMoves(moves || [], deliveryNoteMoves(supplierNotes), posPourMoves(pourR.data || [], pricing))
      setStockList(decorateStockList(prods, all, regras))
    } catch { setStockList([]) }
  }

  const today = tokyoDateKey()
  const thisMonth = tokyoMonthKey()
  const prevMonth = shiftMonth(thisMonth, -1)
  const restock = useMemo(() => restockSuggestions(stockList, pedidos), [stockList, pedidos])
  const overview = useMemo(() => supplyOverview({ pedidos, notes, restock, today, month: thisMonth }), [pedidos, notes, restock, today, thisMonth])
  const onTheWay = useMemo(() => openOrders(pedidos, today), [pedidos, today])
  const received = useMemo(() => receivedTimeline({ pedidos, notes, month: mes }), [pedidos, notes, mes])
  const receivedTotal = received.reduce((a, r) => a + r.total, 0)
  const productRows = useMemo(() => receivedByProduct(received), [received])

  function salePriceOf(product, qty) {
    if (!product) return 0
    const price = resolveSalePrice({
      prices: barPrices.filter(row => row.product_id === product.id).map(row => ({
        salePrice: +row.sale_price,
        minimumQuantity: row.minimum_quantity,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        active: row.active,
      })),
      catalogPrice: product.preco_venda,
      qty,
    })
    return price || 0
  }

  const totalOrder = items.reduce((a, it) => {
    const p = produtos.find(x => x.id === it.produto_id)
    return a + salePriceOf(p, it.qtd) * it.qtd
  }, 0)
  const bottleCount = items.reduce((a, it) => a + it.qtd, 0)

  const cats = useMemo(() => [...new Set(produtos.map(p => p.categoria).filter(Boolean))], [produtos])
  const q = search.trim().toLowerCase()
  const visible = produtos.filter(p => {
    if (cat !== 'all' && p.categoria !== cat) return false
    if (!q) return true
    return String(p.nome || '').toLowerCase().includes(q) || String(p.categoria || '').toLowerCase().includes(q)
  })

  const idempotencyKey = useRef('')

  async function enviarOrder() {
    if (items.length === 0) {
      setOrderErr(t('portal.orders.addOneItem'))
      return
    }
    setSaving(true)
    setOrderErr('')
    let need = null
    if (entrega) {
      const [y, m, d] = entrega.split('-').map(Number)
      const [hh, mm] = (entregaHora || '18:00').split(':').map(Number)
      need = new Date(tokyoWallToUtcMs(y, m, d, hh || 18, mm || 0)).toISOString()
    }
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID()
    const submitted = await supabase.rpc('submit_bar_order', {
      p_bar_id: bar.id,
      p_need: need,
      p_obs: obs.trim() || null,
      p_items: items.map(it => ({ produto_id: it.produto_id, qtd: it.qtd })),
      p_idempotency_key: idempotencyKey.current,
    })
    if (submitted.error) {
      setOrderErr(schemaMissing(submitted.error) ? t('procurement.notConfigured') : submitted.error.message)
      setSaving(false)
      return
    }

    const { data: admins } = await supabase.from('perfis').select('id').eq('role', 'admin')
    if (admins && admins.length > 0) {
      await supabase.from('notificacoes').insert(
        admins.map(adm => ({
          user_id: adm.id, tipo: 'pedido_novo',
          titulo: t('portal.orders.newOrderFrom', { bar: bar.nome }),
          mensagem: t('portal.orders.productsCount', { count: items.length, amount: '¥' + Math.round(totalOrder).toLocaleString('ja-JP') }),
        }))
      )
    }

    setSaving(false)
    idempotencyKey.current = ''
    setSentMsg(t('supply.sentMsg', { n: bottleCount }))
    setItems([]); setObs(''); setEntrega('')
    setStep('way')
    load()
  }

  function bumpQty(prodId, delta) {
    setItems(prev => {
      const cur = prev.find(i => i.produto_id === prodId)?.qtd || 0
      const n = Math.max(0, cur + delta)
      if (n <= 0) return prev.filter(i => i.produto_id !== prodId)
      if (prev.some(i => i.produto_id === prodId)) return prev.map(i => i.produto_id === prodId ? { ...i, qtd: n } : i)
      return [...prev, { produto_id: prodId, qtd: n }]
    })
  }

  function setQty(prodId, qtd) {
    const n = Math.max(0, +qtd || 0)
    setItems(prev => {
      if (n <= 0) return prev.filter(i => i.produto_id !== prodId)
      if (prev.some(i => i.produto_id === prodId)) return prev.map(i => i.produto_id === prodId ? { ...i, qtd: n } : i)
      return [...prev, { produto_id: prodId, qtd: n }]
    })
  }

  function addRestock(list) {
    setItems(prev => {
      const next = [...prev]
      for (const r of list) {
        if (!produtos.some(p => p.id === r.produto_id)) continue
        const i = next.findIndex(x => x.produto_id === r.produto_id)
        if (i >= 0) next[i] = { ...next[i], qtd: Math.max(next[i].qtd, r.qtd) }
        else next.push({ produto_id: r.produto_id, qtd: r.qtd })
      }
      return next
    })
  }

  async function openTracking(p) {
    setOrderPreview(p)
    setTrack(null)
    setTrackErr('')
    let res = await supabase.rpc('get_procurement_tracking', { p_order_id: p.id })
    if (res.error && schemaMissing(res.error)) {
      res = await supabase.rpc('get_order_tracking', { p_order_id: p.id })
    }
    if (res.error) setTrackErr(schemaMissing(res.error) ? t('fulfillment.schemaMissing') : res.error.message)
    else setTrack(res.data)
  }

  if (loading) return <Spinner text={t('portal.orders.loading')} />

  const steps = [
    {
      id: 'order', icon: 'purchases', n: 1, title: t('supply.stepOrder'),
      value: items.length ? t('supply.inCart', { n: bottleCount }) : overview.toOrder ? t('supply.lowCount', { n: overview.toOrder }) : t('supply.pickDrinks'),
      tone: overview.toOrder ? 'warning' : '',
    },
    {
      id: 'way', icon: 'entregas', n: 2, title: t('supply.stepWay'),
      value: overview.onTheWay ? t('supply.wayCount', { n: overview.onTheWay }) : t('supply.nothingWay'),
      sub: overview.late ? t('supply.lateCount', { n: overview.late }) : overview.nextArrival ? t('supply.nextArrival', { date: fmtDate(overview.nextArrival) }) : '',
      tone: overview.late ? 'danger' : '',
    },
    {
      id: 'received', icon: 'ok', n: 3, title: t('supply.stepReceived'),
      value: t('supply.receivedCount', { n: overview.receivedCount }),
      sub: t('supply.thisMonthTotal', { amount: fmtYen(overview.receivedTotal) }),
    },
  ]

  return (
    <div className="fade-in ord-page sup">
      <PageHeader title={t('supply.title')} subtitle={t('supply.lead')} />

      <div className="sup-steps" role="group" aria-label={t('supply.title')}>
        {steps.map(s => (
          <button key={s.id} type="button" aria-pressed={step === s.id} className={`sup-step${s.tone ? ` is-${s.tone}` : ''}`} onClick={() => setStep(s.id)}>
            <span className="sup-step-n" aria-hidden="true">{s.n}</span>
            <span className="sup-step-body">
              <span className="sup-step-title"><Icon name={s.icon} size={15} /> {s.title}</span>
              <strong>{s.value}</strong>
              {s.sub && <small>{s.sub}</small>}
            </span>
          </button>
        ))}
      </div>

      {sentMsg && step === 'way' && (
        <div className="ui-banner is-success" role="status">
          <span className="ui-banner-icon"><Icon name="ok" size={18} /></span>
          <div><strong>{sentMsg}</strong></div>
        </div>
      )}

      {step === 'order' && (
        <>
          {restock.length > 0 && (
            <section className="ui-card sup-restock" aria-label={t('supply.lowTitle')}>
              <div className="ui-card-head">
                <div>
                  <div className="ui-card-title"><Icon name="warning" size={16} /> {t('supply.lowTitle')}</div>
                  <p className="desk-note">{t('supply.lowLead')}</p>
                </div>
                <button type="button" className="ui-btn is-primary is-sm" onClick={() => addRestock(restock)}><Icon name="plus" size={14} /> {t('supply.addAll')}</button>
              </div>
              <ul className="sup-low">
                {restock.map(r => {
                  const inCart = items.find(i => i.produto_id === r.produto_id)?.qtd || 0
                  return (
                    <li key={r.produto_id}>
                      <span className="sup-low-name">{r.nome}</span>
                      <span className={`sup-low-left${r.stock <= 0 ? ' is-out' : ''}`}>{r.stock <= 0 ? t('supply.out') : t('supply.left', { n: r.stock, min: r.minimo })}</span>
                      <button type="button" className="ui-btn is-sm" aria-pressed={inCart > 0} onClick={() => addRestock([r])}>
                        {inCart ? <><Icon name="check" size={13} /> {inCart}</> : t('supply.addN', { n: r.qtd })}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <div className="ord-composer card">
            <div className="ord-composer-title">{t('portal.orders.newOrderJbm')}</div>
            <div className="ord-composer-hint">{t('portal.orders.supplierListHint')}</div>

            <input
              className="ord-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('portal.orders.searchProducts')}
            />
            <div className="ord-row-scroll">
              <button type="button" className={`ord-chip${cat === 'all' ? ' is-on' : ''}`} onClick={() => setCat('all')}>{t('portal.orders.filterAll')}</button>
              {cats.map(c => (
                <button key={c} type="button" className={`ord-chip${cat === c ? ' is-on' : ''}`} onClick={() => setCat(c)}>{c}</button>
              ))}
            </div>

            <div className="ord-grid">
              {visible.map(p => {
                const item = items.find(i => i.produto_id === p.id)
                return (
                  <div key={p.id} className={`ord-tile${item ? ' is-on' : ''}`}>
                    <button type="button" className="ord-tile-hit" onClick={() => bumpQty(p.id, 1)}>
                      <span className="ord-tile-name">{p.nome}</span>
                      <span className="ord-tile-cat">{p.categoria}{p.volume_ml ? ` · ${p.volume_ml}ml` : ''}</span>
                    </button>
                    <div className="ord-tile-qty">
                      <button type="button" onClick={() => bumpQty(p.id, -1)} aria-label={t('staffOrder.less', { name: p.nome })}>−</button>
                      <button type="button" className="ord-tile-count" onClick={() => { setQtyPopup(p.id); setQtyInput(String(item?.qtd || 1)) }}>{item?.qtd || 0}</button>
                      <button type="button" onClick={() => bumpQty(p.id, 1)} aria-label={t('staffOrder.more', { name: p.nome })}>+</button>
                    </div>
                  </div>
                )
              })}
              {!visible.length && <p className="desk-note">{t('supply.noProducts')}</p>}
            </div>

            <div className="ord-meta-grid">
              <label>{t('portal.orders.deliveryDate')}
                <input type="date" value={entrega} onChange={e => setEntrega(e.target.value)} />
                <input type="time" value={entregaHora} onChange={e => setEntregaHora(e.target.value)} />
              </label>
            </div>
            <label className="ord-details-label">{t('portal.orders.details')}
              <textarea
                className="ord-details-input"
                rows={2}
                value={obs}
                onChange={e => setObs(e.target.value)}
                placeholder={t('portal.orders.notesPlaceholder')}
              />
            </label>

            {qtyPopup && (
              <div className="ord-modal-bg" onClick={() => setQtyPopup(null)}>
                <div className="ord-modal" onClick={e => e.stopPropagation()}>
                  <div className="ord-modal-title">{produtos.find(p => p.id === qtyPopup)?.nome}</div>
                  <div className="ord-composer-hint">{t('portal.orders.setQty')}</div>
                  <div className="ord-qty-row">
                    <button type="button" onClick={() => setQtyInput(v => String(Math.max(0, +v - 1)))}>−</button>
                    <input type="number" min="0" value={qtyInput} onChange={e => setQtyInput(e.target.value)} autoFocus />
                    <button type="button" onClick={() => setQtyInput(v => String(+v + 1))}>+</button>
                  </div>
                  <div className="ord-modal-actions">
                    <button type="button" className="ord-ghost danger" onClick={() => { setQty(qtyPopup, 0); setQtyPopup(null) }}>{t('portal.orders.remove')}</button>
                    <button type="button" className="btn-primary" onClick={() => { setQty(qtyPopup, +qtyInput); setQtyPopup(null) }}>{t('common.confirm')}</button>
                  </div>
                </div>
              </div>
            )}

            <div className="ord-sendbar">
              <div className="ord-send-kicker">{bottleCount} {t('portal.orders.items')}</div>
              <div className="ord-send-end">
                <div className="ord-send-total">{fmtYen(totalOrder)}</div>
                <button type="button" className="btn-primary ord-send-btn" onClick={enviarOrder} disabled={saving || items.length === 0}>
                  {saving ? t('portal.orders.sending') : t('portal.orders.sendOrder')}
                </button>
              </div>
            </div>
            {orderErr && <div className="pos-sale-err">{orderErr}</div>}
          </div>
        </>
      )}

      {step === 'way' && (
        onTheWay.length === 0 ? (
          <div className="ui-card ui-empty-state">
            <span className="ui-empty-icon"><Icon name="entregas" size={22} /></span>
            <p>{t('supply.wayEmpty')}</p>
            <button type="button" className="ui-btn is-primary" onClick={() => setStep('order')}><Icon name="plus" size={15} /> {t('supply.orderDrinks')}</button>
          </div>
        ) : (
          <div className="sup-list">
            {onTheWay.map(p => {
              const details = orderDetailsFromObs(p.obs)
              return (
                <article key={p.id} className={`ord-card sup-order${p.late ? ' is-late' : ''}`}>
                  <div className="ord-card-top">
                    <div>
                      <div className="ord-card-date">{t('supply.orderedOn', { date: fmtDate(p.criado_em?.slice(0, 10) || p.data_pedido) })}</div>
                      {p.data_entrega_prevista && (
                        <div className={`ord-card-sub${p.late ? ' sup-late' : ''}`}>
                          {p.late ? t('supply.lateSince', { date: fmtDate(String(p.data_entrega_prevista).slice(0, 10)) }) : t('portal.orders.expected', { date: fmtDate(String(p.data_entrega_prevista).slice(0, 10)) })}
                        </div>
                      )}
                      {isRestockPedido(p) && <div className="ord-restock">{t('portal.orders.restockFromCounter')}</div>}
                      {details && !isRestockPedido(p) && <div className="ord-details-box compact">{details}</div>}
                    </div>
                    <div className="ord-card-right"><span className="ord-send-total">{fmtYen(p.total_estimado || 0)}</span></div>
                  </div>
                  <OrderProgress status={p.status} />
                  <div className="ord-card-items">
                    {(p.pedidos_itens || []).map(it => (
                      <PedidoItemChip key={it.id} nome={it.produtos?.nome || '?'} qtd={it.qtd} precoUnitario={it.preco_unitario} hideCost />
                    ))}
                  </div>
                  <div className="ord-card-actions">
                    <button type="button" className="ui-btn is-sm is-primary" onClick={() => openTracking(p)}><Icon name="check" size={14} /> {t('supply.trackOrReceive')}</button>
                    {p.status === 'pendente' && (
                      <button type="button" className="ord-ghost danger" onClick={async () => {
                        if (!confirm(t('portal.orders.cancelConfirm'))) return
                        await supabase.from('pedidos_itens').delete().eq('pedido_id', p.id)
                        await supabase.from('pedidos').delete().eq('id', p.id)
                        setPedidos(prev => prev.filter(x => x.id !== p.id))
                      }}>{t('portal.orders.cancel')}</button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )
      )}

      {step === 'received' && (
        <>
          <div className="sup-filter">
            <div className="date-filter">
              <button type="button" className={`date-filter-chip${mes === thisMonth ? ' is-on' : ''}`} onClick={() => setMes(thisMonth)}>{t('portal.home.rangeMonth')}</button>
              <button type="button" className={`date-filter-chip${mes === prevMonth ? ' is-on' : ''}`} onClick={() => setMes(prevMonth)}>{t('portal.home.rangePrev')}</button>
              <button type="button" className={`date-filter-chip${!mes ? ' is-on' : ''}`} onClick={() => setMes('')}>{t('portal.home.rangeAll')}</button>
              <input type="month" value={mes} onChange={e => setMes(e.target.value)} aria-label={t('common.month')} />
            </div>
            <div className="ui-seg" role="radiogroup" aria-label={t('supply.view')}>
              <button type="button" role="radio" aria-checked={!byProduct} onClick={() => setByProduct(false)}>{t('supply.viewList')}</button>
              <button type="button" role="radio" aria-checked={byProduct} onClick={() => setByProduct(true)}>{t('supply.viewProduct')}</button>
            </div>
          </div>

          <section className="bill-match is-match sup-sum">
            <div className="bill-match-row"><span>{t('supply.receivedCount', { n: received.filter(r => r.kind !== 'cancelled').length })}</span><b>{fmtYen(receivedTotal)}</b></div>
            <p className="desk-note">{t(manager ? 'supply.receivedNote' : 'supply.receivedNoteStaff')}</p>
          </section>

          {byProduct ? (
            productRows.length === 0 ? <div className="ord-empty">{t('portal.orders.noOrdersMonth')}</div> : (
              <div className="ui-card table-scroll">
                <table className="sup-table">
                  <thead><tr><th>{t('portal.orders.colProduct')}</th><th className="num">{t('portal.orders.colQty')}</th><th className="num">{t('portal.orders.colTotal')}</th></tr></thead>
                  <tbody>{productRows.map(r => <tr key={r.nome}><td>{r.nome}</td><td className="num">{r.qtd}</td><td className="num">{fmtYen(r.total)}</td></tr>)}</tbody>
                  <tfoot><tr><td colSpan={2}>{t('common.total')}</td><td className="num">{fmtYen(productRows.reduce((a, r) => a + r.total, 0))}</td></tr></tfoot>
                </table>
              </div>
            )
          ) : received.length === 0 ? (
            <div className="ui-card ui-empty-state"><span className="ui-empty-icon"><Icon name="ok" size={22} /></span><p>{t('portal.deliveries.empty')}</p></div>
          ) : (
            <div className="sup-list">
              {received.map(r => (
                <article key={r.id} className={`ord-card sup-rcv is-${r.kind}`}>
                  <div className="ord-card-top">
                    <div>
                      <div className="ord-card-date">{fmtDate(r.date)}</div>
                      <div className="ord-card-sub">
                        {t(`supply.kind.${r.kind}`)}
                        {r.order && r.kind === 'note' ? ` · ${t('supply.fromOrder', { date: fmtDate(r.order.criado_em?.slice(0, 10) || r.order.data_pedido) })}` : ''}
                      </div>
                    </div>
                    <div className="ord-card-right">
                      {r.kind === 'cancelled' ? <Badge status="cancelado" /> : <span className="ord-send-total">{fmtYen(r.total)}</span>}
                    </div>
                  </div>
                  <div className="ord-card-items">
                    {r.items.map(it => <PedidoItemChip key={it.key} nome={it.nome} qtd={it.qtd} precoUnitario={it.preco} hideCost />)}
                  </div>
                  {r.order && r.kind !== 'cancelled' && (
                    <div className="ord-card-actions">
                      <button type="button" className="ord-ghost" onClick={() => openTracking(r.order)}>{t('fulfillment.track')}</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {orderPreview && (
        <div className="ord-modal-bg" onClick={() => setOrderPreview(null)}>
          <div className="ord-modal wide" onClick={e => e.stopPropagation()}>
            <div className="ord-card-top">
              <div>
                <div className="ord-modal-title">{t('portal.orders.detailsTitle')}</div>
                <div className="ord-card-sub">{fmtDate(orderPreview.criado_em?.slice(0, 10))}</div>
              </div>
              <Badge status={orderPreview.status} />
            </div>
            {orderPreview.status !== 'cancelado' && <OrderProgress status={orderPreview.status} />}
            {orderPreview.data_entrega_prevista && (
              <div className="ord-card-sub">{t('portal.orders.expected', { date: orderPreview.data_entrega_prevista })}</div>
            )}
            {isRestockPedido(orderPreview) && <div className="ord-restock">{t('portal.orders.restockFromCounter')}</div>}
            {orderDetailsFromObs(orderPreview.obs) && (
              <div className="ord-details-box">{orderDetailsFromObs(orderPreview.obs)}</div>
            )}
            <div className="ord-meta-label" style={{ marginTop: 16 }}>{t('portal.orders.items')}</div>
            {(orderPreview.pedidos_itens || []).map(it => (
              <div key={it.id} className="ord-line">
                <div className="ord-tile-name">{it.produtos?.nome}</div>
                <span className="ord-card-sub">× {it.qtd}</span>
              </div>
            ))}
            <div className="ord-total-bar">
              <span>{t('common.total')}</span>
              <span>{fmtYen(orderPreview.total_estimado || 0)}</span>
            </div>
            <p className="ff-note">{t('fulfillment.hideSupplier')}</p>
            {trackErr && <p className="ff-miss">{trackErr}</p>}
            {track?.public_code && <div className="ord-card-sub">{track.public_code}</div>}
            {Array.isArray(track?.lines) && track.lines.some(line => (line.tasks || []).some(task => task.supplier_marked_delivered && !task.stock_received)) && (
              <p className="ff-note">{t('procurement.supplierMarkedNotStock')}</p>
            )}
            {Array.isArray(track?.lines) && track.lines.map(line => (
              <div key={line.order_item_id} className="ord-line">
                <div className="ord-tile-name">{line.product}</div>
                <span className="ord-card-sub">{line.at_bar}/{line.quantity}</span>
              </div>
            ))}
            {Array.isArray(track?.shipments) && track.shipments.map(s => (
              <div key={s.id} className="ord-line">
                <span>{s.code} · {s.status}</span>
                {s.status === 'delivered' && (
                  <button type="button" className="ord-ghost" onClick={async () => {
                    setConfirmBusy(true)
                    const { error } = await supabase.rpc('confirm_bar_shipment', {
                      p_shipment_id: s.id,
                      p_status: 'received',
                      p_lines: [],
                      p_note: null,
                    })
                    setConfirmBusy(false)
                    if (error) setTrackErr(error.message)
                    else { setOrderPreview(null); load() }
                  }}>{t('fulfillment.confirmReceipt')}</button>
                )}
              </div>
            ))}
            {track?.events && <OrderTimeline events={track.events} audience="bar" />}
            {track && !(track.shipments || []).length && track.status !== 'completed' && track.status !== 'cancelled' && (
              <DeliveryConfirmation
                expected={(orderPreview.pedidos_itens || []).reduce((a, it) => a + (+it.qtd || 0), 0)}
                busy={confirmBusy}
                error={trackErr}
                onConfirm={async ({ status, received: got, note }) => {
                  setConfirmBusy(true)
                  const { error } = await supabase.rpc('bar_confirm_delivery', {
                    p_order_id: orderPreview.id,
                    p_status: status,
                    p_received: got,
                    p_note: note || null,
                  })
                  setConfirmBusy(false)
                  if (error) setTrackErr(error.message)
                  else {
                    setOrderPreview(null)
                    load()
                  }
                }}
              />
            )}
            <button type="button" className="ord-ghost" style={{ width: '100%' }} onClick={() => setOrderPreview(null)}>{t('common.close')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
