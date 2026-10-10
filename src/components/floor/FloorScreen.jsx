import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../lib/i18n'
import { useAuth } from '../Auth'
import { useAiPageContext } from '../../lib/aiPanel'
import { DEFAULT_POS_SETTINGS, settingsFromRow } from '../../lib/nightTicket'
import { TABLE_STATES, floorApi, floorAvailable, floorPlanAvailable, loadOpenTabs, loadTabHistory, newKey, tableState, tabMoney, tabsApi } from '../../lib/comandas'
import { fitZoom, isDecor } from '../../lib/floorEditor'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import Floor3D from './Floor3D'
import FloorEditor from './FloorEditor'
import TabPanel from './TabPanel'

const POLL_MS = 10000
const STATE_ICON = {
  free: 'stFree', awaiting_order: 'stAwaitingOrder', consuming: 'stConsuming', occupied: 'stOccupied',
  awaiting_payment: 'stAwaitingPayment', reserved: 'stReserved', cleaning: 'stCleaning',
}

function minutesSince(iso, now) {
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 60000)) : 0
}

/**
 * Floor & tables for a bar: live service view (state per table with colour, text and icon; tap to open or manage a tab)
 * and, for managers, the visual editor. Needs sql/floor_comandas.sql; without it the page says so and stores nothing.
 */
