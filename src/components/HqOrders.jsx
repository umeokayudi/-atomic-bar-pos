import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ensureVendaFromPedido, findVendaKeysForPedidos, pedidoSaleDate, mergeOrInsertPeriodFatura } from '../lib/pedidoVenda'
import { addStockFromDelivery } from '../lib/posSupply'
import { fmtYen, fmtDate, isSupplierProduct } from './utils'
import { SupplierCostHint } from './SupplierPriceCheck'
import { AdminPage, PortalSurface } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'
import Icon from './ui/Icon'
import OrderDetailPopup from './OrderDetailPopup'
import { notify } from './ui/ConfirmDialog'
import { tokyoDateKey, tokyoWallToUtcMs } from '../lib/tokyo'
import { costPending } from '../lib/catalog'
import { pathForTab } from '../lib/navigation'
import { ensureTracks, loadTracks, saveTrack, setTrackStatus } from '../lib/orderTrackApi'
import {
  UNITS, billingMissing, consolidateLines, mergedCount, orderCode, priceLineError, sameDayOrders, tokyoDay, tokyoTime, trackStatus,
} from '../lib/orderTrack'
import BarOrdersTab from './BarOrdersTab'
import './orders.css'

const STATUS_TONE = { pendente: 'amber', confirmado: 'blue', a_caminho: 'violet', entregue: 'green', cancelado: 'red' }
const PEDIDOS_SELECT = '*, pedidos_itens(*, produtos(nome,custo,preco_venda,categoria,volume_ml,unidade)), bars(nome)'

const emptyLine = () => ({ key: Math.random().toString(36).slice(2), produto_id: '', qtd: 1, unidade: '', preco: '', preco_motivo: '', nota: '' })
const emptyForm = () => ({ bar_id: '', dia: tokyoDateKey(), de: '18:00', ate: '20:00', prioridade: 'normal', responsavel: '', nota: '', lines: [emptyLine()] })

function wallIso(day, hhmm) {
  if (!day) return null
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = String(hhmm || '00:00').split(':').map(Number)
  return new Date(tokyoWallToUtcMs(y, m, d, hh || 0, mm || 0)).toISOString()
}

export function StatusPill({ status }) {
  const { t } = useI18n()
  return <span className={`ot-pill is-${STATUS_TONE[status] || 'amber'}`}>{t(`ot.status.${status}`)}</span>
}

/** When and by whom, from the track row (or the order itself for old orders). */
function createdLine(p, tr, t) {
  const at = p.criado_em ? `${fmtDate(tokyoDay(p.criado_em))} ${tokyoTime(p.criado_em)}` : fmtDate(p.data_pedido)
  return tr?.criado_por_nome ? t('ot.createdBy', { at, who: tr.criado_por_nome }) : t('ot.createdAt', { at })
}

export function deliveryWindow(p, tr) {
  if (tr?.entrega_de) return `${fmtDate(tokyoDay(tr.entrega_de))} ${tokyoTime(tr.entrega_de)}${tr.entrega_ate ? `–${tokyoTime(tr.entrega_ate)}` : ''}`
  return p.data_entrega_prevista ? fmtDate(String(p.data_entrega_prevista).slice(0, 10)) : ''
}

/** Translated word, or the raw value when there is no translation (units typed in the catalog, old statuses). */
export function orRaw(t, key, raw) {
  const s = t(key)
  return s === key ? raw : s
}

export function lineUnit(it, tr) {
  return tr?.linhas?.[it.id]?.unidade || it.produtos?.unidade || ''
}

/**
 * HQ → Orders: every drinks order to a bar, from "sent" to "delivered", each with its own number
 * (ORD-2026-0142), who made it and when, the delivery window and a history of every status change.
 * New orders start here as Pending (a sale is only written when the order is delivered).
 */
