import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../Auth'
import { useI18n } from '../../lib/i18n'
import { fmtYen } from '../utils'
import { buildStockMap, cartTotal, findLowStockProducts, pricingMapFromShots, resolveItemPrice } from '../../lib/atomicPos'
import { reorderLowStock, syncPosStockAndReorder } from '../../lib/posSupply'
import { CASH_CHIPS, cashSettle, isCashMethod, payRecordNote } from '../../lib/posPay'
import { drinkBackCommission } from '../../lib/drinkBackPay'
import { DEFAULT_POS_SETTINGS, packTicketObs, settingsFromRow, ticketChargeLines } from '../../lib/nightTicket'
import { tokyoNightKey, tokyoDateKey } from '../../lib/tokyo'
import { itemVisual, rankTopSellers, starterPicks } from '../../lib/posVisual'
import { buildCatalog, searchCatalog, toggleFavorite } from '../../lib/posCatalog'
import { commitSaleAtomic, newSaleKey } from '../../lib/posCommit'
import { floorAvailable, floorApi, isConflict, loadOpenTabs, newKey, pendingToLines, tabMoney, tabsApi } from '../../lib/comandas'
import Icon from '../ui/Icon'
import TabPanel from '../floor/TabPanel'

const PAY = [
  { id: 'Cash', key: 'atomicPos.payCash', icon: 'payCash' },
  { id: 'Credit card', key: 'atomicPos.payCard', icon: 'payCard' },
  { id: 'PayPay', key: 'atomicPos.payPaypay', icon: 'payPhone' },
]
const COUNTER = 'counter'
const SRV = 'srv:'
const POLL_MS = 12000

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}
function missingTable(error) {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message || ''))
}

function Tile({ item, qty, fav, onAdd, onFav, t }) {
  const look = itemVisual(item)
  return (
    <div className={`pq-tile${qty ? ' has-qty' : ''}`}>
      <button type="button" className="pq-tile-hit" onClick={() => onAdd(item)} aria-label={`${item.nome} ${fmtYen(item.preco_venda)}`}>
        <span className="pq-tile-img" style={look.image ? undefined : { background: look.background }}>
          {look.image ? <img src={look.image} alt="" loading="lazy" decoding="async" draggable="false" /> : <Icon name={look.icon} size={28} strokeWidth={1.6} />}
          {qty > 0 && <span className="pq-tile-qty">{qty}</span>}
        </span>
        <span className="pq-tile-name">{item.nome}</span>
        <span className="pq-tile-price">{item.codigo ? <em>{item.codigo}</em> : null}{fmtYen(item.preco_venda)}</span>
      </button>
      <button type="button" className={`pq-fav${fav ? ' is-on' : ''}`} aria-pressed={fav} aria-label={fav ? t('posQuick.unfav', { name: item.nome }) : t('posQuick.fav', { name: item.nome })} onClick={() => onFav(item.key)}>
        <Icon name="star" size={14} />
      </button>
    </div>
  )
}

/**
 * The till. Counter sales and tabs; every sale is one atomic server call with an idempotency key.
 * Tabs live on the server (pos_comandas) when sql/floor_comandas.sql is applied, so every device sees
 * the same tab; otherwise they stay on this device as before.
 */
