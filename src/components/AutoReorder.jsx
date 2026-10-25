import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { staffFetch } from '../lib/apiAuth'
import { loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { nextMonday, nextReorderDate, orderQtyFor, reorderLines, shouldDraftReorder, wantedDelivery } from '../lib/barReorder'
import { tokyoDateKey } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'
import { useAuth } from './Auth'

const MODES = ['queda', 'volume', 'segunda']
const DAYS = [1, 2, 3, 4, 5, 6, 0]

export default function AutoReorder({ bar, products = [], orders = [], onMinimo }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const cached = peekBarTeam()?.goals || {}
  const [goals, setGoals] = useState(cached)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [qtyDraft, setQtyDraft] = useState(String(cached.pedido_qtd || 1))
  const [minDraft, setMinDraft] = useState(String(cached.pedido_min || 0))
  const [find, setFind] = useState('')
  const placing = useRef(false)

  useEffect(() => {
    loadBarTeam().then(j => { if (!j?.error) setGoals(j.goals || {}) }).catch(() => {})
  }, [bar?.id])

  useEffect(() => {
    setQtyDraft(String(goals.pedido_qtd || 1))
    setMinDraft(String(goals.pedido_min || 0))
  }, [goals.pedido_qtd, goals.pedido_min])

  const modo = goals.pedido_modo || 'queda'
  const qtd = goals.pedido_qtd || 1
  const threshold = goals.pedido_min || 0
  const today = tokyoDateKey()
  const when = modo === 'segunda' ? (goals.pedido_em || nextMonday(today)) : (goals.pedido_em || today)
  const openIds = new Set()
  for (const p of orders || []) {
    if (p.status === 'entregue' || p.status === 'cancelado') continue
    for (const it of p.pedidos_itens || []) {
      if (it.produto_id) openIds.add(it.produto_id)
    }
  }
  const qtys = goals.pedido_qtds || {}
  const entrega = goals.pedido_entrega ?? null
  const lines = reorderLines({ products, modo, orderQty: qtd, threshold, openIds, qtys })
  const counted = products.filter(p => p.hasCount)
  const shown = (find ? counted.filter(p => String(p.nome || '').toLowerCase().includes(find.toLowerCase())) : counted)
    .slice().sort((a, b) => (b.attention ? 1 : 0) - (a.attention ? 1 : 0) || String(a.nome || '').localeCompare(String(b.nome || '')))

  async function save(patch) {
    setBusy(true)
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveCloseSettings', ...patch }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.goals) setGoals(json.goals)
    else setGoals(prev => ({ ...prev, ...patch, ...(patch.pedido_qtds ? { pedido_qtds: { ...(prev.pedido_qtds || {}), ...patch.pedido_qtds } } : {}) }))
    setBusy(false)
    return res.ok
  }

  async function place(force) {
    if (placing.current) return false
    const due = force || shouldDraftReorder({ modo, today, lastRun: goals.pedido_feito, scheduled: modo === 'queda' ? '' : when })
    if (!due || !lines.length) {
      setNote(lines.length ? t('portal.reorder.wait', { date: when }) : t('portal.reorder.none'))
      return false
    }
    placing.current = true
    setBusy(true)
    try {
      const total = lines.reduce((a, it) => a + it.qtd * it.preco_unitario, 0)
      const { data: pedido, error } = await supabase.from('pedidos').insert({
        bar_id: bar.id,
        criado_por: user?.id || null,
        status: 'pendente',
        data_pedido: today,
        data_entrega_prevista: wantedDelivery(today, entrega) || null,
        obs: `Auto JBM · ${modo}`,
        total_estimado: Math.round(total),
      }).select().single()
      if (error || !pedido) {
        setNote(t('portal.reorder.fail'))
        return false
      }
      await supabase.from('pedidos_itens').insert(lines.map(it => ({
        pedido_id: pedido.id,
        produto_id: it.produto_id,
        qtd: it.qtd,
        preco_unitario: it.preco_unitario,
      })))
      const next = nextReorderDate(modo, today)
      setGoals(prev => ({ ...prev, pedido_feito: today, pedido_em: next }))
      await save({ pedido_feito: today, pedido_em: next })
      setNote(t('portal.reorder.done', { count: lines.length, date: next }))
      return true
    } finally {
      setBusy(false)
      placing.current = false
    }
  }

  useEffect(() => {
    if (!bar?.id || !products.length) return
    if (!shouldDraftReorder({ modo, today, lastRun: goals.pedido_feito, scheduled: modo === 'queda' ? '' : when }) || !lines.length) return
    place(true)
    // One draft per day. place() refuses a second call while the first is in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bar?.id, modo, today, goals.pedido_feito, when, lines.length])

  return (
    <section className="house-block">
      <h2>{t('portal.reorder.title')}</h2>
      <p>{t('portal.reorder.lead')}</p>
      <div className="goal-modes">
        {MODES.map(id => (
          <button key={id} type="button" className={modo === id ? 'is-on' : ''} disabled={busy} onClick={() => save({ pedido_modo: id, pedido_em: id === 'segunda' ? nextMonday(today) : today })}>
            {t(`portal.reorder.mode.${id}`)}
          </button>
        ))}
      </div>
      <div className="house-editor">
        <label>
          {t('portal.reorder.qty')}
          <input type="number" min="1" value={qtyDraft} onChange={e => setQtyDraft(e.target.value)} onBlur={() => save({ pedido_qtd: qtyDraft })} />
        </label>
        {modo === 'volume' && (
          <label>
            {t('portal.reorder.threshold')}
            <input type="number" min="0" value={minDraft} onChange={e => setMinDraft(e.target.value)} onBlur={() => save({ pedido_min: minDraft })} />
          </label>
        )}
        <label>
          {t('portal.reorder.date')}
          <input type="date" value={when} onChange={e => save({ pedido_em: e.target.value })} />
        </label>
      </div>
      <div className="reorder-label">{t('portal.reorder.delivery')}</div>
      <div className="goal-modes">
        <button type="button" className={entrega == null ? 'is-on' : ''} disabled={busy} onClick={() => save({ pedido_entrega: null })}>
          {t('portal.reorder.anyDay')}
        </button>
        {DAYS.map(d => (
          <button key={d} type="button" className={entrega === d ? 'is-on' : ''} disabled={busy} onClick={() => save({ pedido_entrega: d })}>
            {t(`portal.reorder.day${d}`)}
          </button>
        ))}
      </div>
      {entrega != null && <p className="desk-note">{t('portal.reorder.deliveryNext', { date: wantedDelivery(when < today ? today : when, entrega) })}</p>}
      <details className="reorder-per">
        <summary>{t('portal.reorder.perProduct', { count: counted.length })}</summary>
        <p className="desk-note">{t('portal.reorder.perLead', { qty: qtd })}</p>
        <input type="search" className="reorder-find" aria-label={t('portal.reorder.perSearch')} placeholder={t('portal.reorder.perSearch')} value={find} onChange={e => setFind(e.target.value)} />
        <div className="reorder-grid">
          <div className="reorder-row is-head">
            <span />
            <span>{t('portal.reorder.colStock')}</span>
            <span>{t('portal.reorder.colMin')}</span>
            <span>{t('portal.reorder.colOrder')}</span>
          </div>
          {shown.map(p => (
            <div key={p.id} className={`reorder-row${p.attention ? ' is-alert' : ''}`}>
              <span className="reorder-name">{p.nome}</span>
              <span className="reorder-stock">{p.stock}</span>
              <input key={`m${p.minimo}`} type="number" min="0" inputMode="numeric" aria-label={`${p.nome} ${t('portal.reorder.colMin')}`}
                defaultValue={p.minimo || ''} placeholder="0"
                onBlur={e => { if ((+e.target.value || 0) !== (+p.minimo || 0)) onMinimo?.(p.id, e.target.value) }} />
              <input key={`q${qtys[p.id] || 0}`} type="number" min="0" max="99" inputMode="numeric" aria-label={`${p.nome} ${t('portal.reorder.colOrder')}`}
                defaultValue={qtys[p.id] || ''} placeholder={String(orderQtyFor(p.id, {}, qtd))}
                onBlur={e => { if ((+e.target.value || 0) !== (+qtys[p.id] || 0)) save({ pedido_qtds: { [p.id]: +e.target.value || 0 } }) }} />
            </div>
          ))}
        </div>
      </details>
      <p className="desk-note">
        {lines.length
          ? t('portal.reorder.ready', { count: lines.length, qty: lines.reduce((a, it) => a + it.qtd, 0) })
          : t('portal.reorder.none')}
      </p>
      {note && <p className="desk-note">{note}</p>}
      <button type="button" className="btn-primary" disabled={busy || !lines.length} onClick={() => place(true)}>{t('portal.reorder.now')}</button>
    </section>
  )
}