export default function HqOrders() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [pedidos, setPedidos] = useState([])
  const [tracks, setTracks] = useState({})
  const [bars, setBars] = useState([])
  const [profiles, setProfiles] = useState({})
  const [invoiceBars, setInvoiceBars] = useState(new Set())
  const [produtos, setProdutos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterBar, setFilterBar] = useState('')
  const [missingVenda, setMissingVenda] = useState({})
  const [repairing, setRepairing] = useState(null)
  const [detail, setDetail] = useState(null)
  const [history, setHistory] = useState(null)
  const [deliver, setDeliver] = useState(null)
  const [cancelAsk, setCancelAsk] = useState(null)
  const [viewBar, setViewBar] = useState(null)
  const [busy, setBusy] = useState('')
  const [composer, setComposer] = useState(() => new URLSearchParams(location.search).get('new') === '1')
  const [form, setForm] = useState(emptyForm)
  const [formErr, setFormErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [supplierBy, setSupplierBy] = useState({ id: new Map(), name: new Map() })

  useEffect(() => { load(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    supabase.from('fornecedor_precos').select('produto_id, preco, produtos(id,nome), fornecedores(nome)').then(({ data }) => {
      const id = new Map(); const name = new Map()
      for (const p of data || []) {
        if (p.produto_id) id.set(p.produto_id, p)
        if (p.produtos?.nome) name.set(p.produtos.nome.toLowerCase(), p)
      }
      setSupplierBy({ id, name })
    })
  }, [])
  useEffect(() => {
    if (new URLSearchParams(location.search).get('new') === '1') setComposer(true)
  }, [location.search])

  async function load(first = false) {
    const since = new Date(); since.setMonth(since.getMonth() - 6)
    const sinceStr = since.toISOString().slice(0, 10)
    const [pR, bR, prodR, profR, fR] = await Promise.all([
      supabase.from('pedidos').select(PEDIDOS_SELECT).or(`data_entrega_prevista.gte.${sinceStr},criado_em.gte.${sinceStr}T00:00:00`).order('criado_em', { ascending: false }).limit(150),
      supabase.from('bars').select('id,nome,cor').order('nome'),
      supabase.from('produtos').select('*').eq('ativo', true).order('nome'),
      supabase.from('bar_profile').select('*'),
      supabase.from('faturas').select('bar_id'),
    ])
    const list = pR.data || []
    setPedidos(list)
    setBars(bR.data || [])
    setProdutos((prodR.data || []).filter(isSupplierProduct))
    setProfiles(Object.fromEntries((profR.data || []).map(r => [r.bar_id || r.id, r])))
    setInvoiceBars(new Set((fR.data || []).map(f => f.bar_id)))
    if (first) { try { await ensureTracks() } catch { /* older deploy: numbers come later */ } }
    setTracks(await loadTracks({ ids: list.map(p => p.id) }))
    setForm(f => (f.bar_id || !bR.data?.length ? f : { ...f, bar_id: bR.data[0].id }))
    const entregues = list.filter(p => p.status === 'entregue')
    const keys = await findVendaKeysForPedidos(supabase, entregues)
    const miss = {}
    for (const p of entregues) if (!keys.has(String(p.id).slice(0, 8).toLowerCase())) miss[p.id] = true
    setMissingVenda(miss)
    setLoading(false)
  }

  const prodById = useMemo(() => new Map(produtos.map(p => [p.id, p])), [produtos])
  const barById = useMemo(() => new Map(bars.map(b => [b.id, b])), [bars])

  // ── New order ──────────────────────────────────────────────────────────────
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setLine = (key, patch) => setForm(f => ({ ...f, lines: f.lines.map(l => l.key === key ? { ...l, ...patch } : l) }))
  function pickProduct(key, id) {
    const p = prodById.get(id)
    setLine(key, { produto_id: id, unidade: p?.unidade || 'bottle', preco: p ? Math.round(+p.preco_venda || 0) : '', preco_motivo: '' })
  }
  const formLines = form.lines.filter(l => l.produto_id && +l.qtd > 0)
  const formTotal = formLines.reduce((a, l) => a + (+l.preco || 0) * (+l.qtd || 0), 0)
  const merged = mergedCount(formLines)
  const today = tokyoDateKey()
  const sameDay = sameDayOrders(pedidos, form.bar_id, form.dia || today)

  function lineErrors() {
    const errs = {}
    for (const l of formLines) {
      const p = prodById.get(l.produto_id)
      if (p && costPending(p)) { errs[l.key] = 'noCost'; continue }
      const e = priceLineError(l, p?.preco_venda)
      if (e) errs[l.key] = e
    }
    return errs
  }

  async function saveOrder(appendTo = null) {
    setFormErr('')
    if (!form.bar_id) return setFormErr(t('ot.err.bar'))
    if (!formLines.length) return setFormErr(t('ot.err.lines'))
    const errs = lineErrors()
    if (Object.keys(errs).length) return setFormErr(t(`ot.err.${Object.values(errs)[0]}`))
    if (form.ate && form.de && form.ate < form.de) return setFormErr(t('ot.err.window'))
    const lines = consolidateLines(formLines)
    setSaving(true)
    try {
      let pedido = appendTo
      if (!pedido) {
        const total = lines.reduce((a, l) => a + (+l.preco || 0) * (+l.qtd || 0), 0)
        const { data: { user } } = await supabase.auth.getUser()
        const { data, error } = await supabase.from('pedidos').insert({
          bar_id: form.bar_id, criado_por: user?.id || null, status: 'pendente',
          data_pedido: today, data_entrega_prevista: form.dia || null, total_estimado: total, obs: null,
        }).select().single()
        if (error) throw error
        pedido = data
      }
      const { data: itens, error: iErr } = await supabase.from('pedidos_itens').insert(lines.map(l => ({
        pedido_id: pedido.id, produto_id: l.produto_id, qtd: +l.qtd, preco_unitario: Math.round(+l.preco || 0),
      }))).select('id,produto_id,qtd,preco_unitario')
      if (iErr) throw iErr
      if (appendTo) {
        const extra = lines.reduce((a, l) => a + (+l.preco || 0) * (+l.qtd || 0), 0)
        await supabase.from('pedidos').update({ total_estimado: (+appendTo.total_estimado || 0) + extra }).eq('id', appendTo.id)
      }
      const linhas = {}
      const used = new Set()
      for (const l of lines) {
        const row = (itens || []).find(r => !used.has(r.id) && r.produto_id === l.produto_id && +r.qtd === +l.qtd)
        if (!row) continue
        used.add(row.id)
        linhas[row.id] = { unidade: l.unidade || null, nota: l.nota || null, preco_catalogo: Math.round(+prodById.get(l.produto_id)?.preco_venda || 0), preco_motivo: l.preco_motivo || null }
      }
      const patch = appendTo ? { linhas } : {
        entrega_de: wallIso(form.dia, form.de), entrega_ate: form.ate ? wallIso(form.dia, form.ate) : null,
        prioridade: form.prioridade, responsavel: form.responsavel, nota: form.nota, linhas,
      }
      try { await saveTrack(pedido.id, patch, appendTo ? {} : { created: true }) } catch (e) { notify(t('ot.trackFailed', { message: e.message }), 'error') }
      notify(appendTo ? t('ot.appended', { code: orderCode(tracks[appendTo.id], appendTo) || '' }) : t('ot.created'))
      setForm({ ...emptyForm(), bar_id: form.bar_id })
      setComposer(false)
      if (location.search) navigate(pathForTab('hq', 'pedidos'), { replace: true })
      await load(true)
    } catch (e) {
      setFormErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // ── Status changes ─────────────────────────────────────────────────────────
  async function registerVendaForPedido(pedido) {
    const { data: fresh, error } = await supabase.from('pedidos').select(PEDIDOS_SELECT).eq('id', pedido.id).single()
    if (error) throw new Error(error.message)
    const { venda } = await ensureVendaFromPedido(supabase, fresh)
    if (!venda) throw new Error('Could not create the sale')
    try { await addStockFromDelivery(supabase, fresh) } catch (e) { console.warn('estoque entrega:', e.message) }
    return venda
  }

  async function repairVenda(p) {
    setRepairing(p.id)
    try {
      const venda = await registerVendaForPedido(p)
      notify(t('configs.deliveryOk', { amount: fmtYen(venda.total || 0), date: venda.data }))
      await load()
    } catch (e) { notify(t('configs.saleError', { message: e.message }), 'error') }
    setRepairing(null)
  }

  async function changeStatus(p, status, extra = {}) {
    setBusy(`${p.id}:${status}`)
    try {
      await setTrackStatus(p.id, status, extra)
      notify(t(`ot.done.${status}`))
      await load()
      return true
    } catch (e) {
      notify(e.code === 'reason' ? t('ot.err.reason') : e.message, 'error')
      return false
    } finally { setBusy('') }
  }

  function openDeliver(p) {
    const tr = tracks[p.id]
    const prof = profiles[p.bar_id]
    const miss = billingMissing(prof)
    if (miss.length && !invoiceBars.has(p.bar_id)) {
      setDeliver({ pedido: p, blocked: miss })
      return
    }
    const counted = Object.fromEntries((tr?.recebimento?.linhas || []).map(l => [l.id, l.recebido]))
    const checks = Object.fromEntries((p.pedidos_itens || []).map(it => [it.id, counted[it.id] != null ? +counted[it.id] >= +it.qtd : false]))
    setDeliver({ pedido: p, checks, recebido_por: tr?.recebimento?.responsavel || '' })
  }

  async function confirmDeliver() {
    const { pedido: p, checks, recebido_por } = deliver
    if (!Object.values(checks).every(Boolean)) return notify(t('configs.checkItemsFirst'), 'error')
    if (!String(recebido_por || '').trim()) return notify(t('ot.err.receivedBy'), 'error')
    setBusy(`${p.id}:entregue`)
    try {
      const venda = await registerVendaForPedido(p)
      try {
        await mergeOrInsertPeriodFatura(supabase, { barId: p.bar_id, amount: p.total_estimado, saleDate: pedidoSaleDate(p), vendaId: venda?.id || null, notas: t('configs.invoiceAutoNote') })
      } catch (e) { console.error('auto-fatura error:', e) }
      try { await setTrackStatus(p.id, 'entregue', { recebido_por }) } catch {
        await supabase.from('pedidos').update({ status: 'entregue' }).eq('id', p.id)
      }
      notify(t('configs.deliveryOk', { amount: fmtYen(venda.total || 0), date: venda.data }))
      setDeliver(null)
      await load()
    } catch (e) {
      notify(t('configs.saleError', { message: e.message }), 'error')
    } finally { setBusy('') }
  }

  // ── List ───────────────────────────────────────────────────────────────────
  const shown = pedidos.filter(p => (!filterStatus || trackStatus(p, tracks[p.id]) === filterStatus) && (!filterBar || p.bar_id === filterBar))
  const pendentes = pedidos.filter(p => p.status === 'pendente').length
  const missingCount = Object.keys(missingVenda).length

  return (
    <AdminPage
      title={t('configs.pedidosTitle')}
      subtitle={t('ot.subtitle')}
      actions={
        <div className="ot-actions">
          <button type="button" className="ui-btn is-primary" onClick={() => setComposer(v => !v)}><Icon name="plus" size={15} /> {t('ot.newOrder')}</button>
          {missingCount > 0 && (
            <button type="button" className="ui-btn is-danger" onClick={async () => { for (const p of pedidos.filter(x => missingVenda[x.id])) await repairVenda(p) }}>{t('configs.syncMissingSales')}</button>
          )}
          <select value={filterBar} onChange={e => setFilterBar(e.target.value)} aria-label={t('common.bar')}>
            <option value="">{t('common.allBars')}</option>
            {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label={t('configs.allStatuses')}>
            <option value="">{t('configs.allStatuses')}</option>
            {['pendente', 'confirmado', 'a_caminho', 'entregue', 'cancelado'].map(s => <option key={s} value={s}>{t(`ot.status.${s}`)}</option>)}
          </select>
        </div>
      }
    >
      {composer && (
        <PortalSurface title={t('ot.newOrder')} style={{ marginBottom: 16 }}>
          <p className="ot-lead">{t('ot.newLead')}</p>
          <div className="ot-grid">
            <label>{t('common.bar')}
              <select value={form.bar_id} onChange={e => setF('bar_id', e.target.value)}>
                {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </label>
            <label>{t('ot.deliveryDay')}<input type="date" value={form.dia} onChange={e => setF('dia', e.target.value)} /></label>
            <label>{t('ot.from')}<input type="time" value={form.de} onChange={e => setF('de', e.target.value)} /></label>
            <label>{t('ot.to')}<input type="time" value={form.ate} onChange={e => setF('ate', e.target.value)} /></label>
            <label>{t('ot.priority')}
              <select value={form.prioridade} onChange={e => setF('prioridade', e.target.value)}>
                <option value="normal">{t('ot.prio.normal')}</option>
                <option value="urgent">{t('ot.prio.urgent')}</option>
              </select>
            </label>
            <label>{t('ot.deliverer')}<input value={form.responsavel} onChange={e => setF('responsavel', e.target.value)} placeholder={t('ot.delivererPh')} /></label>
          </div>
          <label className="ot-wide">{t('ot.orderNote')}<input value={form.nota} onChange={e => setF('nota', e.target.value)} placeholder={t('ot.orderNotePh')} /></label>

          {billingMissing(profiles[form.bar_id]).length > 0 && !invoiceBars.has(form.bar_id) && (
            <div className="ot-warn">
              <Icon name="warning" size={15} /> {t('ot.billingMissing', { list: billingMissing(profiles[form.bar_id]).map(k => t(`ot.billing.${k}`)).join(', ') })}
              <button type="button" className="ui-btn is-sm" onClick={() => navigate(pathForTab('hq', 'bars'))}>{t('ot.openBars')}</button>
            </div>
          )}

          <div className="ot-lines">
            <div className="ot-line ot-line-head" aria-hidden="true">
              <span>{t('common.product')}</span><span>{t('common.qty')}</span><span>{t('ot.unit')}</span><span>{t('ot.price')}</span><span>{t('ot.lineNote')}</span><span className="num">{t('common.total')}</span><span />
            </div>
            {form.lines.map(l => {
              const p = prodById.get(l.produto_id)
              const changed = p && Math.round(+l.preco || 0) !== Math.round(+p.preco_venda || 0)
              const noCost = p && costPending(p)
              return (
                <div key={l.key} className={`ot-line${noCost ? ' is-bad' : ''}`}>
                  <select value={l.produto_id} onChange={e => pickProduct(l.key, e.target.value)} aria-label={t('common.product')}>
                    <option value="">{t('ot.pickProduct')}</option>
                    {produtos.map(x => <option key={x.id} value={x.id} disabled={costPending(x)}>{x.nome}{costPending(x) ? ` — ${t('ot.noCostTag')}` : ''}</option>)}
                  </select>
                  <input type="number" min="1" value={l.qtd} onChange={e => setLine(l.key, { qtd: e.target.value })} aria-label={t('common.qty')} />
                  <select value={l.unidade} onChange={e => setLine(l.key, { unidade: e.target.value })} aria-label={t('ot.unit')}>
                    {[...new Set([...(l.unidade && !UNITS.includes(l.unidade) ? [l.unidade] : []), ...UNITS])].map(u => <option key={u} value={u}>{orRaw(t, `ot.units.${u}`, u)}</option>)}
                  </select>
                  <div className="ot-price">
                    <input type="number" min="0" value={l.preco} onChange={e => setLine(l.key, { preco: e.target.value })} aria-label={t('ot.price')} />
                    {p && <small className={changed ? 'is-changed' : ''}>{t('ot.catalog', { price: fmtYen(p.preco_venda) })}</small>}
                  </div>
                  <input value={l.nota} onChange={e => setLine(l.key, { nota: e.target.value })} placeholder={t('ot.lineNotePh')} aria-label={t('ot.lineNote')} />
                  <span className="num ot-line-total">{fmtYen((+l.preco || 0) * (+l.qtd || 0))}</span>
                  <button type="button" className="ot-x" onClick={() => setForm(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter(x => x.key !== l.key) : [emptyLine()] }))} aria-label={t('portal.orders.remove')}>✕</button>
                  {changed && (
                    <input className="ot-reason" value={l.preco_motivo} onChange={e => setLine(l.key, { preco_motivo: e.target.value })} placeholder={t('ot.priceReasonPh')} aria-label={t('ot.priceReason')} />
                  )}
                  {p && <div className="ot-line-hint"><SupplierCostHint produtoId={p.id} produtoNome={p.nome} byProductId={supplierBy.id} byProductName={supplierBy.name} /></div>}
                </div>
              )
            })}
            <button type="button" className="ui-btn is-sm" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))}><Icon name="plus" size={13} /> {t('common.addItem')}</button>
          </div>

          {merged > 0 && <div className="ot-info"><Icon name="info" size={14} /> {t('ot.willMerge', { n: merged })}</div>}
          {sameDay.length > 0 && (
            <div className="ot-warn">
              <div><Icon name="warning" size={15} /> <b>{t('ot.sameDay', { n: sameDay.length, bar: barById.get(form.bar_id)?.nome || '' })}</b></div>
              <ul className="ot-sameday">
                {sameDay.map(p => (
                  <li key={p.id}>
                    <span>{orderCode(tracks[p.id], p) || '—'} · <StatusPill status={trackStatus(p, tracks[p.id])} /> · {(p.pedidos_itens || []).length} {t('portal.orders.items')} · {fmtYen(p.total_estimado)}</span>
                    {p.status === 'pendente' && <button type="button" className="ui-btn is-sm" disabled={saving} onClick={() => saveOrder(p)}>{t('ot.addToThis')}</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {formErr && <div className="ot-err" role="alert">{formErr}</div>}
          <div className="ot-foot">
            <div>{t('common.total')}: <b>{fmtYen(formTotal)}</b> · {t('ot.startsPending')}</div>
            <div className="ot-foot-btns">
              <button type="button" className="ui-btn" onClick={() => setComposer(false)}>{t('common.cancel')}</button>
              <button type="button" className="ui-btn is-primary" disabled={saving} onClick={() => saveOrder(null)}>{saving ? t('common.saving') : sameDay.length ? t('ot.saveAnyway') : t('ot.save')}</button>
            </div>
          </div>
        </PortalSurface>
      )}

      {(pendentes > 0 || missingCount > 0) && (
        <div className="ot-flags">
          {pendentes > 0 && <span>{t('configs.awaitingConfirm', { count: pendentes })}</span>}
          {missingCount > 0 && <b>{t('configs.deliveredNoSale', { count: missingCount })}</b>}
        </div>
      )}

      {loading ? <div className="ot-lead">{t('common.loading')}</div> : shown.length === 0 ? <div className="ot-empty">{t('configs.noOrders')}</div> : shown.map(p => {
        const tr = tracks[p.id]
        const st = trackStatus(p, tr)
        const code = orderCode(tr, p)
        const rec = tr?.recebimento
        return (
          <PortalSurface key={p.id} style={{ marginBottom: 12, borderLeft: `3px solid var(--${st === 'pendente' ? 'gold' : 'border'})` }}>
            <div className="ot-card-top">
              <div>
                <div className="ot-code">{code || t('ot.noNumber')} <span className="ot-bar">{p.bars?.nome}</span> {tr?.prioridade === 'urgent' && <span className="ot-pill is-red">{t('ot.prio.urgent')}</span>}</div>
                <div className="ot-sub">{createdLine(p, tr, t)}</div>
                {deliveryWindow(p, tr) && <div className="ot-sub"><Icon name="entregas" size={12} /> {t('ot.delivery', { when: deliveryWindow(p, tr) })}{tr?.responsavel ? ` · ${t('ot.by', { who: tr.responsavel })}` : ''}</div>}
                {tr?.nota && <div className="ot-note">{tr.nota}</div>}
                {p.obs && <div className="ot-sub">{p.obs}</div>}
              </div>
              <div className="ot-card-right">
                <b>{fmtYen(p.total_estimado)}</b>
                <StatusPill status={st} />
              </div>
            </div>
            <table className="ot-items">
              <thead><tr><th>{t('common.product')}</th><th className="num">{t('common.qty')}</th><th>{t('ot.unit')}</th><th className="num">{t('ot.price')}</th><th className="num">{t('common.total')}</th></tr></thead>
              <tbody>
                {(p.pedidos_itens || []).map(it => {
                  const l = tr?.linhas?.[it.id] || {}
                  const got = rec?.linhas?.find(x => x.id === it.id)
                  return (
                    <tr key={it.id}>
                      <td>{it.produtos?.nome || '?'}{l.nota && <div className="ot-sub">{l.nota}</div>}{l.preco_motivo && <div className="ot-sub is-amber">{t('ot.priceChanged', { from: fmtYen(l.preco_catalogo), why: l.preco_motivo })}</div>}{got && got.recebido !== got.esperado && <div className="ot-sub is-red">{t('ot.barCounted', { n: got.recebido, of: got.esperado })}</div>}</td>
                      <td className="num">{it.qtd}</td>
                      <td>{lineUnit(it, tr) ? orRaw(t, `ot.units.${lineUnit(it, tr)}`, lineUnit(it, tr)) : '—'}</td>
                      <td className="num">{fmtYen(it.preco_unitario)}</td>
                      <td className="num">{fmtYen((+it.preco_unitario || 0) * (+it.qtd || 0))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rec && (
              <div className={`ot-rec${rec.faltas || rec.sobras ? ' is-bad' : ''}`}>
                <Icon name={rec.faltas || rec.sobras ? 'warning' : 'ok'} size={14} /> {t('ot.barReceived', { who: rec.responsavel || rec.por || '?', at: `${fmtDate(tokyoDay(rec.em))} ${tokyoTime(rec.em)}` })}
                {' · '}{rec.faltas || rec.sobras ? t('ot.recDiff', { short: rec.faltas || 0, over: rec.sobras || 0 }) : t('ot.recOk')}
                {rec.nota && <> · {rec.nota}</>}
              </div>
            )}
            {p.status === 'entregue' && tr?.entregue_em && (
              <div className="ot-sub"><Icon name="check" size={12} /> {t('ot.deliveredLine', { at: `${fmtDate(tokyoDay(tr.entregue_em))} ${tokyoTime(tr.entregue_em)}`, who: tr.recebido_por || '—', by: tr.entregue_por || '—' })}</div>
            )}
            {p.status === 'cancelado' && tr?.cancelado_motivo && <div className="ot-sub is-red">{t('ot.cancelledLine', { why: tr.cancelado_motivo, by: tr.cancelado_por || '—' })}</div>}
            {missingVenda[p.id] && (
              <div className="ot-warn"><Icon name="warning" size={14} /> {t('configs.saleNotRegistered')}
                <button type="button" className="ui-btn is-sm" onClick={() => repairVenda(p)} disabled={repairing === p.id}>{repairing === p.id ? t('configs.registering') : t('configs.registerSaleNow')}</button>
              </div>
            )}
            <div className="ot-btns">
              <button type="button" className="ui-btn is-sm" onClick={() => setDetail(p)}><Icon name="pedidos" size={13} /> {t('orderDetail.open')}</button>
              <button type="button" className="ui-btn is-sm" onClick={() => setHistory(p)}><Icon name="clock" size={13} /> {t('ot.history', { n: (tr?.historico || []).length })}</button>
              <button type="button" className="ui-btn is-sm" onClick={() => setViewBar({ bar: barById.get(p.bar_id) || { id: p.bar_id, nome: p.bars?.nome || '' }, manager: false })}><Icon name="eye" size={13} /> {t('ot.viewAsBar')}</button>
              {p.status === 'pendente' && <button type="button" className="ui-btn is-sm is-primary" disabled={!!busy} onClick={() => changeStatus(p, 'confirmado')}>{t('configs.confirm')}</button>}
              {st === 'confirmado' && <button type="button" className="ui-btn is-sm is-primary" disabled={!!busy} onClick={() => changeStatus(p, 'a_caminho')}><Icon name="entregas" size={13} /> {t('ot.leftNow')}</button>}
              {p.status === 'confirmado' && <button type="button" className="ui-btn is-sm is-success" disabled={!!busy} onClick={() => openDeliver(p)}>{t('configs.markDelivered')}</button>}
              {(p.status === 'pendente' || p.status === 'confirmado') && <button type="button" className="ui-btn is-sm is-danger" disabled={!!busy} onClick={() => setCancelAsk({ pedido: p, nota: '' })}>{t('ot.cancelOrder')}</button>}
            </div>
          </PortalSurface>
        )
      })}

      {detail && <OrderDetailPopup pedido={detail} date={pedidoSaleDate(detail)} onClose={() => setDetail(null)} />}

      {history && (
        <div className="ord-modal-bg" onClick={() => setHistory(null)}>
          <div className="ord-modal" onClick={e => e.stopPropagation()}>
            <div className="ord-modal-title">{t('ot.historyTitle', { code: orderCode(tracks[history.id], history) || '' })}</div>
            <ol className="ot-hist">
              {(tracks[history.id]?.historico || []).map((h, i) => (
                <li key={i}>
                  <b>{orRaw(t, `ot.status.${h.status}`, h.status)}</b>
                  <span>{fmtDate(tokyoDay(h.em))} {tokyoTime(h.em)}{h.por ? ` · ${h.por}` : ''}</span>
                  {h.nota && <small>{h.nota}</small>}
                </li>
              ))}
              {!(tracks[history.id]?.historico || []).length && <li><span>{t('ot.noHistory')}</span></li>}
            </ol>
            <button type="button" className="ord-ghost" style={{ width: '100%' }} onClick={() => setHistory(null)}>{t('common.close')}</button>
          </div>
        </div>
      )}

      {cancelAsk && (
        <div className="ord-modal-bg" onClick={() => setCancelAsk(null)}>
          <div className="ord-modal" onClick={e => e.stopPropagation()}>
            <div className="ord-modal-title">{t('ot.cancelTitle', { code: orderCode(tracks[cancelAsk.pedido.id], cancelAsk.pedido) || '' })}</div>
            <p className="ot-lead">{t('ot.cancelLead')}</p>
            <textarea rows={3} value={cancelAsk.nota} onChange={e => setCancelAsk(c => ({ ...c, nota: e.target.value }))} placeholder={t('ot.cancelPh')} autoFocus style={{ width: '100%' }} />
            <div className="ord-modal-actions">
              <button type="button" className="ord-ghost" onClick={() => setCancelAsk(null)}>{t('ot.back')}</button>
              <button type="button" className="btn-danger" disabled={!cancelAsk.nota.trim() || !!busy} onClick={async () => { if (await changeStatus(cancelAsk.pedido, 'cancelado', { nota: cancelAsk.nota.trim() })) setCancelAsk(null) }}>{t('ot.cancelOrder')}</button>
            </div>
          </div>
        </div>
      )}

      {deliver && (
        <div className="ord-modal-bg" onClick={() => setDeliver(null)}>
          <div className="ord-modal wide" onClick={e => e.stopPropagation()}>
            <div className="ord-modal-title">{t('configs.deliveryChecklist')} · {orderCode(tracks[deliver.pedido.id], deliver.pedido)}</div>
            {deliver.blocked ? (
              <>
                <p className="ot-err">{t('ot.billingBlock', { bar: deliver.pedido.bars?.nome || '', list: deliver.blocked.map(k => t(`ot.billing.${k}`)).join(', ') })}</p>
                <div className="ord-modal-actions">
                  <button type="button" className="ord-ghost" onClick={() => setDeliver(null)}>{t('common.close')}</button>
                  <button type="button" className="btn-primary" onClick={() => navigate(pathForTab('hq', 'bars'))}>{t('ot.openBars')}</button>
                </div>
              </>
            ) : (
              <>
                <p className="ot-lead">{t(tracks[deliver.pedido.id]?.recebimento ? 'ot.deliverLeadCounted' : 'ot.deliverLead')}</p>
                {(deliver.pedido.pedidos_itens || []).map(it => {
                  const on = !!deliver.checks[it.id]
                  const got = tracks[deliver.pedido.id]?.recebimento?.linhas?.find(x => x.id === it.id)
                  return (
                    <button type="button" key={it.id} className={`ot-check${on ? ' is-on' : ''}`} onClick={() => setDeliver(d => ({ ...d, checks: { ...d.checks, [it.id]: !on } }))}>
                      <span className="ot-box">{on ? '✓' : ''}</span>
                      <span className="ot-check-name">{it.produtos?.nome}<small>{it.qtd} {orRaw(t, `ot.units.${lineUnit(it, tracks[deliver.pedido.id])}`, lineUnit(it, tracks[deliver.pedido.id]))} × {fmtYen(it.preco_unitario)}{got ? ` · ${t('ot.barCounted', { n: got.recebido, of: got.esperado })}` : ''}</small></span>
                      <b>{fmtYen((+it.preco_unitario || 0) * (+it.qtd || 0))}</b>
                    </button>
                  )
                })}
                <label className="ot-wide">{t('ot.receivedBy')}<input value={deliver.recebido_por} onChange={e => setDeliver(d => ({ ...d, recebido_por: e.target.value }))} placeholder={t('ot.receivedByPh')} /></label>
                <div className="ord-total-bar"><span>{t('common.total')}</span><span>{fmtYen(deliver.pedido.total_estimado)}</span></div>
                <div className="ord-modal-actions">
                  <button type="button" className="ord-ghost" onClick={() => setDeliver(null)}>{t('common.cancel')}</button>
                  <button type="button" className="btn-primary" disabled={!!busy} onClick={confirmDeliver}>
                    {t('configs.markedConfirmDelivery', { checked: Object.values(deliver.checks).filter(Boolean).length, total: Object.values(deliver.checks).length })}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {viewBar && (
        <div className="ot-viewbar" role="dialog" aria-modal="true" aria-label={t('ot.viewAsBar')}>
          <div className="ot-viewbar-head">
            <div><b>{t('ot.viewingAs', { bar: viewBar.bar.nome })}</b><small>{t('ot.readOnly')}</small></div>
            <div className="ui-seg" role="radiogroup" aria-label={t('ot.viewAsBar')}>
              <button type="button" role="radio" aria-checked={!viewBar.manager} onClick={() => setViewBar(v => ({ ...v, manager: false }))}>{t('ot.asBarman')}</button>
              <button type="button" role="radio" aria-checked={viewBar.manager} onClick={() => setViewBar(v => ({ ...v, manager: true }))}>{t('ot.asManager')}</button>
            </div>
            <button type="button" className="ui-btn" onClick={() => setViewBar(null)}>{t('common.close')}</button>
          </div>
          <div className="ot-viewbar-body">
            <BarOrdersTab key={`${viewBar.bar.id}:${viewBar.manager}`} bar={viewBar.bar} manager={viewBar.manager} readOnly section="way" />
          </div>
        </div>
      )}
    </AdminPage>
  )
}
