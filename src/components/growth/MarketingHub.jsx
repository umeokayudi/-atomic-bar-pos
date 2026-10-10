import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../lib/i18n'
import { useAiPageContext, useAiPanel } from '../../lib/aiPanel'
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, addDays, campaignLift, campaignRow, isMissingTable, isoDay, validateCampaign } from '../../lib/growth'
import { filterSupplierVendas, fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { Kpi } from './ClientsCrm'

const EMPTY = { nome: '', bar_id: '', canal: 'in_store', status: 'draft', inicio: '', fim: '', produtos: '', oferta: '', objetivo: '', orcamento: '', resultado_notas: '' }
const STATUS_TONE = { draft: '', scheduled: 'is-info', running: 'is-accent', done: 'is-success', cancelled: 'is-danger' }

/** Campaigns stored in marketing_campaigns (sql/growth.sql). Without that table the page says so and saves nothing. */
export default function MarketingHub({ barId: fixedBar = null }) {
  const { t } = useI18n()
  const { openAi } = useAiPanel()
  const [state, setState] = useState('loading')
  const [rows, setRows] = useState([])
  const [bars, setBars] = useState([])
  const [sales, setSales] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [barFilter, setBarFilter] = useState(fixedBar || '')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    let q = supabase.from('marketing_campaigns').select('*').order('inicio', { ascending: false, nullsFirst: true }).limit(500)
    if (fixedBar) q = q.eq('bar_id', fixedBar)
    const { data, error } = await q
    if (isMissingTable(error)) { setState('missing'); return }
    if (error) { setState('error'); setErr(error.message); return }
    setRows(data || [])
    setState('ok')
  }, [fixedBar])

  useEffect(() => {
    load()
    supabase.from('bars').select('id,nome').order('nome').then(({ data }) => setBars(data || []))
    const from = addDays(isoDay(new Date()), -400)
    let q = supabase.from('vendas').select('bar_id,total,data,data_venda,obs,cast_id,criado_em').gte('data', from).limit(10000)
    if (fixedBar) q = q.eq('bar_id', fixedBar)
    q.then(({ data }) => setSales(filterSupplierVendas(data)))
  }, [load, fixedBar])

  const barName = id => bars.find(b => b.id === id)?.nome || t('growth.allBarsHq')
  const visible = useMemo(() => rows.filter(r => (!statusFilter || r.status === statusFilter) && (!barFilter || r.bar_id === barFilter)), [rows, statusFilter, barFilter])
  const counts = useMemo(() => Object.fromEntries(CAMPAIGN_STATUSES.map(s => [s, rows.filter(r => r.status === s).length])), [rows])
  const budget = useMemo(() => rows.filter(r => r.status !== 'cancelled').reduce((a, r) => a + (+r.orcamento || 0), 0), [rows])

  useAiPageContext('marketing', {
    module: 'marketing',
    title: t('nav.marketing'),
    unit: barFilter ? barName(barFilter) : t('common.allBars'),
    barId: barFilter || null,
    filters: { status: statusFilter },
    kpis: state === 'ok' ? [
      { label: t('growth.camp.running'), value: counts.running },
      { label: t('growth.camp.scheduled'), value: counts.scheduled },
      { label: t('growth.budgetTotal'), value: fmtYen(budget) },
    ] : [],
  })

  async function save(e) {
    e.preventDefault()
    const v = validateCampaign(form)
    if (v) { setErr(t(v)); return }
    setBusy(true)
    setErr('')
    const row = campaignRow({ ...form, bar_id: fixedBar || form.bar_id })
    const { error } = form.id
      ? await supabase.from('marketing_campaigns').update(row).eq('id', form.id)
      : await supabase.from('marketing_campaigns').insert(row)
    setBusy(false)
    if (error) { setErr(t('growth.saveError', { error: error.message })); return }
    setForm(null)
    load()
  }

  async function setStatus(r, status) {
    const { error } = await supabase.from('marketing_campaigns').update({ status, atualizado_em: new Date().toISOString() }).eq('id', r.id)
    if (error) setErr(t('growth.saveError', { error: error.message }))
    load()
  }

  async function remove(r) {
    if (!window.confirm(t('growth.confirmDelete', { name: r.nome }))) return
    const { error } = await supabase.from('marketing_campaigns').delete().eq('id', r.id)
    if (error) setErr(t('growth.saveError', { error: error.message }))
    load()
  }

  const f = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fade-in growth-page">
      <div className="ui-pagebar">
        <div>
          <div className="ui-pagebar-title">{t('nav.marketing')}</div>
          <div className="ui-card-sub">{t('growth.mktSub')}</div>
        </div>
        <div className="ui-row">
          <button type="button" className="ui-btn" onClick={() => openAi(t('growth.askCampaign'))}><Icon name="ai" size={16} /> {t('growth.suggestWithAi')}</button>
          <button type="button" className="ui-btn is-primary" disabled={state !== 'ok'} onClick={() => { setErr(''); setForm({ ...EMPTY, bar_id: fixedBar || '' }) }}>
            <Icon name="plus" size={16} /> {t('growth.newCampaign')}
          </button>
        </div>
      </div>

      {state === 'missing' && <MissingTables file="sql/growth.sql" tables="marketing_campaigns" />}
      {state === 'error' && <div className="ui-error" role="alert"><Icon name="warning" />{t('growth.loadError', { error: err })}</div>}
      {state === 'loading' && <div className="ui-skel" style={{ height: 160 }} />}

      {state === 'ok' && (
        <>
          <div className="ui-grid cols-4">
            <Kpi icon="marketing" label={t('growth.camp.running')} value={String(counts.running)} />
            <Kpi icon="clock" label={t('growth.camp.scheduled')} value={String(counts.scheduled)} />
            <Kpi icon="history" label={t('growth.camp.done')} value={String(counts.done)} />
            <Kpi icon="cashflow" label={t('growth.budgetTotal')} value={fmtYen(budget)} />
          </div>

          <section className="ui-card">
            <div className="ui-card-head growth-toolbar">
              <div className="ui-seg" role="radiogroup" aria-label={t('common.status')}>
                <button type="button" role="radio" aria-checked={!statusFilter} onClick={() => setStatusFilter('')}>{t('common.all')}</button>
                {CAMPAIGN_STATUSES.map(s => (
                  <button key={s} type="button" role="radio" aria-checked={statusFilter === s} onClick={() => setStatusFilter(s)}>{t(`growth.camp.${s}`)}</button>
                ))}
              </div>
              {!fixedBar && (
                <label className="ui-field">
                  <span className="ui-sr">{t('common.bar')}</span>
                  <select value={barFilter} onChange={e => setBarFilter(e.target.value)}>
                    <option value="">{t('common.allBars')}</option>
                    {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
                  </select>
                </label>
              )}
            </div>
            {err && !form && <div className="ui-error" role="alert"><Icon name="warning" />{err}</div>}
            {visible.length === 0 ? (
              <div className="ui-empty"><Icon name="marketing" size={22} /><div className="ui-empty-title">{t('growth.noCampaigns')}</div><div>{t('growth.noCampaignsHint')}</div></div>
            ) : (
              <div className="growth-cards">
                {visible.map(r => {
                  const lift = campaignLift(sales, r)
                  return (
                    <article key={r.id} className="growth-card">
                      <div className="growth-card-head">
                        <div>
                          <div className="ui-card-title">{r.nome}</div>
                          <div className="ui-muted">{barName(r.bar_id)} · {t(`growth.channel.${r.canal}`)}</div>
                        </div>
                        <span className={`ui-badge ${STATUS_TONE[r.status] || ''}`}>{t(`growth.camp.${r.status}`)}</span>
                      </div>
                      <dl className="growth-dl">
                        <dt>{t('growth.when')}</dt><dd>{r.inicio || '—'} → {r.fim || '—'}</dd>
                        {r.oferta && <><dt>{t('growth.offer')}</dt><dd>{r.oferta}</dd></>}
                        {r.produtos && <><dt>{t('growth.products')}</dt><dd>{r.produtos}</dd></>}
                        {r.objetivo && <><dt>{t('growth.goal')}</dt><dd>{r.objetivo}</dd></>}
                        {r.orcamento != null && <><dt>{t('growth.budget')}</dt><dd>{fmtYen(r.orcamento)}</dd></>}
                        {lift && r.bar_id && (
                          <>
                            <dt>{t('growth.lift')}</dt>
                            <dd>
                              {fmtYen(lift.during)} {t('growth.vsBefore', { amount: fmtYen(lift.before), n: lift.days })}
                              {lift.pct != null && <strong className={lift.pct < 0 ? 'txt-danger' : 'txt-success'}> {lift.pct > 0 ? '+' : ''}{lift.pct}%</strong>}
                            </dd>
                          </>
                        )}
                        {r.resultado_notas && <><dt>{t('growth.results')}</dt><dd>{r.resultado_notas}</dd></>}
                      </dl>
                      <div className="ui-row growth-card-foot">
                        {r.status === 'draft' && <button type="button" className="ui-btn is-sm" onClick={() => setStatus(r, 'scheduled')}>{t('growth.schedule')}</button>}
                        {(r.status === 'scheduled' || r.status === 'draft') && <button type="button" className="ui-btn is-sm" onClick={() => setStatus(r, 'running')}>{t('growth.start')}</button>}
                        {r.status === 'running' && <button type="button" className="ui-btn is-sm" onClick={() => setStatus(r, 'done')}>{t('growth.finish')}</button>}
                        <button type="button" className="ui-btn is-ghost is-sm" onClick={() => { setErr(''); setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ''])) }) }}>
                          <Icon name="settings" size={14} /> {t('common.edit')}
                        </button>
                        <span className="ui-spacer" />
                        <button type="button" className="ui-btn is-ghost is-icon is-sm" aria-label={t('common.delete')} onClick={() => remove(r)}><Icon name="trash" size={14} /></button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
            <p className="growth-formula"><Icon name="info" size={14} /> {t('growth.liftFormula')}</p>
          </section>
        </>
      )}

      {form && (
        <>
          <div className="ui-drawer-scrim" onClick={() => setForm(null)} />
          <form className="ui-drawer" role="dialog" aria-modal="true" aria-label={form.id ? t('growth.editCampaign') : t('growth.newCampaign')} onSubmit={save}>
            <div className="ui-drawer-head">
              <div className="ui-drawer-title">{form.id ? t('growth.editCampaign') : t('growth.newCampaign')}</div>
              <button type="button" className="ui-btn is-ghost is-icon" onClick={() => setForm(null)} aria-label={t('common.close')}><Icon name="close" /></button>
            </div>
            <div className="ui-drawer-body growth-form">
              <label className="ui-field"><span>{t('growth.name')}</span><input required value={form.nome} onChange={e => f('nome', e.target.value)} autoFocus /></label>
              {!fixedBar && (
                <label className="ui-field"><span>{t('common.bar')}</span>
                  <select value={form.bar_id} onChange={e => f('bar_id', e.target.value)}>
                    <option value="">{t('growth.allBarsHq')}</option>
                    {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
                  </select>
                </label>
              )}
              <div className="ui-grid cols-2">
                <label className="ui-field"><span>{t('growth.channelLabel')}</span>
                  <select value={form.canal} onChange={e => f('canal', e.target.value)}>
                    {CAMPAIGN_CHANNELS.map(c => <option key={c} value={c}>{t(`growth.channel.${c}`)}</option>)}
                  </select>
                </label>
                <label className="ui-field"><span>{t('common.status')}</span>
                  <select value={form.status} onChange={e => f('status', e.target.value)}>
                    {CAMPAIGN_STATUSES.map(s => <option key={s} value={s}>{t(`growth.camp.${s}`)}</option>)}
                  </select>
                </label>
                <label className="ui-field"><span>{t('growth.start')}</span><input type="date" value={form.inicio} onChange={e => f('inicio', e.target.value)} /></label>
                <label className="ui-field"><span>{t('growth.end')}</span><input type="date" value={form.fim} onChange={e => f('fim', e.target.value)} /></label>
              </div>
              <label className="ui-field"><span>{t('growth.offer')}</span><input value={form.oferta} onChange={e => f('oferta', e.target.value)} placeholder={t('growth.offerPh')} /></label>
              <label className="ui-field"><span>{t('growth.products')}</span><input value={form.produtos} onChange={e => f('produtos', e.target.value)} /></label>
              <label className="ui-field"><span>{t('growth.goal')}</span><input value={form.objetivo} onChange={e => f('objetivo', e.target.value)} placeholder={t('growth.goalPh')} /></label>
              <label className="ui-field"><span>{t('growth.budget')} (¥)</span><input type="number" min="0" step="1" inputMode="numeric" value={form.orcamento} onChange={e => f('orcamento', e.target.value)} /></label>
              <label className="ui-field"><span>{t('growth.results')}</span><textarea rows={3} value={form.resultado_notas} onChange={e => f('resultado_notas', e.target.value)} /></label>
              {err && <div className="ui-error" role="alert"><Icon name="warning" />{err}</div>}
            </div>
            <div className="ui-drawer-foot">
              <button type="button" className="ui-btn" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <button type="submit" className="ui-btn is-primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
            </div>
          </form>
        </>
      )}
    </div>
  )
}

export function MissingTables({ file, tables }) {
  const { t } = useI18n()
  return (
    <div className="ui-empty growth-missing">
      <Icon name="lock" size={22} />
      <div className="ui-empty-title">{t('growth.missingTitle')}</div>
      <div>{t('growth.missingBody', { tables, file })}</div>
    </div>
  )
}
