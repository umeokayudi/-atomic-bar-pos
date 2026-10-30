import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate, Spinner, PedidoItemChip } from './utils'
import { useI18n } from '../lib/i18n'
import { schemaMissing } from '../lib/fulfillment'
import { buildOwnOrder, ownOrderTotal, ownOrdersSummary } from '../lib/ownOrders'
import { tokyoDateKey, tokyoMonthKey } from '../lib/tokyo'
import { shiftMonth } from '../lib/barCalendar'
import { loadBarTeam } from '../lib/barTeam'
import { supplierChoices } from '../lib/partners'
import Icon from './ui/Icon'
import { askConfirm, notify } from './ui/ConfirmDialog'

const EMPTY_LINE = { nome: '', qtd: '1', preco: '' }

/**
 * Own orders: what the bar buys from its own suppliers. Stays in the bar (bar_own_orders, owner/manager only);
 * nothing is sent to JBM, no JBM order, invoice or notification is created.
 */
export default function OwnOrders({ bar }) {
  const { t } = useI18n()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [fornecedor, setFornecedor] = useState('')
  const [data, setData] = useState(() => tokyoDateKey())
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [obs, setObs] = useState('')
  const [mes, setMes] = useState(() => tokyoMonthKey())
  const [partners, setPartners] = useState([])

  useEffect(() => { load() }, [bar]) // eslint-disable-line react-hooks/exhaustive-deps
  // Business partners the bar registered (drinks, food, ice first); free text still works.
  useEffect(() => {
    loadBarTeam().then(j => setPartners(supplierChoices(j?.registry || []))).catch(() => setPartners([]))
  }, [bar])

  async function load() {
    const res = await supabase.from('bar_own_orders').select('*').eq('bar_id', bar.id).order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(300)
    if (res.error) {
      if (schemaMissing(res.error)) setMissing(true)
      else setErr(res.error.message)
      setRows([])
    } else {
      setMissing(false)
      setRows(res.data || [])
    }
    setLoading(false)
  }

  const suppliers = useMemo(() => {
    const used = rows.map(r => r.fornecedor).filter(Boolean)
    return [...new Set([...partners.map(p => p.nome), ...used.sort()])]
  }, [rows, partners])
  const summary = useMemo(() => ownOrdersSummary(rows, mes), [rows, mes])
  const draftTotal = ownOrderTotal(lines)
  const thisMonth = tokyoMonthKey()
  const prevMonth = shiftMonth(thisMonth, -1)

  function setLine(i, patch) {
    setLines(prev => prev.map((l, j) => j === i ? { ...l, ...patch } : l))
  }

  function reset() {
    setFornecedor(''); setData(tokyoDateKey()); setLines([{ ...EMPTY_LINE }]); setObs(''); setErr('')
  }

  async function save() {
    const built = buildOwnOrder({ barId: bar.id, fornecedor, data, items: lines, obs })
    if (built.error) { setErr(t(built.error === 'supplier' ? 'ownOrders.needSupplier' : 'ownOrders.needItems')); return }
    setSaving(true)
    setErr('')
    const { error } = await supabase.from('bar_own_orders').insert(built.row)
    setSaving(false)
    if (error) { setErr(schemaMissing(error) ? t('ownOrders.notSetUp') : error.message); return }
    reset()
    setOpen(false)
    load()
  }

  async function setStatus(row, status) {
    const { error } = await supabase.from('bar_own_orders').update({ status }).eq('id', row.id)
    if (error) setErr(error.message)
    else setRows(prev => prev.map(r => r.id === row.id ? { ...r, status } : r))
  }

  async function remove(row) {
    if (!(await askConfirm({ title: t('ownOrders.deleteConfirm'), danger: true }))) return
    const { error } = await supabase.from('bar_own_orders').delete().eq('id', row.id)
    if (error) setErr(error.message)
    else setRows(prev => prev.filter(r => r.id !== row.id))
  }

  if (loading) return <Spinner />

  if (missing) {
    return (
      <div className="ui-card ui-empty-state">
        <span className="ui-empty-icon"><Icon name="package" size={22} /></span>
        <p>{t('ownOrders.notSetUp')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="ui-banner own-private-banner" role="note">
        <span className="ui-banner-icon"><Icon name="lock" size={18} /></span>
        <div>
          <strong>{t('ownOrders.title')}</strong>
          <div>{t('ownOrders.lead')}</div>
        </div>
      </div>

      {!open ? (
        <button type="button" className="ui-btn is-primary" style={{ margin: '12px 0' }} onClick={() => { reset(); setOpen(true) }}>
          <Icon name="plus" size={15} /> {t('ownOrders.new')}
        </button>
      ) : (
        <section className="ui-card own-form" aria-label={t('ownOrders.new')} style={{ margin: '12px 0' }}>
          <div className="ui-card-title">{t('ownOrders.new')}</div>
          <div className="own-form-row">
            <label className="ui-field"><span>{t('ownOrders.supplier')}</span>
              <input value={fornecedor} onChange={e => setFornecedor(e.target.value)} list="own-suppliers" placeholder={t('ownOrders.supplierPlaceholder')} autoFocus />
              <datalist id="own-suppliers">{suppliers.map(s => <option key={s} value={s} />)}</datalist>
            </label>
            <label className="ui-field"><span>{t('common.date')}</span>
              <input type="date" value={data} onChange={e => setData(e.target.value)} />
            </label>
          </div>

          {partners.length > 0 && (
            <div className="ord-row-scroll" role="group" aria-label={t('ownOrders.partners')}>
              {partners.map(p => (
                <button key={p.id} type="button" className={`ord-chip${fornecedor === p.nome ? ' is-on' : ''}`} aria-pressed={fornecedor === p.nome} onClick={() => setFornecedor(p.nome)}>
                  {p.emoji ? `${p.emoji} ` : ''}{p.nome}
                </button>
              ))}
            </div>
          )}

          <div className="own-lines">
            <div className="own-line ui-muted" aria-hidden="true" style={{ fontSize: 12 }}>
              <span>{t('ownOrders.item')}</span><span>{t('ownOrders.qty')}</span><span>{t('ownOrders.unitPrice')}</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="own-line">
                <input value={l.nome} onChange={e => setLine(i, { nome: e.target.value })} placeholder={t('ownOrders.itemPlaceholder')} aria-label={t('ownOrders.item')} />
                <input type="number" min="0" inputMode="decimal" value={l.qtd} onChange={e => setLine(i, { qtd: e.target.value })} aria-label={t('ownOrders.qty')} />
                <input type="number" min="0" inputMode="numeric" value={l.preco} onChange={e => setLine(i, { preco: e.target.value })} placeholder="¥" aria-label={t('ownOrders.unitPrice')} />
                <button type="button" className="own-line-del" aria-label={t('portal.orders.remove')} disabled={lines.length === 1} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            <button type="button" className="ui-btn is-sm" style={{ justifySelf: 'start' }} onClick={() => setLines(prev => [...prev, { ...EMPTY_LINE }])}>
              <Icon name="plus" size={13} /> {t('ownOrders.addLine')}
            </button>
          </div>

          <label className="ui-field"><span>{t('common.notes')}</span>
            <textarea rows={2} value={obs} onChange={e => setObs(e.target.value)} />
          </label>

          <div className="own-total"><span>{t('common.total')}</span><span>{fmtYen(draftTotal)}</span></div>
          {err && <div className="pos-sale-err">{err}</div>}
          <div className="ord-modal-actions">
            <button type="button" className="ord-ghost" disabled={saving} onClick={() => { setOpen(false); setErr('') }}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? t('common.saving') : t('ownOrders.save')}</button>
          </div>
        </section>
      )}

      <div className="sup-filter">
        <div className="date-filter">
          <button type="button" className={`date-filter-chip${mes === thisMonth ? ' is-on' : ''}`} onClick={() => setMes(thisMonth)}>{t('portal.home.rangeMonth')}</button>
          <button type="button" className={`date-filter-chip${mes === prevMonth ? ' is-on' : ''}`} onClick={() => setMes(prevMonth)}>{t('portal.home.rangePrev')}</button>
          <button type="button" className={`date-filter-chip${!mes ? ' is-on' : ''}`} onClick={() => setMes('')}>{t('portal.home.rangeAll')}</button>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} aria-label={t('common.month')} />
        </div>
      </div>

      <section className="bill-match is-match sup-sum">
        <div className="bill-match-row"><span>{t('ownOrders.count', { n: summary.count })}</span><b>{fmtYen(summary.total)}</b></div>
      </section>

      {!open && err && <div className="pos-sale-err">{err}</div>}

      {summary.list.length === 0 ? (
        <div className="ui-card ui-empty-state"><span className="ui-empty-icon"><Icon name="package" size={22} /></span><p>{t('ownOrders.empty')}</p></div>
      ) : (
        <div className="sup-list">
          {summary.list.map(r => (
            <article key={r.id} className="ord-card">
              <div className="ord-card-top">
                <div>
                  <div className="own-card-supplier">{r.fornecedor}</div>
                  <div className="ord-card-sub">{fmtDate(r.data)} · {t(`ownOrders.status.${r.status}`)}</div>
                  {r.obs && <div className="ord-details-box compact">{r.obs}</div>}
                </div>
                <div className="ord-card-right"><span className="ord-send-total">{fmtYen(r.total || 0)}</span></div>
              </div>
              <div className="ord-card-items">
                {(r.itens || []).map((it, i) => (
                  <PedidoItemChip key={i} nome={it.nome} qtd={it.qtd} precoUnitario={it.preco} hideCost />
                ))}
              </div>
              <div className="ord-card-actions">
                {r.status === 'ordered' && (
                  <button type="button" className="ui-btn is-sm is-primary" onClick={() => setStatus(r, 'received')}><Icon name="check" size={14} /> {t('ownOrders.markReceived')}</button>
                )}
                {r.status === 'ordered' && (
                  <button type="button" className="ord-ghost" onClick={() => setStatus(r, 'cancelled')}>{t('portal.orders.cancel')}</button>
                )}
                <button type="button" className="ord-ghost danger" onClick={() => remove(r)}>{t('ownOrders.delete')}</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
