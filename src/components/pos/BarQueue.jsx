import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../Auth'
import { useI18n } from '../../lib/i18n'
import Icon from '../ui/Icon'
import {
  clockLabel, loadQueue, moveTicket, newIds, queueMetrics, queueTone, recipeFor, secondsBetween, sortQueue,
} from '../../lib/barQueue'

const POLL_MS = 4000
const FLASH_MS = 1300

function readPrefs(key) {
  try { return { colors: true, sound: true, ...(JSON.parse(localStorage.getItem(key) || '{}') || {}) } } catch { return { colors: true, sound: true } }
}

/** Short double beep for a new order (no audio file needed). */
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[0, 0.18].forEach(at => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 880
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.14)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + at)
      o.stop(ctx.currentTime + at + 0.16)
    })
    setTimeout(() => ctx.close().catch(() => {}), 600)
    navigator.vibrate?.([80, 60, 80])
  } catch { /* sound is a nicety */ }
}

/** The barman's screen: orders to make (they flash 3 times when they arrive), Ready -> Delivered, recipes, tonight's times. */
export default function BarQueue({ bar }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const prefsKey = `jbm:barq:${bar.id}`
  const [prefs, setPrefs] = useState(() => readPrefs(prefsKey))
  const [rows, setRows] = useState(null)
  const [missing, setMissing] = useState(false)
  const [err, setErr] = useState('')
  const [menu, setMenu] = useState([])
  const [now, setNow] = useState(() => Date.now())
  const [flash, setFlash] = useState(() => new Set())
  const [recipeOpen, setRecipeOpen] = useState(() => new Set())
  const [busyId, setBusyId] = useState('')
  const seen = useRef(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const savePrefs = next => {
    setPrefs(next)
    try { localStorage.setItem(prefsKey, JSON.stringify(next)) } catch { /* per-device only */ }
  }

  const refresh = useCallback(async () => {
    try {
      const res = await loadQueue(supabase, bar.id)
      setMissing(res.missing)
      setErr('')
      const fresh = res.rows
      if (seen.current) {
        const arrived = newIds(fresh, seen.current)
        if (arrived.length) {
          setFlash(prev => new Set([...prev, ...arrived]))
          setTimeout(() => setFlash(prev => { const n = new Set(prev); arrived.forEach(id => n.delete(id)); return n }), FLASH_MS)
          if (prefsRef.current.sound) beep()
        }
      }
      seen.current = new Set(fresh.map(r => r.id))
      setRows(fresh)
    } catch (e) {
      setErr(t('barQueue.errLoad', { error: e.message }))
      setRows(r => r || [])
    }
  }, [bar.id, t])

  useEffect(() => {
    refresh()
    const tick = () => { if (document.visibilityState === 'visible') refresh() }
    const id = setInterval(tick, POLL_MS)
    let channel = null
    try {
      channel = supabase.channel(`bar-queue-${bar.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_bar_fila', filter: `bar_id=eq.${bar.id}` }, tick)
        .subscribe()
    } catch { channel = null }
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      if (channel) supabase.removeChannel(channel)
    }
  }, [bar.id, refresh])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let live = true
    supabase.from('drink_menu').select('id,nome,receita').eq('bar_id', bar.id)
      .then(({ data }) => { if (live) setMenu(data || []) }, () => {})
    return () => { live = false }
  }, [bar.id])

  async function act(row, status) {
    setBusyId(row.id)
    setErr('')
    const prev = rows
    const stamp = new Date().toISOString()
    // Optimistic: the card changes at once; the server write follows.
    setRows(list => (list || []).map(r => (r.id === row.id ? {
      ...r, status,
      pronto_em: status === 'novo' ? null : (r.pronto_em || stamp),
      entregue_em: status === 'entregue' ? (r.entregue_em || stamp) : status === 'novo' ? null : r.entregue_em,
      feito_por_nome: status === 'novo' ? null : (r.feito_por_nome || perfil?.nome || null),
    } : r)))
    try {
      await moveTicket(supabase, row, status, { id: perfil?.id || null, nome: perfil?.nome || null })
    } catch (e) {
      setRows(prev)
      setErr(t('barQueue.errLoad', { error: e.message }))
    } finally {
      setBusyId('')
    }
  }

  const toggleRecipe = key => setRecipeOpen(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })

  const open = useMemo(() => sortQueue(rows || []), [rows])
  const waiting = open.filter(r => r.status !== 'pronto').length
  const tone = queueTone(waiting)
  const metrics = useMemo(() => queueMetrics(rows || []), [rows])
  const done = useMemo(() => (rows || []).filter(r => r.status === 'entregue').sort((a, b) => String(b.entregue_em).localeCompare(String(a.entregue_em))).slice(0, 8), [rows])
  const fmt = s => (s == null ? '—' : clockLabel(s))

  if (missing) {
    return <div className="bq"><div className="bq-note"><Icon name="info" size={18} /> {t('barQueue.needsSql')}</div></div>
  }

  return (
    <div className={`bq${prefs.colors ? ' has-colors' : ''}`} data-tone={prefs.colors ? tone : 'none'}>
      <div className="bq-head">
        <div className="bq-head-title">
          <h1><Icon name="catCocktail" size={22} /> {t('barQueue.title')}</h1>
          <p>{t('barQueue.lead')}</p>
        </div>
        <div className="bq-load" role="status">
          <strong>{t('barQueue.waiting', { n: waiting })}</strong>
          {prefs.colors && <span>{t(`barQueue.load.${tone}`)}</span>}
        </div>
        <div className="bq-toggles">
          <label className="bq-toggle" title={t('barQueue.colorsHint')}>
            <input type="checkbox" checked={prefs.colors} onChange={e => savePrefs({ ...prefs, colors: e.target.checked })} />
            <span>{t('barQueue.colors')}</span>
          </label>
          <label className="bq-toggle">
            <input type="checkbox" checked={prefs.sound} onChange={e => savePrefs({ ...prefs, sound: e.target.checked })} />
            <span>{t('barQueue.sound')}</span>
          </label>
        </div>
      </div>

      {err && <div className="pq-alert" role="alert">{err}</div>}

      {rows && !open.length && <p className="bq-empty"><Icon name="ok" size={20} /> {t('barQueue.none')}</p>}

      <div className="bq-grid">
        {open.map(r => {
          const ready = r.status === 'pronto'
          const age = secondsBetween(r.chegou_em, new Date(now).toISOString())
          return (
            <article key={r.id} className={`bq-card${ready ? ' is-ready' : ''}${flash.has(r.id) ? ' is-flash' : ''}`}>
              <header className="bq-card-head">
                <div>
                  <strong className="bq-card-label">{r.label || t(`barQueue.from.${r.origem}`)}</strong>
                  <small>{t(`barQueue.from.${r.origem}`)}{r.pedido_por_nome ? ` · ${t('barQueue.by', { name: r.pedido_por_nome })}` : ''}</small>
                </div>
                <span className="bq-timer">{ready ? t('barQueue.readyTag', { time: fmt(secondsBetween(r.chegou_em, r.pronto_em)) }) : fmt(age)}</span>
              </header>
              <ul className="bq-items">
                {(r.itens || []).map((it, i) => {
                  const key = `${r.id}:${i}`
                  const steps = recipeOpen.has(key) ? recipeFor(it, menu) : null
                  return (
                    <li key={key}>
                      <div className="bq-item">
                        <b className="bq-qty">{it.qtd}×</b>
                        <span className="bq-name">{it.nome}</span>
                        <button type="button" className={`bq-recipe-btn${recipeOpen.has(key) ? ' is-on' : ''}`} onClick={() => toggleRecipe(key)} aria-expanded={recipeOpen.has(key)}>
                          <Icon name="list" size={16} /> {t('barQueue.recipe')}
                        </button>
                      </div>
                      {steps && (steps.length
                        ? <ol className="bq-recipe">{steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
                        : <p className="bq-recipe is-empty">{t('barQueue.noRecipe')}</p>)}
                    </li>
                  )
                })}
              </ul>
              <div className="bq-actions">
                {ready ? (
                  <>
                    <button type="button" className="bq-btn is-deliver" disabled={busyId === r.id} onClick={() => act(r, 'entregue')}>
                      <Icon name="send" size={20} /> {t('barQueue.delivered')}
                    </button>
                    <button type="button" className="bq-undo" disabled={busyId === r.id} onClick={() => act(r, 'novo')} aria-label={t('barQueue.undo')}><Icon name="undo" size={18} /></button>
                  </>
                ) : (
                  <button type="button" className="bq-btn is-ready" disabled={busyId === r.id} onClick={() => act(r, 'pronto')}>
                    <Icon name="check" size={22} /> {t('barQueue.ready')}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <section className="bq-stats" aria-label={t('barQueue.tonight')}>
        <h2>{t('barQueue.tonight')}</h2>
        <div className="bq-tiles">
          <div><span>{t('barQueue.made')}</span><strong>{metrics.tickets}</strong></div>
          <div><span>{t('barQueue.drinks')}</span><strong>{metrics.drinks}</strong></div>
          <div><span>{t('barQueue.avgPrep')}</span><strong>{fmt(metrics.avgPrep)}</strong></div>
          <div><span>{t('barQueue.maxPrep')}</span><strong>{fmt(metrics.maxPrep)}</strong></div>
          <div><span>{t('barQueue.avgToGuest')}</span><strong>{fmt(metrics.avgToGuest)}</strong></div>
        </div>
        {metrics.byPerson.length > 0 && (
          <table className="bq-table">
            <thead><tr><th>{t('barQueue.person')}</th><th>{t('barQueue.orders')}</th><th>{t('barQueue.drinks')}</th><th>{t('barQueue.time')}</th></tr></thead>
            <tbody>
              {metrics.byPerson.map(p => (
                <tr key={p.id || p.nome}><td>{p.nome}</td><td>{p.tickets}</td><td>{p.drinks}</td><td>{fmt(p.avgPrep)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <h3>{t('barQueue.done')}</h3>
        {done.length ? (
          <ul className="bq-done">
            {done.map(r => (
              <li key={r.id}>
                <Icon name="ok" size={16} />
                <span>{r.label || t(`barQueue.from.${r.origem}`)} · {(r.itens || []).map(it => `${it.qtd}× ${it.nome}`).join(', ')}</span>
                <b>{fmt(secondsBetween(r.chegou_em, r.pronto_em))}</b>
              </li>
            ))}
          </ul>
        ) : <p className="bq-muted">{t('barQueue.noneDone')}</p>}
      </section>
    </div>
  )
}
