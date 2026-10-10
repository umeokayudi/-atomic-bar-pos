import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../lib/i18n'
import { useAuth } from '../Auth'
import { isConflict, loadTabEvents, newKey, splitEvenly, tabMoney, tabsApi, validateMoves } from '../../lib/comandas'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'

const METHODS = [
  { id: 'Cash', icon: 'payCash', key: 'atomicPos.payCash' },
  { id: 'Credit card', icon: 'payCard', key: 'atomicPos.payCard' },
  { id: 'PayPay', icon: 'payPhone', key: 'atomicPos.payPaypay' },
]
const SECTIONS = ['items', 'pay', 'transfer', 'split', 'merge', 'details', 'history']

/**
 * Everything you can do to one open tab, each step a single server call (sql/floor_comandas.sql):
 * quantities, partial payments, transfer lines, split, merge, move table, details, history, reopen, cancel.
 * Closing (the sale itself) happens in the till, which commits it atomically.
 */
export default function TabPanel({ tab, tabs = [], tables = [], settings = {}, onChanged, onClose, onCharge }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const isManager = ['admin', 'jbm', 'cliente', 'gerente'].includes(perfil?.role)
  const [section, setSection] = useState('items')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const money = useMemo(() => tabMoney(tab, tab.items, tab.payments, settings), [tab, settings])
  const others = tabs.filter(x => x.id !== tab.id && x.status === 'open')
  const locked = tab.status !== 'open'

  async function act(fn) {
    setBusy(true)
    setErr('')
    try {
      await fn()
      await onChanged?.()
      return true
    } catch (e) {
      setErr(isConflict(e) ? t('tabs.errConflict') : t('tabs.errGeneric', { error: e.message }))
      await onChanged?.()
      return false
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="ui-drawer-scrim" onClick={onClose} />
      <aside className="ui-drawer tab-panel" role="dialog" aria-modal="true" aria-label={tab.nome}>
        <div className="ui-drawer-head">
          <span className="ui-kpi-icon"><Icon name="comandas" size={18} /></span>
          <div className="ui-drawer-title">
            {tab.nome}
            <div className="ui-card-sub">
              {tab.mesa_nome ? `${tab.mesa_nome} · ` : ''}{t('tabs.people', { n: tab.pessoas })}
              {tab.responsavel_nome ? ` · ${tab.responsavel_nome}` : ''}
            </div>
          </div>
          <button type="button" className="ui-btn is-ghost is-icon" onClick={onClose} aria-label={t('common.close')}><Icon name="close" /></button>
        </div>

        <div className="tab-money">
          <div><span>{t('tabs.total')}</span><strong>{fmtYen(money.total)}</strong></div>
          <div><span>{t('tabs.paid')}</span><strong>{fmtYen(money.paid)}</strong></div>
          <div><span>{t('tabs.due')}</span><strong className={money.due > 0 ? '' : 'txt-success'}>{fmtYen(money.due)}</strong></div>
        </div>
        {locked && (
          <div className="tab-locked">
            <Icon name="lock" size={14} /> {t('tabs.lockedHint')}
            <button type="button" className="ui-btn is-sm" disabled={busy} onClick={() => act(() => tabsApi.reopen(supabase, tab.id))}>
              <Icon name="reopen" size={14} /> {t('tabs.reopen')}
            </button>
          </div>
        )}

        <div className="ui-tabs tab-sections" role="tablist">
          {SECTIONS.map(s => (
            <button key={s} type="button" role="tab" className="ui-tab" aria-selected={section === s} onClick={() => { setSection(s); setErr('') }}>{t(`tabs.sec.${s}`)}</button>
          ))}
        </div>

        <div className="ui-drawer-body">
          {err && <div className="ui-error tab-err" role="alert"><Icon name="warning" />{err}</div>}
          {section === 'items' && <ItemsSection tab={tab} money={money} busy={busy || locked} act={act} />}
          {section === 'pay' && <PaySection tab={tab} money={money} busy={busy} act={act} isManager={isManager} />}
          {section === 'transfer' && <TransferSection tab={tab} money={money} others={others} busy={busy || locked} act={act} onDone={() => setSection('items')} />}
          {section === 'split' && <SplitSection tab={tab} money={money} busy={busy || locked} act={act} onDone={() => setSection('items')} />}
          {section === 'merge' && <MergeSection tab={tab} others={others} busy={busy || locked} act={act} />}
          {section === 'details' && <DetailsSection tab={tab} tables={tables} tabs={tabs} busy={busy} act={act} money={money} onClose={onClose} />}
          {section === 'history' && <HistorySection tab={tab} />}
        </div>

        {onCharge && (
          <div className="ui-drawer-foot">
            <button type="button" className="ui-btn is-primary is-lg tab-charge" disabled={busy || !money.lines.length} onClick={() => onCharge(tab)}>
              <Icon name="pos" size={18} /> {money.due > 0 ? t('tabs.chargeDue', { amount: fmtYen(money.due) }) : t('tabs.closeSale')}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}

function ItemsSection({ tab, money, busy, act }) {
  const { t } = useI18n()
  if (!money.lines.length) return <div className="ui-empty"><Icon name="comandas" size={22} /><div className="ui-empty-title">{t('tabs.noLines')}</div><div>{t('tabs.noLinesHint')}</div></div>
  return (
    <>
      <ul className="tab-lines">
        {money.lines.map(l => (
          <li key={l.item_id}>
            <div className="tab-line-name"><strong>{l.nome}</strong><span className="ui-muted">{fmtYen(l.preco_unitario)}{l.obs ? ` · ${l.obs}` : ''}</span></div>
            <div className="tab-qty">
              <button type="button" className="ui-btn is-icon is-sm" disabled={busy} aria-label={t('tabs.less', { name: l.nome })}
                onClick={() => act(() => tabsApi.setQty(supabase, l.item_id, l.qtd - 1))}><Icon name="minus" size={14} /></button>
              <span>{l.qtd}</span>
              <button type="button" className="ui-btn is-icon is-sm" disabled={busy} aria-label={t('tabs.more', { name: l.nome })}
                onClick={() => act(() => tabsApi.setQty(supabase, l.item_id, l.qtd + 1))}><Icon name="plus" size={14} /></button>
            </div>
            <strong className="num">{fmtYen(l.preco_unitario * l.qtd)}</strong>
          </li>
        ))}
      </ul>
      {money.charges.length > 0 && (
        <ul className="tab-charges">
          {money.charges.map(c => <li key={c.key}><span>{c.kind === 'service' ? t('posQuick.service', { pct: tab.service_pct }) : c.nome}</span><span className="num">{fmtYen(c.preco)}</span></li>)}
        </ul>
      )}
    </>
  )
}

function PaySection({ tab, money, busy, act, isManager }) {
  const { t } = useI18n()
  const [valor, setValor] = useState('')
  const [metodo, setMetodo] = useState('Cash')
  const [pagador, setPagador] = useState('')
  const [people, setPeople] = useState(Math.max(1, tab.pessoas || 1))
  const [payKey, setPayKey] = useState(() => newKey('pay'))
  const parts = splitEvenly(money.due, people)
  const amount = Math.round(+valor || 0)

  async function pay(e) {
    e.preventDefault()
    if (amount <= 0) return
    const ok = await act(() => tabsApi.pay(supabase, tab.id, { valor: amount, metodo, pagador: pagador.trim() || null, key: payKey }))
    if (ok) { setValor(''); setPagador(''); setPayKey(newKey('pay')) }
  }

  return (
    <div className="tab-section">
      <form className="tab-pay" onSubmit={pay}>
        <label className="ui-field"><span>{t('tabs.amount')}</span>
          <input type="number" inputMode="numeric" min="1" step="1" value={valor} onChange={e => { setValor(e.target.value); setPayKey(newKey('pay')) }} placeholder={String(money.due)} />
        </label>
        <div className="ui-row tab-quick">
          <button type="button" className="ui-btn is-sm" onClick={() => setValor(String(money.due))} disabled={!money.due}>{t('tabs.payAll')}</button>
          {parts.length > 1 && <button type="button" className="ui-btn is-sm" onClick={() => setValor(String(parts[0]))}>{t('tabs.payShare', { amount: fmtYen(parts[0]) })}</button>}
        </div>
        <div className="ui-seg" role="radiogroup" aria-label={t('tabs.method')}>
          {METHODS.map(m => (
            <button key={m.id} type="button" role="radio" aria-checked={metodo === m.id} onClick={() => setMetodo(m.id)}><Icon name={m.icon} size={14} />{t(m.key)}</button>
          ))}
        </div>
        <label className="ui-field"><span>{t('tabs.payer')}</span><input value={pagador} onChange={e => setPagador(e.target.value)} placeholder={t('common.optional')} /></label>
        <button type="submit" className="ui-btn is-primary" disabled={busy || amount <= 0}><Icon name="partialPay" size={16} /> {t('tabs.registerPay', { amount: fmtYen(amount) })}</button>
        {amount > money.due && money.due > 0 && <div className="ui-muted">{t('tabs.overpay', { amount: fmtYen(amount - money.due) })}</div>}
      </form>

      <div className="tab-split-people">
        <label className="ui-field"><span>{t('tabs.splitPeople')}</span>
          <input type="number" min="1" max="50" value={people} onChange={e => setPeople(Math.max(1, Math.min(50, +e.target.value || 1)))} />
        </label>
        <div className="ui-muted">{parts.length > 1 ? parts.map(fmtYen).join(' · ') : fmtYen(money.due)}</div>
      </div>

      <h4 className="tab-h">{t('tabs.payments')}</h4>
      {tab.payments.length === 0 && <div className="ui-muted">{t('tabs.noPayments')}</div>}
      <ul className="tab-lines">
        {tab.payments.map(p => (
          <li key={p.id}>
            <div className="tab-line-name"><strong>{fmtYen(p.valor)}</strong><span className="ui-muted">{p.metodo}{p.pagador ? ` · ${p.pagador}` : ''} · {new Date(p.criado_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
            {isManager && (
              <button type="button" className="ui-btn is-danger is-sm" disabled={busy}
                onClick={() => { const r = window.prompt(t('tabs.voidReason')); if (r) act(() => tabsApi.voidPayment(supabase, p.id, r)) }}>{t('tabs.void')}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function MovePicker({ lines, moves, setMoves }) {
  const { t } = useI18n()
  return (
    <ul className="tab-lines">
      {lines.map(l => {
        const q = moves[l.item_id] || 0
        return (
          <li key={l.item_id}>
            <div className="tab-line-name"><strong>{l.nome}</strong><span className="ui-muted">{t('tabs.ofQty', { n: l.qtd })}</span></div>
            <div className="tab-qty">
              <button type="button" className="ui-btn is-icon is-sm" aria-label="−1" disabled={!q} onClick={() => setMoves(m => ({ ...m, [l.item_id]: Math.max(0, q - 1) }))}><Icon name="minus" size={14} /></button>
              <span>{q}</span>
              <button type="button" className="ui-btn is-icon is-sm" aria-label="+1" disabled={q >= l.qtd} onClick={() => setMoves(m => ({ ...m, [l.item_id]: Math.min(l.qtd, q + 1) }))}><Icon name="plus" size={14} /></button>
            </div>
            <button type="button" className="ui-btn is-ghost is-sm" onClick={() => setMoves(m => ({ ...m, [l.item_id]: l.qtd }))}>{t('tabs.allQty')}</button>
          </li>
        )
      })}
    </ul>
  )
}

const movesList = moves => Object.entries(moves).filter(([, q]) => q > 0).map(([item, qtd]) => ({ item, qtd }))

function TransferSection({ tab, money, others, busy, act, onDone }) {
  const { t } = useI18n()
  const [moves, setMoves] = useState({})
  const [to, setTo] = useState(others[0]?.id || '')
  const [err, setErr] = useState('')
  async function go() {
    const list = movesList(moves)
    const v = validateMoves(list, money.lines)
    if (v) { setErr(t(v)); return }
    if (!to) { setErr(t('tabs.errPickTab')); return }
    if (await act(() => tabsApi.transfer(supabase, tab.id, to, list))) { setMoves({}); onDone() }
  }
  if (!money.lines.length) return <div className="ui-muted">{t('tabs.noLines')}</div>
  return (
    <div className="tab-section">
      <p className="ui-muted">{t('tabs.transferHint')}</p>
      <MovePicker lines={money.lines} moves={moves} setMoves={setMoves} />
      <label className="ui-field"><span>{t('tabs.toTab')}</span>
        <select value={to} onChange={e => setTo(e.target.value)}>
          {others.length === 0 && <option value="">{t('tabs.noOtherTabs')}</option>}
          {others.map(o => <option key={o.id} value={o.id}>{o.nome}{o.mesa_nome ? ` · ${o.mesa_nome}` : ''}</option>)}
        </select>
      </label>
      {err && <div className="ui-error" role="alert"><Icon name="warning" />{err}</div>}
      <button type="button" className="ui-btn is-primary" disabled={busy || !others.length} onClick={go}><Icon name="transfer" size={16} /> {t('tabs.transfer')}</button>
    </div>
  )
}

function SplitSection({ tab, money, busy, act, onDone }) {
  const { t } = useI18n()
  const [moves, setMoves] = useState({})
  const [nome, setNome] = useState(`${tab.nome} 2`)
  const [err, setErr] = useState('')
  async function go() {
    const list = movesList(moves)
    const v = validateMoves(list, money.lines)
    if (v) { setErr(t(v)); return }
    if (await act(() => tabsApi.split(supabase, tab.id, [{ nome: nome.trim() || `${tab.nome} 2`, moves: list }]))) { setMoves({}); onDone() }
  }
  if (!money.lines.length) return <div className="ui-muted">{t('tabs.noLines')}</div>
  return (
    <div className="tab-section">
      <p className="ui-muted">{t('tabs.splitHint')}</p>
      <MovePicker lines={money.lines} moves={moves} setMoves={setMoves} />
      <label className="ui-field"><span>{t('tabs.newTabName')}</span><input value={nome} onChange={e => setNome(e.target.value)} /></label>
      {err && <div className="ui-error" role="alert"><Icon name="warning" />{err}</div>}
      <button type="button" className="ui-btn is-primary" disabled={busy} onClick={go}><Icon name="split" size={16} /> {t('tabs.split')}</button>
      <p className="ui-muted">{t('tabs.splitValueHint')}</p>
    </div>
  )
}

function MergeSection({ tab, others, busy, act }) {
  const { t } = useI18n()
  const [from, setFrom] = useState(others[0]?.id || '')
  return (
    <div className="tab-section">
      <p className="ui-muted">{t('tabs.mergeHint', { name: tab.nome })}</p>
      <label className="ui-field"><span>{t('tabs.mergeFrom')}</span>
        <select value={from} onChange={e => setFrom(e.target.value)}>
          {others.length === 0 && <option value="">{t('tabs.noOtherTabs')}</option>}
          {others.map(o => <option key={o.id} value={o.id}>{o.nome}{o.mesa_nome ? ` · ${o.mesa_nome}` : ''}</option>)}
        </select>
      </label>
      <button type="button" className="ui-btn is-primary" disabled={busy || !from} onClick={() => act(() => tabsApi.merge(supabase, from, tab.id))}>
        <Icon name="merge" size={16} /> {t('tabs.merge')}
      </button>
    </div>
  )
}

function DetailsSection({ tab, tables, tabs, busy, act, money, onClose }) {
  const { t } = useI18n()
  const [form, setForm] = useState({ nome: tab.nome, pessoas: tab.pessoas, responsavel: tab.responsavel_nome || '', obs: tab.obs || '', service: tab.service_pct })
  const [table, setTable] = useState(tab.table_id || '')
  const busyTables = new Set(tabs.filter(x => x.id !== tab.id && x.table_id).map(x => x.table_id))
  return (
    <div className="tab-section">
      <form className="growth-form" onSubmit={e => { e.preventDefault(); act(() => tabsApi.update(supabase, tab.id, { nome: form.nome, pessoas: +form.pessoas || 1, responsavel: form.responsavel, obs: form.obs, servicePct: +form.service || 0 })) }}>
        <label className="ui-field"><span>{t('tabs.name')}</span><input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} /></label>
        <div className="ui-grid cols-2">
          <label className="ui-field"><span>{t('tabs.peopleLabel')}</span><input type="number" min="1" value={form.pessoas} onChange={e => setForm(f => ({ ...f, pessoas: e.target.value }))} /></label>
          <label className="ui-field"><span>{t('tabs.servicePct')}</span><input type="number" min="0" max="100" value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} /></label>
        </div>
        <label className="ui-field"><span>{t('tabs.responsible')}</span><input value={form.responsavel} onChange={e => setForm(f => ({ ...f, responsavel: e.target.value }))} /></label>
        <label className="ui-field"><span>{t('common.notes')}</span><textarea rows={2} value={form.obs} onChange={e => setForm(f => ({ ...f, obs: e.target.value }))} /></label>
        <button type="submit" className="ui-btn is-primary" disabled={busy}><Icon name="save" size={16} /> {t('common.save')}</button>
      </form>

      <h4 className="tab-h">{t('tabs.moveTable')}</h4>
      <div className="ui-row">
        <select value={table} onChange={e => setTable(e.target.value)} aria-label={t('tabs.moveTable')}>
          <option value="">{t('tabs.noTable')}</option>
          {tables.filter(x => x.ativo !== false).map(x => <option key={x.id} value={x.id} disabled={busyTables.has(x.id)}>{x.nome}{busyTables.has(x.id) ? ` (${t('tabs.busy')})` : ''}</option>)}
        </select>
        <button type="button" className="ui-btn" disabled={busy || table === (tab.table_id || '')} onClick={() => act(() => tabsApi.moveTable(supabase, tab.id, table || null))}>
          <Icon name="move" size={16} /> {t('tabs.move')}
        </button>
      </div>

      {!money.lines.length && !money.paid && (
        <>
          <h4 className="tab-h">{t('tabs.cancelTitle')}</h4>
          <button type="button" className="ui-btn is-danger" disabled={busy}
            onClick={async () => { if (await act(() => tabsApi.cancel(supabase, tab.id, 'empty'))) onClose?.() }}>
            <Icon name="trash" size={16} /> {t('tabs.cancelEmpty')}
          </button>
        </>
      )}
    </div>
  )
}

function HistorySection({ tab }) {
  const { t } = useI18n()
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    loadTabEvents(supabase, tab.id).then(r => { if (alive) setRows(r) }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [tab.id, tab.versao])
  if (!rows) return <div className="ui-skel" style={{ height: 80 }} />
  return (
    <ol className="tab-history">
      {rows.map(r => (
        <li key={r.id}>
          <span className="ui-muted num">{new Date(r.criado_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span>{t(`tabs.ev.${r.tipo}`)}{r.dados?.valor ? ` · ${fmtYen(r.dados.valor)}` : ''}{r.dados?.reason ? ` · ${r.dados.reason}` : ''}</span>
        </li>
      ))}
    </ol>
  )
}
