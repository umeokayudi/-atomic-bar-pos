import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../Auth'
import { useI18n } from '../../lib/i18n'
import { fmtYen } from '../utils'
import { buildStockMap, cartTotal, commitPosSale, findLowStockProducts, pricingMapFromShots, resolveItemPrice } from '../../lib/atomicPos'
import { syncPosStockAndReorder } from '../../lib/posSupply'
import { CASH_CHIPS, cashSettle, isCashMethod, payRecordNote } from '../../lib/posPay'
import { drinkBackCommission } from '../../lib/drinkBackPay'
import { DEFAULT_POS_SETTINGS, packTicketObs, settingsFromRow, ticketChargeLines } from '../../lib/nightTicket'
import { tokyoNightKey, tokyoDateKey } from '../../lib/tokyo'
import { itemVisual, rankTopSellers, starterPicks } from '../../lib/posVisual'

const PAY = [
  { id: 'Cash', key: 'atomicPos.payCash', icon: '💴' },
  { id: 'Credit card', key: 'atomicPos.payCard', icon: '💳' },
  { id: 'PayPay', key: 'atomicPos.payPaypay', icon: '📱' },
]
const COUNTER = 'counter'

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}
function missingTable(error) {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message || ''))
}

function Tile({ item, qty, onAdd }) {
  const look = itemVisual(item)
  return (
    <button type="button" className={`pq-tile${qty ? ' has-qty' : ''}`} onClick={() => onAdd(item)}>
      <span className="pq-tile-img" style={look.image ? undefined : { background: look.background }}>
        {look.image ? <img src={look.image} alt="" loading="lazy" draggable="false" /> : <span aria-hidden="true">{look.emoji}</span>}
        {qty > 0 && <span className="pq-tile-qty">{qty}</span>}
      </span>
      <span className="pq-tile-name">{item.nome}</span>
      <span className="pq-tile-price">{fmtYen(item.preco_venda)}</span>
    </button>
  )
}