export default function FloorScreen({ bar, onOpenTill }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const canEdit = ['admin', 'jbm', 'cliente', 'gerente'].includes(perfil?.role)
  const [avail, setAvail] = useState(null)
  const [planOnly, setPlanOnly] = useState(false)
  const [mode, setMode] = useState('service')
  const [view, setView] = useState('plan')
  const [layouts, setLayouts] = useState([])
  const [layoutId, setLayoutId] = useState(null)
  const [tables, setTables] = useState([])
  const [tabs, setTabs] = useState([])
  const [settings, setSettings] = useState(DEFAULT_POS_SETTINGS)
  const [history, setHistory] = useState(null)
  const [panel, setPanel] = useState(null)
  const [opening, setOpening] = useState(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [zoom, setZoom] = useState(1)
  const viewRef = useRef(null)

  const loadLayouts = useCallback(async (preferId) => {
    const list = await floorApi.layouts(supabase, bar.id)
    setLayouts(list)
    setLayoutId(cur => preferId || (list.some(l => l.id === cur) ? cur : (list.find(l => l.ativo) || list[0])?.id || null))
    return list
  }, [bar.id])

  const refresh = useCallback(async () => {
    if (planOnly) { setNow(Date.now()); return }
    try {
      setTabs(await loadOpenTabs(supabase, bar.id))
      setNow(Date.now())
    } catch (e) { setErr(t('tabs.errGeneric', { error: e.message })) }
  }, [bar.id, t, planOnly])

  useEffect(() => {
    let alive = true
    floorAvailable(supabase, bar.id).then(async ok => {
      if (!alive) return
      if (!ok) {
        // No shared tabs yet: the plan itself still works from the bar live-store.
        const plan = await floorPlanAvailable(supabase, bar.id).catch(() => false)
        if (!alive) return
        setPlanOnly(plan)
        setAvail(plan)
        if (plan) await loadLayouts().catch(e => setErr(e.message))
        return
      }
      setAvail(ok)
      await loadLayouts()
      await refresh()
      supabase.from('pos_settings').select('*').eq('bar_id', bar.id).maybeSingle()
        .then(({ data, error }) => { if (alive && !error && data) setSettings(settingsFromRow(data)) })
    }).catch(e => { if (alive) { setAvail(false); setErr(e.message) } })
    return () => { alive = false }
  }, [bar.id, loadLayouts, refresh])

  const layout = layouts.find(l => l.id === layoutId) || null
  useEffect(() => {
    if (!layout) return
    floorApi.layout(supabase, layout.id).then(r => {
      setTables(r.tables.map(x => ({ ...x, x: +x.x, y: +x.y, largura: +x.largura, altura: +x.altura })))
      requestAnimationFrame(() => {
        const v = viewRef.current
        if (v) setZoom(fitZoom(v.clientWidth, Math.max(320, v.clientHeight), { largura: +layout.largura, altura: +layout.altura }))
      })
    }).catch(e => setErr(e.message))
  }, [layout?.id, layout?.versao]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live refresh: Supabase Realtime when the table is published, polling always as a fallback.
  useEffect(() => {
    if (!avail || planOnly) return undefined
    const tick = () => { if (document.visibilityState === 'visible') refresh() }
    const id = setInterval(tick, POLL_MS)
    let channel = null
    try {
      channel = supabase.channel(`floor-${bar.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_comandas', filter: `bar_id=eq.${bar.id}` }, tick)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_comanda_itens', filter: `bar_id=eq.${bar.id}` }, tick)
        .subscribe()
    } catch { channel = null }
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      if (channel) supabase.removeChannel(channel)
    }
  }, [avail, planOnly, bar.id, refresh])

  const decor = useMemo(() => tables.filter(x => x.ativo !== false && isDecor(x.forma)), [tables])
  const live = useMemo(() => tables.filter(x => x.ativo !== false && !isDecor(x.forma)).map(tb => {
    const open = tabs.filter(c => c.table_id === tb.id)
    const state = tableState(tb, tabs, now)
    const money = open.reduce((a, c) => {
      const m = tabMoney(c, c.items, c.payments, settings)
      return { total: a.total + m.total, due: a.due + m.due }
    }, { total: 0, due: 0 })
    const since = open.length ? Math.min(...open.map(c => Date.parse(c.aberta_em))) : null
    return { ...tb, state, open, money, minutes: since ? minutesSince(new Date(since).toISOString(), now) : 0, pessoas: open.reduce((a, c) => a + (c.pessoas || 0), 0) }
  }), [tables, tabs, now, settings])
  const counts = useMemo(() => Object.fromEntries(TABLE_STATES.map(s => [s, live.filter(x => x.state === s).length])), [live])
  const floating = tabs.filter(c => !c.table_id || !tables.some(x => x.id === c.table_id))
  const busyTableIds = useMemo(() => new Set(tabs.filter(c => c.table_id).map(c => c.table_id)), [tabs])
  const openTotal = tabs.reduce((a, c) => a + tabMoney(c, c.items, c.payments, settings).total, 0)

  useAiPageContext('mesas', {
    module: 'floor',
    title: t('nav.mesas'),
    unit: bar.nome,
    barId: bar.id,
    period: t('floor.now'),
    kpis: [
      ...TABLE_STATES.filter(s => counts[s]).map(s => ({ label: t(`tabs.state.${s}`), value: counts[s] })),
      { label: t('floor.openTabs'), value: tabs.length },
      { label: t('floor.openValue'), value: fmtYen(openTotal) },
    ],
  })

  async function openOnTable(e) {
    e.preventDefault()
    const tb = opening
    try {
      const id = await tabsApi.open(supabase, {
        barId: bar.id, nome: opening.nome || tb.nome, tableId: tb.id, pessoas: +opening.pessoas || 1,
        responsavel: perfil?.nome || null, servicePct: settings.service_pct, key: newKey('open'),
      })
      setOpening(null)
      await refresh()
      setPanel(id)
    } catch (e2) { setErr(t('tabs.errGeneric', { error: e2.message })) }
  }

  async function setManual(tb, state) {
    try {
      await floorApi.setState(supabase, tb.id, state)
      setTables(list => list.map(x => (x.id === tb.id ? { ...x, estado_manual: state } : x)))
      setOpening(null)
    } catch (e) { setErr(t('tabs.errGeneric', { error: e.message })) }
  }

  function onTable(tb) {
    if (isDecor(tb.forma)) return
    if (planOnly) { setOpening({ ...tb, planOnly: true }); return }
    if (tb.open.length === 1) { setPanel(tb.open[0].id); return }
    if (tb.open.length > 1) { setOpening({ ...tb, pick: true }); return }
    setOpening({ ...tb, nome: '', pessoas: Math.min(tb.capacidade || 2, 2) })
  }

  if (avail === null) return <div className="ui-skel" style={{ height: 240 }} />
  if (!avail) {
    return (
      <div className="fade-in growth-page">
        <div className="ui-pagebar"><div className="ui-pagebar-title">{t('nav.mesas')}</div></div>
        <div className="ui-empty growth-missing">
          <Icon name="lock" size={22} />
          <div className="ui-empty-title">{t('growth.missingTitle')}</div>
          <div>{t('floor.missing')}</div>
          {err && <div className="ui-muted">{err}</div>}
        </div>
      </div>
    )
  }

  const panelTab = tabs.find(c => c.id === panel)

  return (
    <div className="fade-in floor-page">
      <div className="ui-pagebar">
        <div>
          <div className="ui-pagebar-title">{t('nav.mesas')}</div>
          <div className="ui-card-sub">{t('floor.sub', { tabs: tabs.length, amount: fmtYen(openTotal) })}</div>
        </div>
        {canEdit && (
          <div className="ui-seg" role="radiogroup" aria-label={t('floor.mode')}>
            <button type="button" role="radio" aria-checked={mode === 'service'} onClick={() => setMode('service')}><Icon name="eye" size={14} />{t('floor.service')}</button>
            <button type="button" role="radio" aria-checked={mode === 'edit'} onClick={() => setMode('edit')}><Icon name="edit" size={14} />{t('floor.edit')}</button>
          </div>
        )}
      </div>
      {planOnly && <div className="ui-card desk-note floor-planonly"><Icon name="info" size={15} /> {t('floor.planOnly')}</div>}
      {err && <div className="ui-error fe-msg" role="alert"><Icon name="warning" />{err}<button type="button" className="ui-btn is-sm" onClick={() => setErr('')}>{t('common.close')}</button></div>}

      {layouts.length === 0 && (
        <div className="ui-empty">
          <Icon name="floor" size={22} />
          <div className="ui-empty-title">{t('floor.noLayout')}</div>
          {canEdit && (
            <button type="button" className="ui-btn is-primary" onClick={async () => {
              try {
                const id = await floorApi.create(supabase, { barId: bar.id, nome: t('floor.newLayoutDefault'), ativo: true })
                await loadLayouts(id)
                setMode('edit')
              } catch (e) { setErr(e.message) }
            }}><Icon name="plus" size={16} /> {t('floor.createFirst')}</button>
          )}
        </div>
      )}

      {layout && mode === 'edit' && canEdit && (
        <FloorEditor
          layout={layout}
          layouts={layouts}
          busyTableIds={busyTableIds}
          onSwitchLayout={id => setLayoutId(id)}
          onLayoutsChanged={async id => { await loadLayouts(id) }}
          onSaved={() => loadLayouts(layout.id)}
        />
      )}

      {layout && mode === 'service' && (
        <>
          <div className="floor-legend" aria-label={t('floor.legend')}>
            {TABLE_STATES.map(s => (
              <span key={s} className={`floor-chip st-${s}`}><Icon name={STATE_ICON[s]} size={13} /> {t(`tabs.state.${s}`)} <strong>{counts[s]}</strong></span>
            ))}
            <span className="ui-spacer" />
            {layouts.length > 1 && (
              <select value={layout.id} onChange={e => setLayoutId(e.target.value)} aria-label={t('floor.layout')}>
                {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}{l.ativo ? ` · ${t('floor.active')}` : ''}</option>)}
              </select>
            )}
            <div className="ui-seg" role="radiogroup" aria-label={t('floor.view')}>
              <button type="button" role="radio" aria-checked={view === 'plan'} onClick={() => setView('plan')}><Icon name="map" size={14} />{t('floor.plan')}</button>
              <button type="button" role="radio" aria-checked={view === '3d'} onClick={() => setView('3d')}><Icon name="cube" size={14} />3D</button>
              <button type="button" role="radio" aria-checked={view === 'list'} onClick={() => setView('list')}><Icon name="comandas" size={14} />{t('floor.list')}</button>
            </div>
          </div>

          {view === 'plan' ? (
            <div className="floor-viewport" ref={viewRef}>
              <div className="fe-canvas" style={{ width: +layout.largura * zoom, height: +layout.altura * zoom }}>
                <div className="fe-plane floor-live" style={{ width: +layout.largura, height: +layout.altura, transform: `scale(${zoom})` }}>
                  {decor.map(tb => (
                    <div key={tb.id} className={`fe-table is-${tb.forma} is-decor`} aria-hidden="true"
                      style={{ left: +tb.x, top: +tb.y, width: +tb.largura, height: +tb.altura, transform: tb.rotacao ? `rotate(${tb.rotacao}deg)` : undefined, '--fe-color': tb.cor || undefined }}>
                      <span className="fe-table-name">{tb.nome}</span>
                    </div>
                  ))}
                  {live.map(tb => (
                    <button
                      key={tb.id}
                      type="button"
                      className={`fe-table is-${tb.forma} st-${tb.state}`}
                      style={{ left: tb.x, top: tb.y, width: tb.largura, height: tb.altura, transform: tb.rotacao ? `rotate(${tb.rotacao}deg)` : undefined }}
                      onClick={() => onTable(tb)}
                      aria-label={`${tb.nome}: ${t(`tabs.state.${tb.state}`)}${tb.open.length ? `, ${fmtYen(tb.money.total)}` : ''}`}
                    >
                      <span className="fe-table-name">{tb.nome}</span>
                      <span className="floor-state"><Icon name={STATE_ICON[tb.state]} size={12} /> {t(`tabs.state.${tb.state}`)}</span>
                      {tb.open.length > 0 && <span className="floor-money num">{fmtYen(tb.money.total)} · {tb.minutes}′</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : view === '3d' ? (
            <Floor3D layout={layout} tables={[...decor, ...live]} onTable={onTable} live />
          ) : (
            <ul className="floor-list">
              {live.map(tb => (
                <li key={tb.id}>
                  <button type="button" className={`floor-row st-${tb.state}`} onClick={() => onTable(tb)}>
                    <span className="floor-row-name">{tb.nome}<span className="ui-muted">{t('tabs.people', { n: tb.pessoas || tb.capacidade })}</span></span>
                    <span className="floor-state"><Icon name={STATE_ICON[tb.state]} size={14} /> {t(`tabs.state.${tb.state}`)}</span>
                    <span className="num">{tb.open.length ? `${fmtYen(tb.money.total)} · ${tb.minutes}′` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {floating.length > 0 && (
            <section className="ui-card">
              <div className="ui-card-title">{t('floor.noTableTabs')}</div>
              <div className="ui-row floor-floating">
                {floating.map(c => (
                  <button key={c.id} type="button" className="ui-btn" onClick={() => setPanel(c.id)}>
                    <Icon name="comandas" size={14} /> {c.nome} · {fmtYen(tabMoney(c, c.items, c.payments, settings).total)}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="ui-card">
            <div className="ui-card-head">
              <div className="ui-card-title">{t('floor.history')}</div>
              <button type="button" className="ui-btn is-sm" onClick={() => loadTabHistory(supabase, bar.id).then(setHistory).catch(e => setErr(e.message))}>
                <Icon name="history" size={14} /> {history ? t('floor.reloadHistory') : t('floor.showHistory')}
              </button>
            </div>
            {history && (history.length === 0 ? <p className="ui-muted">{t('floor.noHistory')}</p> : (
              <table className="ui-table is-stack">
                <thead><tr><th>{t('tabs.name')}</th><th>{t('tabs.table')}</th><th>{t('common.status')}</th><th>{t('floor.openedAt')}</th><th>{t('floor.closedAt')}</th></tr></thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id}>
                      <td data-label={t('tabs.name')}>{h.nome}</td>
                      <td data-label={t('tabs.table')}>{h.mesa_nome || '—'}</td>
                      <td data-label={t('common.status')}><span className="ui-badge">{t(`floor.status.${h.status}`)}</span></td>
                      <td data-label={t('floor.openedAt')}>{new Date(h.aberta_em).toLocaleString()}</td>
                      <td data-label={t('floor.closedAt')}>{h.fechada_em ? new Date(h.fechada_em).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </section>
        </>
      )}

      {opening && (
        <>
          <div className="ui-drawer-scrim" onClick={() => setOpening(null)} />
          <aside className="ui-drawer" role="dialog" aria-modal="true" aria-label={opening.nome}>
            <div className="ui-drawer-head">
              <span className="ui-kpi-icon"><Icon name={STATE_ICON[opening.state] || 'floor'} size={18} /></span>
              <div className="ui-drawer-title">{opening.nome}<div className="ui-card-sub">{t(`tabs.state.${opening.state}`)} · {t('tabs.people', { n: opening.capacidade })}</div></div>
              <button type="button" className="ui-btn is-ghost is-icon" onClick={() => setOpening(null)} aria-label={t('common.close')}><Icon name="close" /></button>
            </div>
            <div className="ui-drawer-body growth-form">
              {opening.planOnly ? (
                <p className="ui-muted">{t('floor.planOnlyTable', { n: opening.capacidade || 0 })}</p>
              ) : opening.pick ? (
                <>
                  <p className="ui-muted">{t('floor.pickTab')}</p>
                  {opening.open.map(c => (
                    <button key={c.id} type="button" className="ui-btn" onClick={() => { setOpening(null); setPanel(c.id) }}>{c.nome}</button>
                  ))}
                </>
              ) : (
                <form className="growth-form" onSubmit={openOnTable}>
                  <label className="ui-field"><span>{t('tabs.name')}</span>
                    <input value={opening.nome} onChange={e => setOpening(o => ({ ...o, nome: e.target.value }))} placeholder={tables.find(x => x.id === opening.id)?.nome} autoFocus />
                  </label>
                  <label className="ui-field"><span>{t('tabs.peopleLabel')}</span>
                    <input type="number" min="1" max="99" value={opening.pessoas} onChange={e => setOpening(o => ({ ...o, pessoas: e.target.value }))} />
                  </label>
                  <button type="submit" className="ui-btn is-primary is-lg"><Icon name="plus" size={16} /> {t('floor.openTab')}</button>
                </form>
              )}
              {!opening.pick && !opening.planOnly && (
                <div className="ui-row floor-manual">
                  <button type="button" className="ui-btn" aria-pressed={opening.estado_manual === 'reserved'} onClick={() => setManual(opening, opening.estado_manual === 'reserved' ? null : 'reserved')}>
                    <Icon name="stReserved" size={14} /> {opening.estado_manual === 'reserved' ? t('floor.unreserve') : t('floor.reserve')}
                  </button>
                  <button type="button" className="ui-btn" aria-pressed={opening.estado_manual === 'cleaning'} onClick={() => setManual(opening, opening.estado_manual === 'cleaning' ? null : 'cleaning')}>
                    <Icon name="stCleaning" size={14} /> {opening.estado_manual === 'cleaning' ? t('floor.cleaned') : t('floor.cleaning')}
                  </button>
                </div>
              )}
            </div>
          </aside>
        </>
      )}

      {panelTab && (
        <TabPanel
          tab={panelTab} tabs={tabs} tables={tables} settings={settings} onChanged={refresh} onClose={() => setPanel(null)}
          onCharge={onOpenTill ? c => {
            // The sale is committed by the till (one atomic call); open it on this tab.
            try { localStorage.setItem(`pos-orders:${bar.id}:active`, JSON.stringify(`srv:${c.id}`)) } catch { /* private mode */ }
            onOpenTill()
          } : undefined}
        />
      )}
    </div>
  )
}
