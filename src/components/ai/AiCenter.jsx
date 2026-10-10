import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { aiHistory, useAiPageContext } from '../../lib/aiPanel'
import { useI18n } from '../../lib/i18n'
import { useAuth } from '../Auth'
import Icon from '../ui/Icon'
import AiChat from './AiChat'

const AREAS = [
  { id: 'overview', icon: 'dashboard' },
  { id: 'reports', icon: 'report' },
  { id: 'finance', icon: 'cashflow' },
  { id: 'stock', icon: 'estoque' },
  { id: 'supply', icon: 'procurement' },
  { id: 'sales', icon: 'sales' },
  { id: 'marketing', icon: 'marketing' },
  { id: 'team', icon: 'usuarios' },
  { id: 'consulting', icon: 'consultoria' },
]
const PERIODS = [7, 30, 90]

function fmtWhen(iso, lang) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) } catch { return iso }
}

function missing(error) {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /does not exist|could not find the table/i.test(error.message || ''))
}

function ActionLog() {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState(null)
  const [state, setState] = useState('loading')
  useEffect(() => {
    let alive = true
    supabase.from('ai_action_log').select('id,action,status,params,result,criado_em').order('criado_em', { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (!alive) return
        if (missing(error)) { setState('missing'); return }
        if (error) { setState('error'); return }
        setRows(data || [])
        setState('ok')
      })
    return () => { alive = false }
  }, [])
  if (state === 'loading') return <div className="ui-skel" style={{ height: 120 }} />
  if (state === 'missing') {
    return (
      <div className="ui-empty"><Icon name="history" size={22} /><div className="ui-empty-title">{t('ai.logMissingTitle')}</div><div>{t('ai.logMissing')}</div></div>
    )
  }
  if (state === 'error') return <div className="ui-error"><Icon name="warning" />{t('ai.logError')}</div>
  if (!rows.length) return <div className="ui-empty"><Icon name="history" size={22} /><div className="ui-empty-title">{t('ai.logEmpty')}</div></div>
  return (
    <table className="ui-table is-stack">
      <thead><tr><th>{t('ai.logWhen')}</th><th>{t('ai.logAction')}</th><th>{t('common.status')}</th><th>{t('ai.logResult')}</th></tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td data-label={t('ai.logWhen')}>{fmtWhen(r.criado_em, lang)}</td>
            <td data-label={t('ai.logAction')}>{r.action}</td>
            <td data-label={t('common.status')}>
              <span className={`ui-badge ${r.status === 'done' ? 'is-success' : r.status === 'failed' ? 'is-danger' : 'is-warning'}`}>{t(`ai.status.${r.status}`)}</span>
            </td>
            <td data-label={t('ai.logResult')}>{r.result?.message || r.result?.error || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** AI Center: one place for analysis across modules, history, and what the AI wrote after confirmation. */
/** bar: when opened from a bar portal, the center is locked to that bar. */
export default function AiCenter({ bar = null } = {}) {
  const { t, lang } = useI18n()
  const { perfil } = useAuth()
  const [area, setArea] = useState('overview')
  const [view, setView] = useState('chat')
  const [days, setDays] = useState(30)
  const [bars, setBars] = useState([])
  const [barId, setBarId] = useState(bar?.id || '')
  const [threads, setThreads] = useState([])
  const [thread, setThread] = useState({ id: 'center', messages: [] })
  const [histMode, setHistMode] = useState('')

  useEffect(() => {
    if (bar) { setBars([{ id: bar.id, nome: bar.nome }]); return }
    supabase.from('bars').select('id,nome').order('nome').then(({ data }) => setBars(data || []))
  }, [bar?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshHistory() {
    try {
      setThreads(await aiHistory.list())
      setHistMode(aiHistory.mode)
    } catch { setThreads([]) }
  }
  useEffect(() => { refreshHistory() }, [])

  const unit = bars.find(b => b.id === barId)?.nome || t('common.allBars')
  const ctx = useMemo(() => ({
    module: area,
    title: `${t('ai.center')} · ${t(`ai.module.${area}`)}`,
    unit,
    period: t('ai.lastDays', { n: days }),
    days,
    barId: barId || null,
  }), [area, unit, days, barId, t])
  useAiPageContext('ai', ctx)

  async function openThread(id) {
    try {
      const full = await aiHistory.get(id)
      if (full) {
        setArea(full.module || 'overview')
        setThread({ id: full.id, serverId: aiHistory.mode === 'server' ? full.id : null, messages: full.messages || [] })
        setView('chat')
      }
    } catch { /* stays on current */ }
  }

  async function removeThread(id) {
    try { await aiHistory.remove(id) } finally { refreshHistory() }
    if (thread.id === id) setThread({ id: `center-${Date.now()}`, messages: [] })
  }

  return (
    <div className="ai-center fade-in">
      <div className="ui-pagebar">
        <div className="ui-pagebar-title">{t('ai.center')}</div>
        {!bar && <label className="ui-field ai-center-filter">
          <span className="ui-sr">{t('common.bar')}</span>
          <select value={barId} onChange={e => setBarId(e.target.value)} disabled={perfil?.role !== 'admin' && perfil?.role !== 'jbm'}>
            <option value="">{t('common.allBars')}</option>
            {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
        </label>}
        <div className="ui-seg" role="radiogroup" aria-label={t('ai.period')}>
          {PERIODS.map(n => (
            <button key={n} type="button" role="radio" aria-checked={days === n} onClick={() => setDays(n)}>{t('ai.daysShort', { n })}</button>
          ))}
        </div>
      </div>

      <div className="ai-center-grid">
        <nav className="ai-center-nav ui-card" aria-label={t('ai.center')}>
          <div className="ai-center-group">{t('ai.analyses')}</div>
          {AREAS.map(a => (
            <button key={a.id} type="button" className={`ai-center-link${view === 'chat' && area === a.id ? ' is-on' : ''}`}
              onClick={() => { setArea(a.id); setView('chat'); setThread({ id: `center-${Date.now()}`, messages: [] }) }}>
              <Icon name={a.icon} size={16} /> {t(`ai.module.${a.id}`)}
            </button>
          ))}
          <div className="ai-center-group">{t('ai.manage')}</div>
          <button type="button" className={`ai-center-link${view === 'history' ? ' is-on' : ''}`} onClick={() => { setView('history'); refreshHistory() }}>
            <Icon name="history" size={16} /> {t('ai.history')}
          </button>
          <button type="button" className={`ai-center-link${view === 'actions' ? ' is-on' : ''}`} onClick={() => setView('actions')}>
            <Icon name="automation" size={16} /> {t('ai.actions')}
          </button>
        </nav>

        <section className="ai-center-main ui-card">
          {view === 'chat' && (
            <>
              <div className="ui-card-head">
                <div>
                  <div className="ui-card-title">{t(`ai.module.${area}`)}</div>
                  <div className="ui-card-sub">{t(`ai.areaHint.${area}`)}</div>
                </div>
                <button type="button" className="ui-btn is-sm" onClick={() => setThread({ id: `center-${Date.now()}`, messages: [] })}>
                  <Icon name="plus" size={14} /> {t('ai.newChat')}
                </button>
              </div>
              <AiChat ctx={ctx} thread={thread} onThreadSaved={() => refreshHistory()} />
            </>
          )}
          {view === 'history' && (
            <>
              <div className="ui-card-head">
                <div className="ui-card-title">{t('ai.history')}</div>
                <span className="ui-badge">{histMode === 'server' ? t('ai.histServer') : t('ai.histLocal')}</span>
              </div>
              {threads.length === 0 ? (
                <div className="ui-empty"><Icon name="history" size={22} /><div className="ui-empty-title">{t('ai.histEmpty')}</div></div>
              ) : (
                <ul className="ai-thread-list">
                  {threads.map(th => (
                    <li key={th.id}>
                      <button type="button" className="ai-thread" onClick={() => openThread(th.id)}>
                        <span className="ui-badge is-accent">{t(`ai.module.${th.module || 'overview'}`)}</span>
                        <span className="ai-thread-title">{th.title}</span>
                        <span className="ui-muted">{fmtWhen(th.updated, lang)}</span>
                      </button>
                      <button type="button" className="ui-btn is-ghost is-icon is-sm" aria-label={t('common.delete')} onClick={() => removeThread(th.id)}><Icon name="trash" size={14} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {view === 'actions' && (
            <>
              <div className="ui-card-head">
                <div>
                  <div className="ui-card-title">{t('ai.actions')}</div>
                  <div className="ui-card-sub">{t('ai.actionsHint')}</div>
                </div>
              </div>
              <ActionLog />
            </>
          )}
        </section>
      </div>
    </div>
  )
}