export default function PosQuick({ bar, drinks = [], shots = [], agents = [], todaySales, catalogError = '', onSale }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const ordersKey = `pos-orders:${bar.id}`
  const localTopKey = `pos-top:${bar.id}`

  const [orders, setOrders] = useState(() => {
    const saved = readJson(ordersKey, null)
    return saved && saved[COUNTER] ? saved : { [COUNTER]: { cart: [] } }
  })
  const [active, setActive] = useState(() => {
    const saved = readJson(`${ordersKey}:active`, COUNTER)
    return orders[saved] ? saved : COUNTER
  })
  const [cat, setCat] = useState('top')
  const [query, setQuery] = useState('')
  const [pay, setPay] = useState('Cash')
  const [tendered, setTendered] = useState('')
  const [agentId, setAgentId] = useState('')
  const [serviceOn, setServiceOn] = useState(true)
  const [spaces, setSpaces] = useState([])
  const [settings, setSettings] = useState(DEFAULT_POS_SETTINGS)
  const [topKeys, setTopKeys] = useState([])
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [tabSheet, setTabSheet] = useState(false)
  const [tabName, setTabName] = useState('')
  const [orderOpen, setOrderOpen] = useState(false)
  const doneTimer = useRef(null)

  useEffect(() => { writeJson(ordersKey, orders) }, [orders, ordersKey])
  useEffect(() => { writeJson(`${ordersKey}:active`, active) }, [active, ordersKey])

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
      const server = linesRes.error ? [] : rankTopSellers(linesRes.data || [], 18)
      setTopKeys(server.length ? server : rankTopSellers(readJson(localTopKey, []), 18))
      if (!settingsRes.error && settingsRes.data) setSettings(settingsFromRow(settingsRes.data))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [bar.id, localTopKey])

  useEffect(() => () => clearTimeout(doneTimer.current), [])

  const catalog = useMemo(() => ([
    ...(drinks || []).map(d => ({
      key: `d-${d.id}`, id: d.id, kind: 'drink', nome: d.nome, categoria: d.categoria || 'Other',
      preco_venda: +d.preco_venda || 0, preco_desconto: d.preco_desconto, imagem_url: d.imagem_url,
    })),
    ...(shots || []).map(s => ({
      key: `p-${s.produto_id}`, id: s.produto_id, kind: 'shot', nome: s.produtos?.nome || s.nome || 'Shot',
      categoria: s.produtos?.categoria || 'Shots', preco_venda: +s.preco_drink || 0,
      preco_desconto: Math.round((+s.preco_drink || 0) * 0.5), imagem_url: s.produtos?.imagem_url,
    })),
  ].filter(item => item.preco_venda > 0)), [drinks, shots])

  const byKey = useMemo(() => new Map(catalog.map(item => [item.key, item])), [catalog])
  const cats = useMemo(() => [...new Set(catalog.map(item => item.categoria))], [catalog])
  const topList = useMemo(() => {
    const ranked = topKeys.map(key => byKey.get(key)).filter(Boolean)
    if (ranked.length >= 4) return { items: ranked, starter: false }
    const fill = starterPicks(catalog, 12).map(key => byKey.get(key)).filter(item => item && !ranked.includes(item))
    return { items: [...ranked, ...fill].slice(0, 12), starter: ranked.length === 0 }
  }, [topKeys, byKey, catalog])

  const q = query.trim().toLowerCase()
  const visible = q
    ? catalog.filter(item => item.nome.toLowerCase().includes(q) || item.categoria.toLowerCase().includes(q))
    : cat === 'top' ? topList.items
      : cat === 'all' ? catalog
        : catalog.filter(item => item.categoria === cat)

  const order = orders[active] || orders[COUNTER]
  const cart = order.cart || []
  const space = spaces.find(row => row.id === order.spaceId)
  const qtyByKey = useMemo(() => {
    const map = {}
    for (const line of cart) map[line.key] = (map[line.key] || 0) + line.qtd
    return map
  }, [cart])
  const itemCount = cart.reduce((a, line) => a + line.qtd, 0)
  const drinksTotal = cartTotal(cart)
  const tableOrder = active !== COUNTER
  const charges = ticketChargeLines({
    drinksTotal,
    servicePct: tableOrder && serviceOn ? settings.service_pct : 0,
    roomMin: settings.room_min,
    spaceType: space?.tipo || '',
  })
  const total = charges.total
  const cashPay = isCashMethod(pay)
  const cash = cashPay ? cashSettle(total, tendered, '') : null
  const short = !!(cash && cash.short)
  const agent = agents.find(row => row.id === agentId)
  const tabIds = Object.keys(orders).filter(id => id !== COUNTER)

  function setCart(updater) {
    setOrders(prev => {
      const current = prev[active] || prev[COUNTER]
      const nextCart = typeof updater === 'function' ? updater(current.cart || []) : updater
      return { ...prev, [active in prev ? active : COUNTER]: { ...current, cart: nextCart } }
    })
  }

  function add(item) {
    setErr('')
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

  function openTab(label, spaceId = null) {
    const name = String(label || '').trim()
    if (!name) return
    const existing = tabIds.find(id => (spaceId && orders[id].spaceId === spaceId) || orders[id].label === name)
    if (existing) {
      switchTo(existing)
    } else {
      const id = `tab-${Date.now().toString(36)}`
      setOrders(prev => {
        // A new tab takes over what was rung on the counter, so "ring first, then pick the table" works.
        const moving = active === COUNTER ? (prev[COUNTER].cart || []) : []
        return {
          ...prev,
          [COUNTER]: active === COUNTER ? { cart: [] } : prev[COUNTER],
          [id]: { label: name, spaceId, cart: moving, openedAt: new Date().toISOString() },
        }
      })
      switchTo(id)
    }
    setTabSheet(false)
    setTabName('')
  }

  function dropActive() {
    if (active === COUNTER) {
      setCart([])
      return
    }
    setOrders(prev => {
      const next = { ...prev }
      delete next[active]
      return next
    })
    switchTo(COUNTER)
  }

  function rememberTop(lines) {
    const log = readJson(localTopKey, [])
    const next = [...log, ...lines.map(line => ({ drink_menu_id: line.drink_menu_id, produto_id: line.produto_id, qtd: line.qtd }))].slice(-600)
    writeJson(localTopKey, next)
  }

  async function charge() {
    if (!cart.length || busy || short || setupNeeded) return
    setBusy(true)
    setErr('')
    const checkoutCart = [...cart, ...charges.lines]
    const obs = packTicketObs({
      details: tableOrder ? order.label : '',
      castName: agent?.nome || '',
      castId: agentId,
      nightKey: tokyoNightKey(),
      servicePct: tableOrder && serviceOn ? settings.service_pct : 0,
      roomMin: space?.tipo === 'vip_room' ? settings.room_min : 0,
      commission: agent ? drinkBackCommission(cart, agent.comissao_pct) : null,
      payNote: payRecordNote({ method: pay, total, tendered: cashPay ? tendered : undefined }),
    })
    const result = await commitPosSale(supabase, {
      bar,
      cart: checkoutCart,
      payMethod: pay,
      agentId: agentId || null,
      spaceId: order.spaceId || null,
      obs,
      userId: user?.id,
      shots,
      syncStock: args => syncPosStockAndReorder(supabase, {
        ...args,
        pricingByProduto: pricingMapFromShots(shots),
        buildStockMap,
        findLowStockProducts,
      }),
    })
    setBusy(false)
    if (!result.ok) {
      if (missingTable({ message: result.error })) setSetupNeeded(true)
      setErr(result.errorKey && !result.error ? t(result.errorKey) : (result.error || t('atomicPos.saleStockFailed')))
      return
    }
    rememberTop(cart)
    setDone({ total, change: cash && !cash.exact ? Math.max(0, cash.change) : 0, method: pay, label: tableOrder ? order.label : '' })
    dropActive()
    setAgentId('')
    setTendered('')
    setOrderOpen(false)
    clearTimeout(doneTimer.current)
    doneTimer.current = setTimeout(() => setDone(null), 4000)
    onSale?.()
  }

  const chargeLabel = busy
    ? t('posQuick.saving')
    : setupNeeded
      ? t('posQuick.cannotSave')
      : short
        ? t('posQuick.short', { amount: fmtYen(cash.due - cash.tendered) })
        : cart.length ? t('posQuick.charge', { amount: fmtYen(total) }) : t('posQuick.charge', { amount: '' }).trim()

  return (
    <div className={`pq${orderOpen ? ' is-order-open' : ''}`}>
      <section className="pq-menu">
        <div className="pq-top">
          <label className="pq-search">
            <span aria-hidden="true">🔍</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('posQuick.search')} enterKeyHint="search" />
            {query && <button type="button" aria-label={t('posQuick.clear')} onClick={() => setQuery('')}>✕</button>}
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
            <button type="button" className={`pq-cat is-top${cat === 'top' ? ' is-on' : ''}`} onClick={() => setCat('top')}>
              <span aria-hidden="true">⭐</span>{t('posQuick.top')}
            </button>
            <button type="button" className={`pq-cat${cat === 'all' ? ' is-on' : ''}`} onClick={() => setCat('all')}>{t('posQuick.all')}</button>
            {cats.map(id => (
              <button key={id} type="button" className={`pq-cat${cat === id ? ' is-on' : ''}`} onClick={() => setCat(id)}>
                <span aria-hidden="true">{itemVisual({ categoria: id }).emoji}</span>{id}
              </button>
            ))}
          </div>
        )}
        {!q && cat === 'top' && topList.starter && <p className="pq-hint">{t('posQuick.starter')}</p>}

        <div className="pq-grid">
          {visible.map(item => <Tile key={item.key} item={item} qty={qtyByKey[item.key] || 0} onAdd={add} />)}
          {visible.length === 0 && <p className="pq-empty">{q ? t('posQuick.noMatch') : t('posFloor.noProducts')}</p>}
        </div>
      </section>

      <aside className="pq-order" aria-label={t('posQuick.order')}>
        <div className="pq-tabs">
          <button type="button" className={`pq-tab${active === COUNTER ? ' is-on' : ''}`} onClick={() => switchTo(COUNTER)}>
            {t('posQuick.counter')}
            {orders[COUNTER].cart?.length > 0 && active !== COUNTER && <em>{fmtYen(cartTotal(orders[COUNTER].cart))}</em>}
          </button>
          {tabIds.map(id => (
            <button key={id} type="button" className={`pq-tab${active === id ? ' is-on' : ''}`} onClick={() => switchTo(id)}>
              {orders[id].label}
              <em>{fmtYen(cartTotal(orders[id].cart))}</em>
            </button>
          ))}
          <button type="button" className="pq-tab is-add" onClick={() => setTabSheet(true)}>＋ {t('posQuick.newTab')}</button>
          <button type="button" className="pq-close-sheet" onClick={() => setOrderOpen(false)} aria-label={t('posQuick.backToMenu')}>✕</button>
        </div>

        <div className="pq-lines">
          {cart.length === 0 && <p className="pq-empty">{t('posQuick.empty')}</p>}
          {cart.map(line => {
            const look = itemVisual(byKey.get(line.key) || line)
            return (
              <div key={line.key} className="pq-line">
                <span className="pq-line-dot" style={look.image ? undefined : { background: look.background }}>
                  {look.image ? <img src={look.image} alt="" /> : look.emoji}
                </span>
                <div className="pq-line-name">
                  <strong>{line.nome}</strong>
                  <span>{fmtYen(line.preco_unitario)}</span>
                </div>
                <div className="pq-qty">
                  <button type="button" aria-label="−1" onClick={() => bump(line.key, -1)}>−</button>
                  <span>{line.qtd}</span>
                  <button type="button" aria-label="+1" onClick={() => bump(line.key, 1)}>+</button>
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
                <div key={line.key}><span>{line.kind === 'service' ? t('posQuick.service', { pct: settings.service_pct }) : line.nome}</span><span>{fmtYen(line.preco)}</span></div>
              ))}
            </div>
          )}
          <div className="pq-total">
            <span>{t('posQuick.total')}{itemCount ? ` · ${t('posQuick.items', { n: itemCount })}` : ''}</span>
            <strong>{fmtYen(total)}</strong>
          </div>

          <div className="pq-pays">
            {PAY.map(row => (
              <button key={row.id} type="button" className={pay === row.id ? 'is-on' : ''} onClick={() => { setPay(row.id); setTendered('') }}>
                <span aria-hidden="true">{row.icon}</span>{t(row.key)}
              </button>
            ))}
          </div>

          {cashPay && cart.length > 0 && (
            <div className="pq-cash">
              <button type="button" className={tendered === '' ? 'is-on' : ''} onClick={() => setTendered('')}>{t('posQuick.exact')}</button>
              {CASH_CHIPS.filter(v => v >= total).slice(0, 3).map(v => (
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
            {tableOrder && (
              <button type="button" className={serviceOn ? 'is-on' : ''} onClick={() => setServiceOn(v => !v)}>
                {t('posQuick.service', { pct: settings.service_pct })}
              </button>
            )}
            {(cart.length > 0 || tableOrder) && (
              <button type="button" className="is-quiet" onClick={dropActive}>{tableOrder ? t('posQuick.closeTab') : t('posQuick.clear')}</button>
            )}
          </div>

          {err && <div className="pq-alert">{err}</div>}
          <button type="button" className="pq-charge" disabled={busy || !cart.length || short || setupNeeded} onClick={charge}>
            {chargeLabel}
          </button>
        </div>
      </aside>

      <button type="button" className="pq-cartbar" onClick={() => setOrderOpen(true)} disabled={!cart.length && !tabIds.length}>
        <span>{active === COUNTER ? t('posQuick.counter') : order.label}{itemCount ? ` · ${t('posQuick.items', { n: itemCount })}` : ''}</span>
        <strong>{cart.length ? fmtYen(total) : t('posQuick.viewOrder')}</strong>
      </button>

      {tabSheet && (
        <div className="pq-sheet" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) setTabSheet(false) }}>
          <div className="pq-sheet-card">
            <h2>{t('posQuick.newTab')}</h2>
            <form className="pq-sheet-name" onSubmit={e => { e.preventDefault(); openTab(tabName) }}>
              <input autoFocus value={tabName} onChange={e => setTabName(e.target.value)} placeholder={t('posQuick.tabName')} />
              <button type="submit" disabled={!tabName.trim()}>{t('posQuick.openTab')}</button>
            </form>
            {spaces.length > 0 && (
              <div className="pq-sheet-spaces">
                {spaces.map(row => (
                  <button key={row.id} type="button" onClick={() => openTab(row.nome, row.id)}>{row.nome}</button>
                ))}
              </div>
            )}
            {active === COUNTER && cart.length > 0 && <p className="pq-hint">{t('posQuick.moveHint')}</p>}
            <button type="button" className="pq-sheet-cancel" onClick={() => setTabSheet(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {done && (
        <div className="pq-done" role="status" onClick={() => setDone(null)}>
          <div className="pq-done-card">
            <div className="pq-done-check" aria-hidden="true">✓</div>
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