export default function PosQuick({ bar, drinks = [], shots = [], agents = [], todaySales, catalogError = '', onSale }) {
  const { t } = useI18n()
  const { user, perfil } = useAuth()
  const ordersKey = `pos-orders:${bar.id}`
  const localTopKey = `pos-top:${bar.id}`
  const favKey = `pos-fav:${bar.id}`

  const [orders, setOrders] = useState(() => {
    const saved = readJson(ordersKey, null)
    return saved && saved[COUNTER] ? saved : { [COUNTER]: { cart: [] } }
  })
  const [active, setActive] = useState(() => readJson(`${ordersKey}:active`, COUNTER))
  const [cat, setCat] = useState('top')
  const [query, setQuery] = useState('')
  const [pay, setPay] = useState('Cash')
  const [tendered, setTendered] = useState('')
  const [agentId, setAgentId] = useState('')
  const [serviceOn, setServiceOn] = useState(true)
  const [spaces, setSpaces] = useState([])
  const [settings, setSettings] = useState(DEFAULT_POS_SETTINGS)
  const [topKeys, setTopKeys] = useState([])
  const [favs, setFavs] = useState(() => readJson(favKey, []))
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [tabSheet, setTabSheet] = useState(false)
  const [tabForm, setTabForm] = useState({ nome: '', pessoas: 2, tableId: '' })
  const [orderOpen, setOrderOpen] = useState(false)
  const [server, setServer] = useState(null) // null = checking, true = server tabs, false = device tabs
  const [srvTabs, setSrvTabs] = useState([])
  const [tabsLoaded, setTabsLoaded] = useState(false)
  const [tables, setTables] = useState([])
  const [panelTab, setPanelTab] = useState(null)
  const doneTimer = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => { writeJson(ordersKey, orders) }, [orders, ordersKey])
  useEffect(() => { writeJson(`${ordersKey}:active`, active) }, [active, ordersKey])
  useEffect(() => { writeJson(favKey, favs) }, [favs, favKey])

  useEffect(() => {
    document.documentElement.setAttribute('data-pos-mode', 'quick')
    return () => document.documentElement.removeAttribute('data-pos-mode')
  }, [])

  // Keep the till screen awake during service. Browsers drop the lock when the tab hides.
  useEffect(() => {
    if (!navigator.wakeLock) return undefined
    let lock = null
    let alive = true
    const take = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock.request('screen').then(l => { if (alive) lock = l; else l.release() }).catch(() => {})
    }
    take()
    document.addEventListener('visibilitychange', take)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', take)
      lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const since = new Date(Date.now() - 30 * 86400000)
    Promise.all([
      supabase.from('pos_vendas').select('id').eq('bar_id', bar.id).limit(1),
      supabase.from('bar_spaces').select('id,nome,tipo,zona,ordem,ativo').eq('bar_id', bar.id).eq('ativo', true).order('ordem'),
      supabase.from('pos_vendas_itens')
        .select('drink_menu_id,produto_id,qtd,pos_vendas!inner(bar_id,data)')
        .eq('pos_vendas.bar_id', bar.id)
        .gte('pos_vendas.data', tokyoDateKey(since))
        .limit(5000),
      supabase.from('pos_settings').select('*').eq('bar_id', bar.id).maybeSingle(),
    ]).then(([salesRes, spacesRes, linesRes, settingsRes]) => {
      if (cancelled) return
      setSetupNeeded(missingTable(salesRes.error))
      setSpaces(spacesRes.error ? [] : (spacesRes.data || []))
      const ranked = linesRes.error ? [] : rankTopSellers(linesRes.data || [], 18)
      setTopKeys(ranked.length ? ranked : rankTopSellers(readJson(localTopKey, []), 18))
      if (!settingsRes.error && settingsRes.data) setSettings(settingsFromRow(settingsRes.data))
    }).catch(() => {})
    floorAvailable(supabase, bar.id).then(ok => { if (!cancelled) setServer(ok) }).catch(() => { if (!cancelled) setServer(false) })
    return () => { cancelled = true }
  }, [bar.id, localTopKey])

  const refreshTabs = useCallback(async () => {
    if (!server) return
    try {
      setSrvTabs(await loadOpenTabs(supabase, bar.id))
      setTabsLoaded(true)
    } catch (e) {
      setErr(t('tabs.errGeneric', { error: e.message }))
    }
  }, [server, bar.id, t])

  // Server tabs: load, then refresh while the till is visible (other devices change them too).
  useEffect(() => {
    if (!server) return undefined
    refreshTabs()
    floorApi.layouts(supabase, bar.id)
      .then(list => {
        const layout = list.find(l => l.ativo) || list[0]
        return layout ? floorApi.layout(supabase, layout.id) : { tables: [] }
      })
      .then(({ tables: rows }) => setTables((rows || []).filter(r => r.ativo !== false)))
      .catch(() => setTables([]))
    const id = setInterval(() => { if (document.visibilityState === 'visible') refreshTabs() }, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') refreshTabs() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [server, bar.id, refreshTabs])

  useEffect(() => () => clearTimeout(doneTimer.current), [])

  const catalog = useMemo(() => buildCatalog(drinks || [], shots || []), [drinks, shots])
  const byKey = useMemo(() => new Map(catalog.map(item => [item.key, item])), [catalog])
  const cats = useMemo(() => [...new Set(catalog.map(item => item.categoria))], [catalog])
  const topList = useMemo(() => {
    const ranked = topKeys.map(key => byKey.get(key)).filter(Boolean)
    if (ranked.length >= 4) return { items: ranked, starter: false }
    const fill = starterPicks(catalog, 12).map(key => byKey.get(key)).filter(item => item && !ranked.includes(item))
    return { items: [...ranked, ...fill].slice(0, 12), starter: ranked.length === 0 }
  }, [topKeys, byKey, catalog])
  const favList = useMemo(() => favs.map(k => byKey.get(k)).filter(Boolean), [favs, byKey])

  const q = query.trim()
  const visible = q
    ? searchCatalog(catalog, q)
    : cat === 'top' ? topList.items
      : cat === 'fav' ? favList
        : cat === 'all' ? catalog
          : catalog.filter(item => item.categoria === cat)

  // ── which order is on screen ─────────────────────────────────────────────
  const isSrv = active.startsWith(SRV)
  const srvTab = isSrv ? srvTabs.find(x => x.id === active.slice(SRV.length)) : null
  const localTabIds = Object.keys(orders).filter(id => id !== COUNTER && !id.startsWith(SRV))
  const order = orders[active] || (isSrv ? { cart: [] } : orders[COUNTER])
  const cart = order.cart || [] // lines not yet on the server (or the whole order for counter/device tabs)
  const space = spaces.find(row => row.id === order.spaceId)

  // If the tab we were on was closed elsewhere, fall back to the counter.
  useEffect(() => {
    if (isSrv && server && tabsLoaded && !srvTab && !busy) {
      const timer = setTimeout(() => setActive(a => (a === active ? COUNTER : a)), 0)
      return () => clearTimeout(timer)
    }
    if (!isSrv && active !== COUNTER && !orders[active]) setActive(COUNTER)
    return undefined
  }, [isSrv, server, tabsLoaded, srvTab, busy, active, orders])

  const srvMoney = srvTab ? tabMoney(srvTab, srvTab.items, srvTab.payments, settings) : null
  const qtyByKey = useMemo(() => {
    const map = {}
    for (const line of cart) map[line.key] = (map[line.key] || 0) + line.qtd
    for (const line of srvMoney?.lines || []) {
      const k = line.drink_menu_id ? `d-${line.drink_menu_id}` : line.produto_id ? `p-${line.produto_id}` : ''
      if (k) map[k] = (map[k] || 0) + line.qtd
    }
    return map
  }, [cart, srvMoney])

  const tableOrder = active !== COUNTER
  const pendingTotal = cartTotal(cart)
  const drinksTotal = (srvMoney?.drinksTotal || 0) + pendingTotal
  const charges = srvTab
    ? ticketChargeLines({ drinksTotal, servicePct: +srvTab.service_pct || 0, roomMin: settings.room_min, spaceType: '' })
    : ticketChargeLines({ drinksTotal, servicePct: tableOrder && serviceOn ? settings.service_pct : 0, roomMin: settings.room_min, spaceType: space?.tipo || '' })
  const total = charges.total
  const due = Math.max(0, total - (srvMoney?.paid || 0))
  const itemCount = cart.reduce((a, l) => a + l.qtd, 0) + (srvMoney?.lines || []).reduce((a, l) => a + l.qtd, 0)
  const cashPay = isCashMethod(pay)
  const cash = cashPay ? cashSettle(due, tendered, '') : null
  const short = !!(cash && cash.short)
  const agent = agents.find(row => row.id === agentId)
  const lockedTab = srvTab && srvTab.status !== 'open'
  const hasSomething = cart.length > 0 || (srvMoney?.lines.length || 0) > 0

  function setCart(updater) {
    setOrders(prev => {
      const current = prev[active] || { cart: [] }
      const nextCart = typeof updater === 'function' ? updater(current.cart || []) : updater
      return { ...prev, [active]: { ...current, cart: nextCart, saleKey: undefined } }
    })
  }

  function add(item) {
    setErr('')
    if (lockedTab) { setErr(t('tabs.lockedHint')); return }
    const price = resolveItemPrice(item, 'regular', null)
    setCart(prev => {
      const hit = prev.find(line => line.key === item.key)
      if (hit) return prev.map(line => line.key === item.key ? { ...line, qtd: line.qtd + 1 } : line)
      return [...prev, {
        key: item.key,
        kind: item.kind,
        drink_menu_id: item.kind === 'drink' ? item.id : null,
        produto_id: item.kind === 'shot' ? item.id : null,
        nome: item.nome,
        categoria: item.categoria,
        qtd: 1,
        ...price,
        preco_unitario: price.preco,
      }]
    })
  }

  function bump(key, delta) {
    setCart(prev => prev
      .map(line => line.key === key ? { ...line, qtd: line.qtd + delta } : line)
      .filter(line => line.qtd > 0))
  }

  function switchTo(id) {
    setActive(id)
    setTendered('')
    setErr('')
  }

  async function openTab(e) {
    e?.preventDefault?.()
    const table = tables.find(x => x.id === tabForm.tableId)
    const space = spaces.find(x => x.id === tabForm.tableId)
    const name = String(tabForm.nome || table?.nome || space?.nome || '').trim()
    if (!name) return
    const moving = active === COUNTER ? (orders[COUNTER].cart || []) : []
    if (server) {
      setBusy(true)
      try {
        const existing = table && srvTabs.find(x => x.table_id === table.id)
        const id = existing ? existing.id : await tabsApi.open(supabase, {
          barId: bar.id, nome: name, tableId: table?.id || null, pessoas: +tabForm.pessoas || 1,
          responsavel: perfil?.nome || null, servicePct: settings.service_pct, key: newKey('open'),
        })
        setOrders(prev => ({
          ...prev,
          [COUNTER]: active === COUNTER ? { cart: [] } : prev[COUNTER],
          [SRV + id]: { cart: [...(prev[SRV + id]?.cart || []), ...moving] },
        }))
        await refreshTabs()
        switchTo(SRV + id)
      } catch (err2) {
        setErr(t('tabs.errGeneric', { error: err2.message }))
      } finally {
        setBusy(false)
      }
    } else {
      const spaceId = space?.id || null
      const existing = localTabIds.find(id => (spaceId && orders[id].spaceId === spaceId) || orders[id].label === name)
      if (existing) switchTo(existing)
      else {
        const id = `tab-${Date.now().toString(36)}`
        setOrders(prev => ({
          ...prev,
          [COUNTER]: active === COUNTER ? { cart: [] } : prev[COUNTER],
          [id]: { label: name, spaceId, cart: moving, openedAt: new Date().toISOString() },
        }))
        switchTo(id)
      }
    }
    setTabSheet(false)
    setTabForm({ nome: '', pessoas: 2, tableId: '' })
  }

  function dropActive() {
    if (active === COUNTER) { setCart([]); return }
    setOrders(prev => {
      const next = { ...prev }
      delete next[active]
      return next
    })
    switchTo(COUNTER)
  }

  /** "Send" for a server tab: pending lines go onto the tab (idempotent per batch). */
  async function sendPending() {
    if (!srvTab || !cart.length) return true
    const sendKey = order.sendKey || newKey('add')
    setOrders(prev => ({ ...prev, [active]: { ...prev[active], sendKey } }))
    try {
      await tabsApi.addItems(supabase, srvTab.id, pendingToLines(cart), sendKey)
      setOrders(prev => ({ ...prev, [active]: { ...prev[active], cart: [], sendKey: undefined } }))
      await refreshTabs()
      return true
    } catch (e) {
      setErr(isConflict(e) ? t('tabs.errConflict') : t('tabs.errGeneric', { error: e.message }))
      return false
    }
  }

  function rememberTop(lines) {
    const log = readJson(localTopKey, [])
    const next = [...log, ...lines.map(line => ({ drink_menu_id: line.drink_menu_id, produto_id: line.produto_id, qtd: line.qtd }))].slice(-600)
    writeJson(localTopKey, next)
  }

  async function charge() {
    if (busy || short || setupNeeded || !hasSomething) return
    setBusy(true)
    setErr('')
    // One key per checkout attempt, kept until it succeeds: a retry after a timeout cannot sell twice.
    const saleKey = order.saleKey || newSaleKey()
    setOrders(prev => ({ ...prev, [active]: { ...(prev[active] || { cart: [] }), saleKey } }))
    const pricingByProduto = pricingMapFromShots(shots)
    try {
      let checkoutCart
      let comandaId = null
      let payNote
      if (srvTab) {
        if (!(await sendPending())) return
        const fresh = (await loadOpenTabs(supabase, bar.id)).find(x => x.id === srvTab.id)
        if (!fresh) throw new Error(t('tabs.errGone'))
        const m = tabMoney(fresh, fresh.items, fresh.payments, settings)
        if (m.due > 0) {
          const payKey = order.payKey || newKey('pay')
          setOrders(prev => ({ ...prev, [active]: { ...(prev[active] || { cart: [] }), saleKey, payKey } }))
          await tabsApi.pay(supabase, fresh.id, { valor: m.due, metodo: pay, key: payKey })
        }
        checkoutCart = [...m.lines, ...m.charges]
        comandaId = fresh.id
        const methods = [...new Set([...fresh.payments.map(p => p.metodo), ...(m.due > 0 ? [pay] : [])])]
        payNote = `Pay: ${methods.join(' + ') || pay} tab`
      } else {
        checkoutCart = [...cart, ...charges.lines]
        payNote = payRecordNote({ method: pay, total, tendered: cashPay ? tendered : undefined })
      }
      const drinkLines = checkoutCart.filter(l => !['set', 'nominho', 'service', 'room_min'].includes(l.tipo_preco))
      const commission = agent ? drinkBackCommission(drinkLines, agent.comissao_pct) : null
      const obs = packTicketObs({
        details: tableOrder ? (srvTab?.nome || order.label) : '',
        castName: agent?.nome || '',
        castId: agentId,
        nightKey: tokyoNightKey(),
        servicePct: srvTab ? +srvTab.service_pct || 0 : (tableOrder && serviceOn ? settings.service_pct : 0),
        roomMin: space?.tipo === 'vip_room' ? settings.room_min : 0,
        commission,
        payNote,
      })
      const legacy = {
        bar, payMethod: pay, agentId: agentId || null, spaceId: order.spaceId || null, obs, userId: user?.id, shots,
        syncStock: args => syncPosStockAndReorder(supabase, { ...args, pricingByProduto, buildStockMap, findLowStockProducts }),
      }
      const result = await commitSaleAtomic(supabase, {
        key: saleKey, barId: bar.id, cart: checkoutCart, payMethod: srvTab ? 'Tab' : pay, obs,
        agentId: agentId || null, spaceId: order.spaceId || null,
        commission,
        comandaId, pricingByProduto, legacy,
      })
      if (!result.ok) {
        if (missingTable({ message: result.error })) setSetupNeeded(true)
        setErr(result.conflict ? t('tabs.errConflict') : (result.errorKey && !result.error ? t(result.errorKey) : (result.error || t('atomicPos.saleStockFailed'))))
        if (srvTab) refreshTabs()
        return
      }
      // Restock check after the sale is safe on the server; it never undoes the sale.
      if (result.atomic) reorderLowStock(supabase, { bar, userId: user?.id, buildStockMap, findLowStockProducts }).catch(() => {})
      rememberTop(drinkLines)
      setDone({ total, change: !srvTab && cash && !cash.exact ? Math.max(0, cash.change) : 0, method: pay, label: tableOrder ? (srvTab?.nome || order.label) : '' })
      dropActive()
      setAgentId('')
      setTendered('')
      setOrderOpen(false)
      setPanelTab(null)
      clearTimeout(doneTimer.current)
      doneTimer.current = setTimeout(() => setDone(null), 4000)
      if (srvTab) refreshTabs()
      onSale?.()
    } catch (e) {
      setErr(isConflict(e) ? t('tabs.errConflict') : t('tabs.errGeneric', { error: e.message }))
      if (srvTab) refreshTabs()
    } finally {
      setBusy(false)
    }
  }

  // Keyboard: "/" search, Enter adds the first match, Esc clears, Ctrl/⌘+Enter or F12 charges.
  const chargeRef = useRef(charge)
  chargeRef.current = charge
  useEffect(() => {
    const onKey = e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) { e.preventDefault(); chargeRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const chargeLabel = busy
    ? t('posQuick.saving')
    : setupNeeded
      ? t('posQuick.cannotSave')
      : short
        ? t('posQuick.short', { amount: fmtYen(cash.due - cash.tendered) })
        : hasSomething ? t('posQuick.charge', { amount: fmtYen(due) }) : t('posQuick.charge', { amount: '' }).trim()

  const sentLines = srvMoney?.lines || []

  return (
    <div className={`pq${orderOpen ? ' is-order-open' : ''}`}>
      <section className="pq-menu">
        <div className="pq-top">
          <label className="pq-search">
            <Icon name="search" size={18} />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && visible[0]) { e.preventDefault(); add(visible[0]); setQuery('') }
                if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() }
              }}
              placeholder={t('posQuick.searchCode')}
              enterKeyHint="search"
              aria-keyshortcuts="/"
            />
            {query && <button type="button" aria-label={t('posQuick.clear')} onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}
          </label>
          {todaySales && (
            <div className="pq-night">
              <span>{t('posQuick.tonight')}</span>
              <strong>{fmtYen(todaySales.total)}</strong>
              <em>{t('atomicPos.salesCount', { count: todaySales.count })}</em>
            </div>
          )}
        </div>

        {setupNeeded && <div className="pq-alert">{t('posQuick.setupNeeded')}</div>}
        {catalogError && !setupNeeded && <div className="pq-alert">{catalogError}</div>}

        {!q && (
          <div className="pq-cats" role="tablist">
            <button type="button" role="tab" aria-selected={cat === 'top'} className={`pq-cat is-top${cat === 'top' ? ' is-on' : ''}`} onClick={() => setCat('top')}>
              <Icon name="result" size={14} />{t('posQuick.top')}
            </button>
            <button type="button" role="tab" aria-selected={cat === 'fav'} className={`pq-cat${cat === 'fav' ? ' is-on' : ''}`} onClick={() => setCat('fav')}>
              <Icon name="star" size={14} />{t('posQuick.favorites')}
            </button>
            <button type="button" role="tab" aria-selected={cat === 'all'} className={`pq-cat${cat === 'all' ? ' is-on' : ''}`} onClick={() => setCat('all')}>{t('posQuick.all')}</button>
            {cats.map(id => (
              <button key={id} type="button" role="tab" aria-selected={cat === id} className={`pq-cat${cat === id ? ' is-on' : ''}`} onClick={() => setCat(id)}>
                <Icon name={itemVisual({ categoria: id }).icon} size={14} />{id}
              </button>
            ))}
          </div>
        )}
        {!q && cat === 'top' && topList.starter && <p className="pq-hint">{t('posQuick.starter')}</p>}
        {!q && cat === 'fav' && !favList.length && <p className="pq-hint">{t('posQuick.favHint')}</p>}

        <div className="pq-grid">
          {visible.map(item => (
            <Tile key={item.key} item={item} qty={qtyByKey[item.key] || 0} fav={favs.includes(item.key)} onAdd={add} onFav={k => setFavs(f => toggleFavorite(f, k))} t={t} />
          ))}
          {visible.length === 0 && (cat !== 'fav' || q) && <p className="pq-empty">{q ? t('posQuick.noMatch') : t('posFloor.noProducts')}</p>}
        </div>
        <p className="pq-keys"><Icon name="keyboard" size={14} /> {t('posQuick.keys')}</p>
      </section>

      <aside className="pq-order" aria-label={t('posQuick.order')}>
        <div className="pq-tabs">
          <button type="button" className={`pq-tab${active === COUNTER ? ' is-on' : ''}`} onClick={() => switchTo(COUNTER)}>
            {t('posQuick.counter')}
            {orders[COUNTER].cart?.length > 0 && active !== COUNTER && <em>{fmtYen(cartTotal(orders[COUNTER].cart))}</em>}
          </button>
          {server && srvTabs.map(x => {
            const m = tabMoney(x, x.items, x.payments, settings)
            const pend = cartTotal(orders[SRV + x.id]?.cart || [])
            return (
              <button key={x.id} type="button" className={`pq-tab${active === SRV + x.id ? ' is-on' : ''}${x.status !== 'open' ? ' is-paying' : ''}`} onClick={() => switchTo(SRV + x.id)}>
                {x.nome}
                <em>{fmtYen(m.drinksTotal + pend)}</em>
              </button>
            )
          })}
          {localTabIds.map(id => (
            <button key={id} type="button" className={`pq-tab${active === id ? ' is-on' : ''}`} onClick={() => switchTo(id)}>
              {orders[id].label}
              <em>{fmtYen(cartTotal(orders[id].cart))}</em>
            </button>
          ))}
          <button type="button" className="pq-tab is-add" onClick={() => setTabSheet(true)}><Icon name="plus" size={14} /> {t('posQuick.newTab')}</button>
          <button type="button" className="pq-close-sheet" onClick={() => setOrderOpen(false)} aria-label={t('posQuick.backToMenu')}><Icon name="close" size={18} /></button>
        </div>

        {srvTab && (
          <div className="pq-tabbar">
            <span className="ui-badge is-accent"><Icon name="comandas" size={12} /> {srvTab.mesa_nome || t('tabs.noTable')}</span>
            {srvMoney.paid > 0 && <span className="ui-badge is-info">{t('tabs.paidShort', { amount: fmtYen(srvMoney.paid) })}</span>}
            {lockedTab && <span className="ui-badge is-warning">{t('tabs.state.awaiting_payment')}</span>}
            <span className="ui-spacer" />
            <button type="button" className="ui-btn is-sm" onClick={() => setPanelTab(srvTab.id)}><Icon name="settings" size={14} /> {t('tabs.manage')}</button>
          </div>
        )}

        <div className="pq-lines">
          {!hasSomething && <p className="pq-empty">{t('posQuick.empty')}</p>}
          {sentLines.map(line => {
            const look = itemVisual(line)
            return (
              <div key={line.item_id} className="pq-line is-sent">
                <span className="pq-line-dot" style={{ background: look.background }}><Icon name={look.icon} size={14} /></span>
                <div className="pq-line-name"><strong>{line.nome}</strong><span>{fmtYen(line.preco_unitario)} · {t('tabs.onTab')}</span></div>
                <span className="pq-qty-static">×{line.qtd}</span>
                <strong className="pq-line-total">{fmtYen(line.preco_unitario * line.qtd)}</strong>
              </div>
            )
          })}
          {cart.map(line => {
            const look = itemVisual(byKey.get(line.key) || line)
            return (
              <div key={line.key} className={`pq-line${srvTab ? ' is-pending' : ''}`}>
                <span className="pq-line-dot" style={look.image ? undefined : { background: look.background }}>
                  {look.image ? <img src={look.image} alt="" /> : <Icon name={look.icon} size={14} />}
                </span>
                <div className="pq-line-name">
                  <strong>{line.nome}</strong>
                  <span>{fmtYen(line.preco_unitario)}{srvTab ? ` · ${t('tabs.notSent')}` : ''}</span>
                </div>
                <div className="pq-qty">
                  <button type="button" aria-label={t('tabs.less', { name: line.nome })} onClick={() => bump(line.key, -1)}><Icon name="minus" size={16} /></button>
                  <span>{line.qtd}</span>
                  <button type="button" aria-label={t('tabs.more', { name: line.nome })} onClick={() => bump(line.key, 1)}><Icon name="plus" size={16} /></button>
                </div>
                <strong className="pq-line-total">{fmtYen(line.preco_unitario * line.qtd)}</strong>
              </div>
            )
          })}
        </div>

        <div className="pq-pay">
          {charges.lines.length > 0 && (
            <div className="pq-extra">
              {charges.lines.map(line => (
                <div key={line.key}><span>{line.kind === 'service' ? t('posQuick.service', { pct: srvTab ? srvTab.service_pct : settings.service_pct }) : line.nome}</span><span>{fmtYen(line.preco)}</span></div>
              ))}
              {srvMoney?.paid > 0 && <div><span>{t('tabs.paid')}</span><span>−{fmtYen(srvMoney.paid)}</span></div>}
            </div>
          )}
          <div className="pq-total">
            <span>{srvMoney?.paid > 0 ? t('tabs.due') : t('posQuick.total')}{itemCount ? ` · ${t('posQuick.items', { n: itemCount })}` : ''}</span>
            <strong>{fmtYen(due)}</strong>
          </div>

          {srvTab && cart.length > 0 && (
            <button type="button" className="ui-btn is-lg pq-send" disabled={busy || lockedTab} onClick={async () => { setBusy(true); await sendPending(); setBusy(false) }}>
              <Icon name="send" size={18} /> {t('tabs.send', { n: cart.reduce((a, l) => a + l.qtd, 0) })}
            </button>
          )}

          <div className="pq-pays">
            {PAY.map(row => (
              <button key={row.id} type="button" className={pay === row.id ? 'is-on' : ''} aria-pressed={pay === row.id} onClick={() => { setPay(row.id); setTendered('') }}>
                <Icon name={row.icon} size={16} />{t(row.key)}
              </button>
            ))}
          </div>

          {cashPay && hasSomething && (
            <div className="pq-cash">
              <button type="button" className={tendered === '' ? 'is-on' : ''} onClick={() => setTendered('')}>{t('posQuick.exact')}</button>
              {CASH_CHIPS.filter(v => v >= due).slice(0, 3).map(v => (
                <button key={v} type="button" className={+tendered === v ? 'is-on' : ''} onClick={() => setTendered(String(v))}>{fmtYen(v)}</button>
              ))}
              {cash && !cash.exact && !cash.short && (
                <div className="pq-change">{t('posQuick.change')} <strong>{fmtYen(cash.change)}</strong></div>
              )}
            </div>
          )}

          <div className="pq-options">
            {agents.length > 0 && (
              <select value={agentId} onChange={e => setAgentId(e.target.value)} aria-label={t('posQuick.cast')}>
                <option value="">{t('posQuick.noCast')}</option>
                {agents.filter(row => row.ativo !== false).map(row => <option key={row.id} value={row.id}>{row.nome}</option>)}
              </select>
            )}
            {tableOrder && !srvTab && (
              <button type="button" className={serviceOn ? 'is-on' : ''} onClick={() => setServiceOn(v => !v)}>
                {t('posQuick.service', { pct: settings.service_pct })}
              </button>
            )}
            {(cart.length > 0 || (tableOrder && !srvTab)) && (
              <button type="button" className="is-quiet" onClick={() => (srvTab ? setCart([]) : dropActive())}>
                {tableOrder && !srvTab ? t('posQuick.closeTab') : t('posQuick.clear')}
              </button>
            )}
          </div>

          {err && <div className="pq-alert" role="alert">{err}</div>}
          <button type="button" className="pq-charge" disabled={busy || !hasSomething || short || setupNeeded} onClick={charge} aria-keyshortcuts="Control+Enter F12">
            {chargeLabel}
          </button>
        </div>
      </aside>

      <button type="button" className="pq-cartbar" onClick={() => setOrderOpen(true)}>
        <span><Icon name="comandas" size={16} /> {active === COUNTER ? t('posQuick.counter') : (srvTab?.nome || order.label)}{itemCount ? ` · ${t('posQuick.items', { n: itemCount })}` : ''}</span>
        <strong>{hasSomething ? fmtYen(due) : t('posQuick.viewOrder')}</strong>
      </button>

      {tabSheet && (
        <div className="pq-sheet" role="dialog" aria-modal="true" aria-label={t('posQuick.newTab')} onClick={e => { if (e.target === e.currentTarget) setTabSheet(false) }}>
          <form className="pq-sheet-card" onSubmit={openTab}>
            <h2>{t('posQuick.newTab')}</h2>
            <div className="pq-sheet-name">
              <input autoFocus value={tabForm.nome} onChange={e => setTabForm(f => ({ ...f, nome: e.target.value }))} placeholder={t('posQuick.tabName')} aria-label={t('posQuick.tabName')} />
              {server && (
                <input type="number" min="1" max="99" className="pq-people" value={tabForm.pessoas} aria-label={t('tabs.peopleLabel')}
                  onChange={e => setTabForm(f => ({ ...f, pessoas: e.target.value }))} />
              )}
              <button type="submit" disabled={busy || !(tabForm.nome.trim() || tabForm.tableId)}>{t('posQuick.openTab')}</button>
            </div>
            {(server ? tables : spaces).length > 0 && (
              <div className="pq-sheet-spaces" role="radiogroup" aria-label={t('tabs.table')}>
                {(server ? tables : spaces).map(row => {
                  const taken = server && srvTabs.find(x => x.table_id === row.id)
                  return (
                    <button key={row.id} type="button" role="radio" aria-checked={tabForm.tableId === row.id}
                      className={`${tabForm.tableId === row.id ? 'is-on' : ''}${taken ? ' is-taken' : ''}`}
                      onClick={() => {
                        if (taken) { switchTo(SRV + taken.id); setTabSheet(false); return }
                        setTabForm(f => ({ ...f, tableId: f.tableId === row.id ? '' : row.id }))
                      }}>
                      {row.nome}{taken ? ` · ${taken.nome}` : ''}
                    </button>
                  )
                })}
              </div>
            )}
            {!server && server !== null && <p className="pq-hint">{t('tabs.deviceOnly')}</p>}
            {active === COUNTER && cart.length > 0 && <p className="pq-hint">{t('posQuick.moveHint')}</p>}
            <button type="button" className="pq-sheet-cancel" onClick={() => setTabSheet(false)}>{t('common.cancel')}</button>
          </form>
        </div>
      )}

      {panelTab && srvTabs.find(x => x.id === panelTab) && (
        <TabPanel
          tab={srvTabs.find(x => x.id === panelTab)}
          tabs={srvTabs}
          tables={tables}
          settings={settings}
          onChanged={refreshTabs}
          onClose={() => setPanelTab(null)}
        />
      )}

      {done && (
        <div className="pq-done" role="status" onClick={() => setDone(null)}>
          <div className="pq-done-card">
            <div className="pq-done-check" aria-hidden="true"><Icon name="ok" size={40} /></div>
            <div className="pq-done-total">{fmtYen(done.total)}</div>
            {done.change > 0 && <div className="pq-done-change">{t('posQuick.change')} {fmtYen(done.change)}</div>}
            {done.label && <div className="pq-done-label">{done.label}</div>}
            <button type="button" onClick={() => setDone(null)}>{t('posQuick.newSale')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
