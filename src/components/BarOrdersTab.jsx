import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { fmtYen, fmtDate, Spinner, Empty, SectionTitle, isSupplierProduct, PedidoItemChip } from './utils'
import { isRestockPedido } from '../lib/posSupply'
import { useI18n } from '../lib/i18n'
import { orderCastFromObs, orderDetailsFromObs, withOrderCast } from '../lib/orderMeta'

const STATUS_PEDIDO = {
  pendente:   { labelKey: 'orderStatus.pendente',   color: '#8A5A00', bg: '#FDF3E0' },
  confirmado: { labelKey: 'orderStatus.confirmado', color: '#1A4E8A', bg: '#EAF0FA' },
  entregue:   { labelKey: 'orderStatus.entregue',   color: '#1A7A5E', bg: '#EAF5F0' },
  cancelado:  { labelKey: 'orderStatus.cancelado',  color: '#C0392B', bg: '#FBEAEA' },
}

function Badge({ status }) {
  const { t } = useI18n()
  const s = STATUS_PEDIDO[status] || STATUS_PEDIDO.pendente
  return <span className="ord-badge" style={{ background: s.bg, color: s.color }}>{t(s.labelKey)}</span>
}

export default function BarOrdersTab({ bar }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [produtos, setProdutos] = useState([])
  const [pedidos, setPedidos] = useState([])
  const [casts, setCasts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [orderErr, setOrderErr] = useState('')
  const [qtyPopup, setQtyPopup] = useState(null)
  const [orderPreview, setOrderPreview] = useState(null)
  const [qtyInput, setQtyInput] = useState('')
  const [items, setItems] = useState([])
  const [obs, setObs] = useState('')
  const [castName, setCastName] = useState('')
  const [castId, setCastId] = useState('')
  const [addCastOpen, setAddCastOpen] = useState(false)
  const [newCastName, setNewCastName] = useState('')
  const [entrega, setEntrega] = useState('')
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('all')
  const [statusFilter, setStatusFilter] = useState('open')
  const [viewMode, setViewMode] = useState('list')
  const [summaryMes, setSummaryMes] = useState('')

  useEffect(() => { load() }, [bar])

  async function load() {
    const [pR, pedR, cR] = await Promise.all([
      supabase.from('produtos_public').select('*').eq('ativo', true).order('categoria').order('nome'),
      supabase.from('pedidos').select('*, pedidos_itens(*, produtos(nome,preco_venda,categoria,volume_ml))').eq('bar_id', bar.id).order('criado_em', { ascending: false }).limit(80),
      supabase.from('drink_back_agents').select('id,nome,ativo').eq('bar_id', bar.id).eq('ativo', true).order('nome'),
    ])
    setProdutos((pR.data || []).filter(isSupplierProduct))
    setPedidos(pedR.data || [])
    setCasts(cR.error ? [] : (cR.data || []))
    setLoading(false)
  }

  const allMeses = [...new Set(pedidos.map(p => p.criado_em?.slice(0, 7)).filter(Boolean))].sort().reverse()
  const mesFiltro = summaryMes || (allMeses[0] || '')
  const pedidosMes = pedidos.filter(p => p.criado_em?.startsWith(mesFiltro))
  const prodMap = {}
  pedidosMes.forEach(p => (p.pedidos_itens || []).forEach(it => {
    const pid = it.produto_id
    const pr = it.produtos
    if (!prodMap[pid]) prodMap[pid] = { nome: pr?.nome || '?', categoria: pr?.categoria || '—', volume_ml: pr?.volume_ml || 0, preco_unit: pr?.preco_venda || 0, qtd: 0, total: 0 }
    prodMap[pid].qtd += it.qtd
    prodMap[pid].total += (pr?.preco_venda || 0) * it.qtd
  }))
  const summaryList = Object.values(prodMap).sort((a, b) => b.total - a.total)
  const summaryTotal = summaryList.reduce((a, p) => a + p.total, 0)

  const totalOrder = items.reduce((a, it) => {
    const p = produtos.find(x => x.id === it.produto_id)
    return a + (p ? p.preco_venda * it.qtd : 0)
  }, 0)
  const bottleCount = items.reduce((a, it) => a + it.qtd, 0)

  const cats = useMemo(() => [...new Set(produtos.map(p => p.categoria).filter(Boolean))], [produtos])
  const q = search.trim().toLowerCase()
  const visible = produtos.filter(p => {
    if (cat !== 'all' && p.categoria !== cat) return false
    if (!q) return true
    return String(p.nome || '').toLowerCase().includes(q) || String(p.categoria || '').toLowerCase().includes(q)
  })

  const listed = pedidos.filter(p => {
    if (statusFilter === 'open') return p.status === 'pendente' || p.status === 'confirmado'
    if (statusFilter === 'all') return true
    return p.status === statusFilter
  })

  async function addCastQuick(nomeRaw) {
    const nome = String(nomeRaw || '').trim()
    if (!nome) return
    const { data, error } = await supabase.from('drink_back_agents').insert({
      bar_id: bar.id, nome, comissao_pct: 10, ativo: true,
    }).select('id,nome,ativo').single()
    if (error) {
      setCastName(nome)
      setCastId('')
      setAddCastOpen(false)
      setNewCastName('')
      return
    }
    setCasts(prev => [...prev, data])
    setCastName(data.nome)
    setCastId(data.id)
    setAddCastOpen(false)
    setNewCastName('')
  }

  async function enviarOrder() {
    if (items.length === 0) {
      setOrderErr(t('portal.orders.addOneItem'))
      return
    }
    setSaving(true)
    setOrderErr('')
    const packed = withOrderCast(obs, { name: castName, id: castId })
    const { data: pedido, error } = await supabase.from('pedidos').insert({
      bar_id: bar.id, criado_por: user?.id,
      status: 'pendente',
      data_pedido: new Date().toISOString().slice(0, 10),
      data_entrega_prevista: entrega || null,
      obs: packed, total_estimado: totalOrder,
    }).select().single()

    if (error) { setOrderErr(t('portal.orders.saveError', { message: error.message })); setSaving(false); return }
    if (!pedido) { setOrderErr(t('portal.orders.saveOrderError')); setSaving(false); return }

    const { error: itemsError } = await supabase.from('pedidos_itens').insert(
      items.map(it => {
        const p = produtos.find(x => x.id === it.produto_id)
        return { pedido_id: pedido.id, produto_id: it.produto_id, qtd: it.qtd, preco_unitario: p?.preco_venda || 0 }
      })
    )
    if (itemsError) setOrderErr(t('portal.orders.saveItemsError', { message: itemsError.message }))

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
    setItems([]); setObs(''); setCastName(''); setCastId(''); setEntrega('')
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

  if (loading) return <Spinner text={t('portal.orders.loading')} />

  return (
    <div className="fade-in ord-page">
      <div className="ord-head">
        <SectionTitle>{t('portal.orders.title')}</SectionTitle>
        <div className="ord-head-actions">
          <button type="button" className="ord-ghost" onClick={() => setViewMode(v => v === 'list' ? 'summary' : 'list')}>
            {viewMode === 'list' ? t('portal.orders.monthlySummary') : t('portal.orders.orderList')}
          </button>
        </div>
      </div>

      {viewMode === 'summary' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t('portal.orders.monthlyTitle')}</div>
            <select value={mesFiltro} onChange={e => setSummaryMes(e.target.value)}>
              {allMeses.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {summaryList.length === 0 ? <div className="ord-empty">{t('portal.orders.noOrdersMonth')}</div> : (
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)' }}>
                    {[t('portal.orders.colProduct'), t('portal.orders.colCategory'), t('portal.orders.colVol'), t('portal.orders.colQty'), t('portal.orders.colUnit'), t('portal.orders.colTotal')].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summaryList.map((p, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{p.nome}</td>
                      <td style={{ padding: '8px 12px' }}>{p.categoria}</td>
                      <td style={{ padding: '8px 12px' }}>{p.volume_ml > 0 ? `${p.volume_ml}ml` : '—'}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 700 }}>{p.qtd}</td>
                      <td style={{ padding: '8px 12px' }}>{fmtYen(p.preco_unit)}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 800 }}>{fmtYen(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td colSpan={5} style={{ padding: '10px 12px', fontWeight: 700 }}>{t('common.total')}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 800 }}>{fmtYen(summaryTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {viewMode === 'list' && (
        <div className="ord-composer card">
          <div className="ord-composer-title">{t('portal.orders.newOrderJbm')}</div>
          <div className="ord-composer-hint">{t('portal.orders.supplierListHint')}</div>

          <div className="ord-cast-panel">
            <div className="ord-meta-label">💃 {t('portal.orders.cast')}</div>
            <div className="ord-chips">
              {casts.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`ord-chip ord-chip-cast${castId === c.id || (!castId && castName === c.nome) ? ' is-on' : ''}`}
                  onClick={() => {
                    if (castId === c.id) { setCastId(''); setCastName('') }
                    else { setCastId(c.id); setCastName(c.nome) }
                  }}
                >💃 {c.nome}</button>
              ))}
              <button type="button" className="ord-chip" onClick={() => setAddCastOpen(v => !v)}>{t('portal.orders.addCast')}</button>
            </div>
            {addCastOpen && (
              <div className="ord-add-cast">
                <input
                  value={newCastName}
                  onChange={e => setNewCastName(e.target.value)}
                  placeholder={t('portal.orders.castPlaceholder')}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCastQuick(newCastName) } }}
                />
                <button type="button" className="btn-primary" onClick={() => addCastQuick(newCastName)}>{t('common.confirm')}</button>
              </div>
            )}
            <input
              className="ord-cast-input"
              value={castName}
              onChange={e => { setCastName(e.target.value); setCastId('') }}
              placeholder={t('portal.orders.castPlaceholder')}
            />
          </div>

          <div className="ord-meta-grid">
            <label>{t('portal.orders.deliveryDate')}
              <input type="date" value={entrega} onChange={e => setEntrega(e.target.value)} />
            </label>
          </div>
          <label className="ord-details-label">{t('portal.orders.details')}
            <textarea
              className="ord-details-input"
              rows={3}
              value={obs}
              onChange={e => setObs(e.target.value)}
              placeholder={t('portal.orders.notesPlaceholder')}
            />
          </label>

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
                    <span className="ord-tile-price">{fmtYen(p.preco_venda)}</span>
                  </button>
                  <div className="ord-tile-qty">
                    <button type="button" onClick={() => bumpQty(p.id, -1)}>−</button>
                    <button type="button" className="ord-tile-count" onClick={() => { setQtyPopup(p.id); setQtyInput(String(item?.qtd || 1)) }}>{item?.qtd || 0}</button>
                    <button type="button" onClick={() => bumpQty(p.id, 1)}>+</button>
                  </div>
                </div>
              )
            })}
          </div>

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
            <div>
              {castName
                ? <div className="ord-cast-tag">💃 {castName}</div>
                : <div className="ord-send-kicker">{t('portal.orders.cast')}</div>}
              <div className="ord-send-kicker">{bottleCount} {t('portal.orders.items')}</div>
              <div className="ord-send-total">{t('portal.orders.estimatedTotal', { amount: fmtYen(totalOrder) })}</div>
              {orderErr && <div className="pos-sale-err">{orderErr}</div>}
            </div>
            <button type="button" className="btn-primary ord-send-btn" onClick={enviarOrder} disabled={saving || items.length === 0}>
              {saving ? t('portal.orders.sending') : t('portal.orders.sendOrder')}
            </button>
          </div>
        </div>
      )}

      <div className="ord-row-scroll" style={{ marginBottom: 12 }}>
        {[['open', t('portal.orders.filterOpen')], ['all', t('portal.orders.filterAll')], ['pendente', t('orderStatus.pendente')], ['confirmado', t('orderStatus.confirmado')], ['entregue', t('orderStatus.entregue')]].map(([id, label]) => (
          <button key={id} type="button" className={`ord-chip${statusFilter === id ? ' is-on' : ''}`} onClick={() => setStatusFilter(id)}>{label}</button>
        ))}
      </div>

      {listed.length === 0
        ? <Empty text={t('portal.orders.noOrders')} icon="🛒" />
        : listed.map(p => {
          const meta = { cast: orderCastFromObs(p.obs), details: orderDetailsFromObs(p.obs) }
          return (
            <div key={p.id} className="ord-card">
              <div className="ord-card-top">
                <div>
                  <div className="ord-card-date">{fmtDate(p.criado_em?.slice(0, 10))}</div>
                  {meta.cast && <div className="ord-cast-tag">💃 {meta.cast}</div>}
                  {isRestockPedido(p) && <div className="ord-restock">{t('portal.orders.restockFromCounter')}</div>}
                  {p.data_entrega_prevista && <div className="ord-card-sub">{t('portal.orders.expected', { date: p.data_entrega_prevista })}</div>}
                  {meta.details && !isRestockPedido(p) && <div className="ord-details-box compact">{meta.details}</div>}
                </div>
                <div className="ord-card-right">
                  <strong>{fmtYen(p.total_estimado)}</strong>
                  <Badge status={p.status} />
                </div>
              </div>
              <div className="ord-card-items">
                {(p.pedidos_itens || []).map(it => (
                  <PedidoItemChip key={it.id} nome={it.produtos?.nome || '?'} qtd={it.qtd} precoUnitario={it.preco_unitario} hideCost />
                ))}
              </div>
              <div className="ord-card-actions">
                <button type="button" className="ord-ghost" onClick={() => setOrderPreview(p)}>{t('portal.orders.viewDetails')}</button>
                {p.status === 'pendente' && (
                  <button type="button" className="ord-ghost danger" onClick={async () => {
                    if (!confirm(t('portal.orders.cancelConfirm'))) return
                    await supabase.from('pedidos_itens').delete().eq('pedido_id', p.id)
                    await supabase.from('pedidos').delete().eq('id', p.id)
                    setPedidos(prev => prev.filter(x => x.id !== p.id))
                  }}>{t('portal.orders.cancel')}</button>
                )}
              </div>
            </div>
          )
        })
      }

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
            {orderCastFromObs(orderPreview.obs) && (
              <div className="ord-cast-tag big">💃 CAST · {orderCastFromObs(orderPreview.obs)}</div>
            )}
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
                <div>
                  <div className="ord-tile-name">{it.produtos?.nome}</div>
                  <div className="ord-card-sub">¥{(it.preco_unitario || 0).toLocaleString()} × {it.qtd}</div>
                </div>
                <strong>¥{((it.preco_unitario || 0) * it.qtd).toLocaleString()}</strong>
              </div>
            ))}
            <div className="ord-total-bar">
              <span>{t('common.total')}</span>
              <span>{fmtYen(orderPreview.total_estimado || 0)}</span>
            </div>
            <button type="button" className="ord-ghost" style={{ width: '100%' }} onClick={() => setOrderPreview(null)}>{t('common.close')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
