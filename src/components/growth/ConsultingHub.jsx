import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../lib/i18n'
import { useAiPageContext, useAiPanel } from '../../lib/aiPanel'
import { addDays, buildClientRows, isMissingTable, isoDay, kpiDelta, planProgress } from '../../lib/growth'
import { filterSupplierVendas, fmtYen } from '../utils'
import { useAuth } from '../Auth'
import Icon from '../ui/Icon'
import { MissingTables } from './MarketingHub'

const PRIORITIES = ['high', 'medium', 'low']
const TASK_STATUSES = ['todo', 'doing', 'done']
// The KPIs frozen as baseline when a plan starts and compared with today's numbers.
const KPI_KEYS = [
  { key: 'revenue', money: true },
  { key: 'salesCount', money: false },
  { key: 'receivable', money: true },
  { key: 'overdue', money: true },
]

async function currentKpis(barId) {
  const today = isoDay(new Date())
  const [b, v, f, p] = await Promise.all([
    supabase.from('bars').select('id,nome').eq('id', barId),
    supabase.from('vendas').select('bar_id,total,data,data_venda,obs,cast_id,criado_em').eq('bar_id', barId).gte('data', addDays(today, -59)),
    supabase.from('faturas').select('bar_id,total,valor,pago,status,vencimento,data_vencimento').eq('bar_id', barId),
    supabase.from('pedidos').select('bar_id,status,data_pedido').eq('bar_id', barId).limit(500),
  ])
  const err = b.error || v.error || f.error || p.error
  if (err) throw err
  const [row] = buildClientRows({ bars: b.data || [], sales: filterSupplierVendas(v.data), invoices: f.data || [], orders: p.data || [], today, days: 30 })
  return row ? { revenue: row.revenue, salesCount: row.salesCount, receivable: row.receivable, overdue: row.overdue } : {}
}

