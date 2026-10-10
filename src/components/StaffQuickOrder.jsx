import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { buildCatalog, searchCatalog } from '../lib/posCatalog'
import { itemVisual, starterPicks } from '../lib/posVisual'
import { floorApi, floorAvailable, loadOpenTabs, newKey, pendingToLines, tabsApi } from '../lib/comandas'
import { cartAdd, cartBump, cartTotals } from '../lib/quickCart'
import { fmtYen } from './utils'
import Icon from './ui/Icon'

const NEW = '__new'

/**
 * Staff add what a table ordered from their own panel, without going to the till.
 * Lines go onto a shared server tab (the same tab the till and the floor see); payment stays on the till.
 * Needs sql/floor_comandas.sql; without it the card points to the till.
 */
export default function StaffQuickOrder({ bar, perfil, onTab }) {
  const { t } = useI18n()
  const [avail, setAvail] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [tabs, setTabs] = useState([])
  const [tables, setTables] = useState([])
  const [tabId, setTabId] = useState('')
  const [newTab, setNewTab] = useState({ nome: '', tableId: '', pessoas: 2 })
  const [cart, setCart] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const refreshTabs = useCallback(async () => {
    const list = await loadOpenTabs(supabase, bar.id)
    setTabs(list)
    return list
  }, [bar.id])

  useEffect(() => {
    let alive = true
    floorAvailable(supabase, bar.id).then(async ok => {
      if (!alive) return
      setAvail(ok)
      if (!ok) return
      const [dR, sR] = await Promise.all([
        supabase.from('drink_menu').select('*').eq('bar_id', bar.id).order('nome'),
        supabase.from('bar_pricing').select('*, produtos(nome,categoria,preco_venda)').eq('bar_id', bar.id),
      ])
      if (!alive) return
      setCatalog(buildCatalog(dR.error ? [] : dR.data || [], sR.error ? [] : sR.data || []))
      const list = await refreshTabs().catch(() => [])
      if (alive) setTabId(cur => cur || list[0]?.id || NEW)
      const layouts = await floorApi.layouts(supabase, bar.id).catch(() => [])
      const active = layouts.find(l => l.ativo) || layouts[0]
      if (active) {
        const r = await floorApi.layout(supabase, active.id).catch(() => null)
        if (alive && r) setTables(r.tables.filter(x => x.ativo !== false))
      }
    }).catch(e => { if (alive) { setAvail(false); setMsg({ tone: 'danger', text: errText(e) }) } })
    return () => { alive = false }
  }, [bar.id, refreshTabs])

  const picks = useMemo(() => {
    if (q.trim()) return searchCatalog(catalog, q).slice(0, 12)
    const byKey = new Map(catalog.map(i => [i.key, i]))
    return starterPicks(catalog, 8).map(k => byKey.get(k)).filter(Boolean)
  }, [catalog, q])
  const totals = cartTotals(cart)
  const busyTables = new Set(tabs.map(x => x.table_id).filter(Boolean))

  async function send() {
    if (!cart.length) return
    setBusy(true)
    setMsg(null)
    try {
      let id = tabId
      let name = tabs.find(x => x.id === tabId)?.nome || ''
      if (id === NEW) {
        const table = tables.find(x => x.id === newTab.tableId)
        name = newTab.nome.trim() || table?.nome || t('staffOrder.walkIn')
        id = await tabsApi.open(supabase, {
          barId: bar.id, nome: name, tableId: table?.id || null, pessoas: +newTab.pessoas || 1,
          responsavel: perfil?.nome || null, key: newKey('open'),
        })
      }
      await tabsApi.addItems(supabase, id, pendingToLines(cart), newKey('add'))
      setMsg({ tone: 'success', text: t('staffOrder.sent', { n: totals.items, name }) })
      setCart([])
      setQ('')
      setNewTab({ nome: '', tableId: '', pessoas: 2 })
      await refreshTabs()
      setTabId(id)
    } catch (e) {
      setMsg({ tone: 'danger', text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (avail === null) return null

  return (
    <section className="desk-card sqo" aria-label={t('staffOrder.title')}>
      <div className="sqo-head">
        <h3><Icon name="comandas" size={17} /> {t('staffOrder.title')}</h3>
        <p className="desk-note">{t('staffOrder.lead')}</p>
      </div>

      {!avail ? (
        <div className="sqo-off">
          <p className="desk-note">{t('staffOrder.needsSql')}</p>
          <button type="button" className="ui-btn is-primary" onClick={() => onTab?.('pos')}><Icon name="pos" size={16} /> {t('employee.openTill')}</button>
        </div>
      ) : (
        <>
          <div className="sqo-tabs" role="radiogroup" aria-label={t('staffOrder.which')}>
            {tabs.map(x => (
              <button key={x.id} type="button" role="radio" aria-checked={tabId === x.id} className="sqo-tab" onClick={() => setTabId(x.id)}>
                <strong>{x.mesa_nome || x.nome}</strong>
                <small>{x.mesa_nome && x.mesa_nome !== x.nome ? `${x.nome} · ` : ''}{t('staffOrder.items', { n: x.itens_qtd || 0 })}</small>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={tabId === NEW} className="sqo-tab is-new" onClick={() => setTabId(NEW)}>
              <strong><Icon name="plus" size={14} /> {t('staffOrder.newTab')}</strong>
              <small>{t('staffOrder.newTabSub')}</small>
            </button>
          </div>

          {tabId === NEW && (
            <div className="sqo-new">
              <label className="ui-field"><span>{t('staffOrder.table')}</span>
                <select value={newTab.tableId} onChange={e => setNewTab(v => ({ ...v, tableId: e.target.value }))}>
                  <option value="">{t('staffOrder.noTable')}</option>
                  {tables.map(x => <option key={x.id} value={x.id}>{x.nome}{busyTables.has(x.id) ? ` · ${t('staffOrder.busy')}` : ''}</option>)}
                </select>
              </label>
              <label className="ui-field"><span>{t('staffOrder.name')}</span>
                <input value={newTab.nome} onChange={e => setNewTab(v => ({ ...v, nome: e.target.value }))} placeholder={tables.find(x => x.id === newTab.tableId)?.nome || t('staffOrder.walkIn')} />
              </label>
              <label className="ui-field sqo-ppl"><span>{t('staffOrder.people')}</span>
                <input type="number" min="1" max="99" value={newTab.pessoas} onChange={e => setNewTab(v => ({ ...v, pessoas: e.target.value }))} />
              </label>
            </div>
          )}

          <label className="sqo-search">
            <Icon name="search" size={16} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('staffOrder.search')} aria-label={t('staffOrder.search')} />
          </label>
          <div className="sqo-grid">
            {picks.map(item => {
              const v = itemVisual(item)
              const inCart = cart.find(l => l.key === item.key)?.qtd || 0
              return (
                <button key={item.key} type="button" className={`sqo-item${inCart ? ' is-on' : ''}`} onClick={() => setCart(c => cartAdd(c, item))}>
                  <span className="sqo-pic" style={v.image ? { backgroundImage: `url(${v.image})` } : { background: v.background }} aria-hidden="true">{!v.image && v.emoji}</span>
                  <span className="sqo-name">{item.nome}</span>
                  <span className="sqo-price num">{fmtYen(item.preco_venda)}</span>
                  {inCart > 0 && <span className="sqo-count">{inCart}</span>}
                </button>
              )
            })}
            {!picks.length && <p className="desk-note">{t('staffOrder.noItems')}</p>}
          </div>

          {cart.length > 0 && (
            <ul className="sqo-cart">
              {cart.map(l => (
                <li key={l.key}>
                  <span>{l.nome}</span>
                  <div className="sqo-qty">
                    <button type="button" className="ui-btn is-icon is-sm" onClick={() => setCart(c => cartBump(c, l.key, -1))} aria-label={t('staffOrder.less', { name: l.nome })}><Icon name="minus" size={14} /></button>
                    <b className="num">{l.qtd}</b>
                    <button type="button" className="ui-btn is-icon is-sm" onClick={() => setCart(c => cartBump(c, l.key, 1))} aria-label={t('staffOrder.more', { name: l.nome })}><Icon name="plus" size={14} /></button>
                  </div>
                  <span className="num">{fmtYen(l.qtd * l.preco_unitario)}</span>
                </li>
              ))}
            </ul>
          )}

          {msg && <div className={msg.tone === 'success' ? 'ui-badge is-success sqo-msg' : 'ui-error sqo-msg'} role={msg.tone === 'success' ? 'status' : 'alert'}>{msg.text}</div>}
          <button type="button" className="ui-btn is-primary is-lg sqo-send" disabled={busy || !cart.length || !tabId} onClick={send}>
            <Icon name="send" size={16} /> {busy ? t('common.saving') : cart.length ? t('staffOrder.send', { n: totals.items, amount: fmtYen(totals.total) }) : t('staffOrder.pick')}
          </button>
          <p className="desk-note">{t('staffOrder.payOnTill')}</p>
        </>
      )}
    </section>
  )
}