/** Consulting plans per bar (sql/growth.sql): diagnosis, baseline KPIs, tasks with owner, deadline and priority. */
export default function ConsultingHub({ barId: fixedBar = null }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const { openAi } = useAiPanel()
  const isHq = perfil?.role === 'admin' || perfil?.role === 'jbm'
  const [state, setState] = useState('loading')
  const [plans, setPlans] = useState([])
  const [tasks, setTasks] = useState([])
  const [bars, setBars] = useState([])
  const [selected, setSelected] = useState(null)
  const [current, setCurrent] = useState(null)
  const [newPlan, setNewPlan] = useState(null)
  const [newTask, setNewTask] = useState({ titulo: '', responsavel: '', prazo: '', prioridade: 'medium', kpi: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    let pq = supabase.from('consulting_plans').select('*').order('criado_em', { ascending: false })
    let tq = supabase.from('consulting_tasks').select('*').order('prazo', { ascending: true, nullsFirst: false })
    if (fixedBar) { pq = pq.eq('bar_id', fixedBar); tq = tq.eq('bar_id', fixedBar) }
    const [p, tk] = await Promise.all([pq, tq])
    if (isMissingTable(p.error) || isMissingTable(tk.error)) { setState('missing'); return }
    if (p.error || tk.error) { setState('error'); setErr((p.error || tk.error).message); return }
    setPlans(p.data || [])
    setTasks(tk.data || [])
    setState('ok')
    setSelected(s => s && (p.data || []).some(x => x.id === s) ? s : (p.data?.[0]?.id || null))
  }, [fixedBar])

  useEffect(() => {
    load()
    supabase.from('bars').select('id,nome').order('nome').then(({ data }) => setBars(data || []))
  }, [load])

  const plan = plans.find(p => p.id === selected) || null
  const planTasks = useMemo(() => tasks.filter(x => x.plan_id === selected), [tasks, selected])
  const progress = planProgress(planTasks)
  const barName = id => bars.find(b => b.id === id)?.nome || '—'

  useEffect(() => {
    setCurrent(null)
    if (!plan) return
    let alive = true
    currentKpis(plan.bar_id).then(k => { if (alive) setCurrent(k) }).catch(() => { if (alive) setCurrent({}) })
    return () => { alive = false }
  }, [plan?.id, plan?.bar_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useAiPageContext('consultoria', {
    module: 'consulting',
    title: plan ? `${t('nav.consultoria')} · ${plan.titulo}` : t('nav.consultoria'),
    unit: plan ? barName(plan.bar_id) : (fixedBar ? barName(fixedBar) : t('common.allBars')),
    barId: plan?.bar_id || fixedBar || null,
    kpis: plan ? [
      { label: t('growth.progress'), value: `${progress.done}/${progress.total}` },
      { label: t('growth.overdueTasks'), value: progress.overdue },
      ...KPI_KEYS.filter(k => plan.baseline?.[k.key] != null).map(k => ({
        label: t(`growth.kpi.${k.key}`), value: `${t('growth.baseline')} ${k.money ? fmtYen(plan.baseline[k.key]) : plan.baseline[k.key]} → ${current?.[k.key] != null ? (k.money ? fmtYen(current[k.key]) : current[k.key]) : '?'}`,
      })),
    ] : [],
  })

  async function createPlan(e) {
    e.preventDefault()
    if (!newPlan.bar_id || !newPlan.titulo.trim()) { setErr(t('growth.errPlan')); return }
    setBusy(true)
    setErr('')
    let baseline = {}
    try { baseline = await currentKpis(newPlan.bar_id) } catch { baseline = {} }
    const { data, error } = await supabase.from('consulting_plans')
      .insert({ bar_id: newPlan.bar_id, titulo: newPlan.titulo.trim(), diagnostico: newPlan.diagnostico.trim() || null, baseline })
      .select('id').single()
    setBusy(false)
    if (error) { setErr(t('growth.saveError', { error: error.message })); return }
    setNewPlan(null)
    await load()
    setSelected(data.id)
  }

  async function addTask(e) {
    e.preventDefault()
    if (!newTask.titulo.trim() || !plan) return
    setBusy(true)
    const { error } = await supabase.from('consulting_tasks').insert({
      plan_id: plan.id, bar_id: plan.bar_id, titulo: newTask.titulo.trim(), responsavel: newTask.responsavel.trim() || null,
      prazo: newTask.prazo || null, prioridade: newTask.prioridade, kpi: newTask.kpi.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(t('growth.saveError', { error: error.message })); return }
    setNewTask({ titulo: '', responsavel: '', prazo: '', prioridade: 'medium', kpi: '' })
    load()
  }

  async function setTaskStatus(task, status) {
    const { error } = await supabase.from('consulting_tasks')
      .update({ status, concluida_em: status === 'done' ? new Date().toISOString() : null }).eq('id', task.id)
    if (error) setErr(t('growth.saveError', { error: error.message }))
    load()
  }

  async function setPlanStatus(status) {
    const { error } = await supabase.from('consulting_plans').update({ status }).eq('id', plan.id)
    if (error) setErr(t('growth.saveError', { error: error.message }))
    load()
  }

  return (
    <div className="fade-in growth-page">
      <div className="ui-pagebar">
        <div>
          <div className="ui-pagebar-title">{t('nav.consultoria')}</div>
          <div className="ui-card-sub">{t('growth.conSub')}</div>
        </div>
        <div className="ui-row">
          <button type="button" className="ui-btn" onClick={() => openAi(t('growth.askDiagnosis'))}><Icon name="ai" size={16} /> {t('growth.diagnoseWithAi')}</button>
          {isHq && (
            <button type="button" className="ui-btn is-primary" disabled={state !== 'ok'} onClick={() => { setErr(''); setNewPlan({ bar_id: fixedBar || '', titulo: '', diagnostico: '' }) }}>
              <Icon name="plus" size={16} /> {t('growth.newPlan')}
            </button>
          )}
        </div>
      </div>

      {state === 'missing' && <MissingTables file="sql/growth.sql" tables="consulting_plans, consulting_tasks" />}
      {state === 'error' && <div className="ui-error" role="alert"><Icon name="warning" />{t('growth.loadError', { error: err })}</div>}
      {state === 'loading' && <div className="ui-skel" style={{ height: 160 }} />}

      {state === 'ok' && plans.length === 0 && !newPlan && (
        <div className="ui-empty"><Icon name="consultoria" size={22} /><div className="ui-empty-title">{t('growth.noPlans')}</div><div>{t('growth.noPlansHint')}</div></div>
      )}

      {newPlan && (
        <form className="ui-card growth-form" onSubmit={createPlan}>
          <div className="ui-card-title">{t('growth.newPlan')}</div>
          <div className="ui-grid cols-2">
            <label className="ui-field"><span>{t('common.bar')}</span>
              <select required value={newPlan.bar_id} onChange={e => setNewPlan(p => ({ ...p, bar_id: e.target.value }))} disabled={!!fixedBar}>
                <option value="">—</option>
                {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </label>
            <label className="ui-field"><span>{t('growth.planTitle')}</span><input required value={newPlan.titulo} onChange={e => setNewPlan(p => ({ ...p, titulo: e.target.value }))} /></label>
          </div>
          <label className="ui-field"><span>{t('growth.diagnosis')}</span><textarea rows={4} value={newPlan.diagnostico} onChange={e => setNewPlan(p => ({ ...p, diagnostico: e.target.value }))} placeholder={t('growth.diagnosisPh')} /></label>
          <p className="growth-formula"><Icon name="info" size={14} /> {t('growth.baselineNote')}</p>
          {err && <div className="ui-error" role="alert"><Icon name="warning" />{err}</div>}
          <div className="ui-row">
            <span className="ui-spacer" />
            <button type="button" className="ui-btn" onClick={() => setNewPlan(null)}>{t('common.cancel')}</button>
            <button type="submit" className="ui-btn is-primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
          </div>
        </form>
      )}

      {state === 'ok' && plans.length > 0 && (
        <div className="growth-split">
          <nav className="ui-card growth-plan-list" aria-label={t('growth.plans')}>
            {plans.map(p => {
              const pr = planProgress(tasks.filter(x => x.plan_id === p.id))
              return (
                <button key={p.id} type="button" className={`ai-center-link${p.id === selected ? ' is-on' : ''}`} onClick={() => setSelected(p.id)}>
                  <span className="growth-plan-name">{p.titulo}<span className="ui-muted">{barName(p.bar_id)}</span></span>
                  <span className={`ui-badge ${p.status === 'done' ? 'is-success' : p.status === 'paused' ? 'is-warning' : 'is-accent'}`}>{pr.pct}%</span>
                </button>
              )
            })}
          </nav>

          {plan && (
            <section className="ui-card growth-plan">
              <div className="ui-card-head">
                <div>
                  <div className="ui-card-title">{plan.titulo}</div>
                  <div className="ui-card-sub">{barName(plan.bar_id)} · {t('growth.since', { date: plan.baseline_em })}</div>
                </div>
                {isHq && (
                  <label className="ui-field">
                    <span className="ui-sr">{t('common.status')}</span>
                    <select value={plan.status} onChange={e => setPlanStatus(e.target.value)}>
                      {['active', 'paused', 'done'].map(s => <option key={s} value={s}>{t(`growth.plan.${s}`)}</option>)}
                    </select>
                  </label>
                )}
              </div>
              {plan.diagnostico && <p className="growth-diagnosis">{plan.diagnostico}</p>}

              <div className="growth-progress" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('growth.progress')}>
                <span style={{ width: `${progress.pct}%` }} />
              </div>
              <div className="ui-muted">{t('growth.progressLine', { done: progress.done, total: progress.total, overdue: progress.overdue })}</div>

              <h3 className="growth-h">{t('growth.baselineVsNow')}</h3>
              <table className="ui-table is-stack">
                <thead><tr><th>{t('growth.indicator')}</th><th className="num">{t('growth.baseline')}</th><th className="num">{t('growth.now')}</th><th className="num">{t('growth.change')}</th></tr></thead>
                <tbody>
                  {KPI_KEYS.map(k => {
                    const b = plan.baseline?.[k.key]
                    const c = current?.[k.key]
                    const d = kpiDelta(b, c)
                    const fmt = v => (v == null ? '—' : k.money ? fmtYen(v) : String(v))
                    const good = d && (k.key === 'receivable' || k.key === 'overdue' ? d.delta <= 0 : d.delta >= 0)
                    return (
                      <tr key={k.key}>
                        <td data-label={t('growth.indicator')}>{t(`growth.kpi.${k.key}`)}</td>
                        <td data-label={t('growth.baseline')} className="num">{fmt(b)}</td>
                        <td data-label={t('growth.now')} className="num">{current ? fmt(c) : '…'}</td>
                        <td data-label={t('growth.change')} className="num">
                          {d ? <span className={good ? 'txt-success' : 'txt-danger'}>{d.delta > 0 ? '+' : ''}{k.money ? fmtYen(d.delta) : d.delta}{d.pct != null ? ` (${d.pct > 0 ? '+' : ''}${d.pct}%)` : ''}</span> : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="growth-formula"><Icon name="info" size={14} /> {t('growth.kpiFormula')}</p>

              <h3 className="growth-h">{t('growth.tasks')}</h3>
              {planTasks.length === 0 && <div className="ui-muted">{t('growth.noTasks')}</div>}
              <ul className="growth-tasks">
                {planTasks.map(task => {
                  const late = task.status !== 'done' && task.prazo && task.prazo < isoDay(new Date())
                  return (
                    <li key={task.id} className={`growth-task is-${task.status}`}>
                      <div className="growth-task-main">
                        <div className="growth-task-title">{task.titulo}</div>
                        <div className="ui-muted">
                          {task.responsavel || t('growth.noOwner')} · {task.prazo ? <span className={late ? 'txt-danger' : ''}>{task.prazo}</span> : t('growth.noDeadline')}
                          {task.kpi && <> · {t('growth.kpiLabel')}: {task.kpi}</>}
                        </div>
                      </div>
                      <span className={`ui-badge ${task.prioridade === 'high' ? 'is-danger' : task.prioridade === 'low' ? '' : 'is-warning'}`}>{t(`growth.prio.${task.prioridade}`)}</span>
                      <label className="ui-field growth-task-status">
                        <span className="ui-sr">{t('common.status')}</span>
                        <select value={task.status} onChange={e => setTaskStatus(task, e.target.value)}>
                          {TASK_STATUSES.map(s => <option key={s} value={s}>{t(`growth.task.${s}`)}</option>)}
                        </select>
                      </label>
                    </li>
                  )
                })}
              </ul>

              <form className="growth-task-form" onSubmit={addTask}>
                <label className="ui-field"><span>{t('growth.taskTitle')}</span><input value={newTask.titulo} onChange={e => setNewTask(x => ({ ...x, titulo: e.target.value }))} required /></label>
                <label className="ui-field"><span>{t('growth.owner')}</span><input value={newTask.responsavel} onChange={e => setNewTask(x => ({ ...x, responsavel: e.target.value }))} /></label>
                <label className="ui-field"><span>{t('growth.deadline')}</span><input type="date" value={newTask.prazo} onChange={e => setNewTask(x => ({ ...x, prazo: e.target.value }))} /></label>
                <label className="ui-field"><span>{t('growth.priority')}</span>
                  <select value={newTask.prioridade} onChange={e => setNewTask(x => ({ ...x, prioridade: e.target.value }))}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{t(`growth.prio.${p}`)}</option>)}
                  </select>
                </label>
                <label className="ui-field"><span>{t('growth.kpiLabel')}</span><input value={newTask.kpi} onChange={e => setNewTask(x => ({ ...x, kpi: e.target.value }))} placeholder={t('growth.kpiPh')} /></label>
                <button type="submit" className="ui-btn is-primary" disabled={busy}><Icon name="plus" size={16} /> {t('growth.addTask')}</button>
              </form>
              {err && <div className="ui-error" role="alert"><Icon name="warning" />{err}</div>}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
