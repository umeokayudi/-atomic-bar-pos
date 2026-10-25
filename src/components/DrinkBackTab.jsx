import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, Spinner } from './utils'
import { useI18n } from '../lib/i18n'
import { tokyoNightKey } from '../lib/tokyo'
import { monthBounds, shiftMonth } from '../lib/barCalendar'
import { DRINK_BACK_PRESETS, drinkBackBoard, presetOf, presetRange, salesInRange, visibleNotes } from '../lib/drinkBackPeriod'
import { PageHeader, PortalKpi } from './ui/PageLayout'
import RangeCalendar from './RangeCalendar'
import Icon from './ui/Icon'

const SALE_COLS = 'id,total,refunded,obs,drink_back_agent_id,data'
const SALE_COLS_SLIM = 'id,total,obs,drink_back_agent_id,data'
const EMPTY_FORM = { nome: '', regiao: '', comissao_pct: '30', notas: '' }
const PCT_CHIPS = ['30', '50']

/** One query per month, so a long range never hits the row cap of a single request. */
async function fetchSales(barId, from, to) {
  const out = []
  for (let ym = from.slice(0, 7); ym <= to.slice(0, 7); ym = shiftMonth(ym, 1)) {
    const b = monthBounds(ym)
    const lo = b.from < from ? from : b.from
    const hi = b.to > to ? to : b.to
    const q = cols => supabase.from('pos_vendas').select(cols).eq('bar_id', barId).gte('data', lo).lte('data', hi)
    let r = await q(SALE_COLS)
    if (r.error) r = await q(SALE_COLS_SLIM)
    if (r.error) throw r.error
    out.push(...(r.data || []))
  }
  return out
}

function fmtDay(key, lang) {
  if (!key) return ''
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  return dt.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export default function DrinkBackTab({ bar }) {
  const { t, lang } = useI18n()
  const today = tokyoNightKey()
  const [range, setRange] = useState(() => presetRange('month', today))
  const [showCal, setShowCal] = useState(false)
  const [agents, setAgents] = useState([])
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [salesLoading, setSalesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState(null) // null = closed, 'new' or an agent id
  const [open, setOpen] = useState('')
  const [showOff, setShowOff] = useState(false)

  useEffect(() => { loadAgents() }, [bar?.id])
  useEffect(() => { loadSales() }, [bar?.id, range.from, range.to])

  async function loadAgents() {
    setErr('')
    const aR = await supabase.from('drink_back_agents').select('*').eq('bar_id', bar.id).order('nome')
    if (aR.error) setErr(aR.error.message)
    setAgents(aR.data || [])
    setLoading(false)
  }

  async function loadSales() {
    if (!range.from || !range.to) return
    setSalesLoading(true)
    try {
      setSales(await fetchSales(bar.id, range.from, range.to))
    } catch (e) {
      setSales([])
      setErr(e?.message || String(e))
    }
    setSalesLoading(false)
  }

  function pickPreset(id) {
    setRange(presetRange(id, today))
    setShowCal(false)
  }

  function startAdd() {
    setForm(EMPTY_FORM)
    setEditing('new')
  }

  function startEdit(agent) {
    setForm({
      nome: agent.nome || '',
      regiao: agent.regiao || '',
      comissao_pct: String(agent.comissao_pct ?? ''),
      notas: visibleNotes(agent.notas),
    })
    setEditing(agent.id)
  }

  async function saveAgent() {
    if (!form.nome.trim()) return
    setSaving(true)
    setErr('')
    const isNew = editing === 'new'
    const current = isNew ? null : agents.find(a => a.id === editing)
    const typedNotes = form.notas.trim()
    // Keep the hidden "staff:<id>" link line when the owner edits a linked woman.
    const notas = !isNew && current && !visibleNotes(current.notas) && current.notas && !typedNotes ? current.notas : (typedNotes || null)
    const row = {
      nome: form.nome.trim(),
      regiao: form.regiao.trim() || null,
      comissao_pct: +form.comissao_pct || 0,
      notas,
    }
    let error
    if (isNew) {
      ;({ error } = await supabase.from('drink_back_agents').insert({ ...row, bar_id: bar.id, ativo: true }))
      if (error && /regiao|notas/.test(error.message || '')) {
        ;({ error } = await supabase.from('drink_back_agents').insert({ bar_id: bar.id, nome: row.nome, comissao_pct: row.comissao_pct, ativo: true }))
      }
    } else {
      ;({ error } = await supabase.from('drink_back_agents').update(row).eq('id', editing))
      if (error && /regiao|notas/.test(error.message || '')) {
        ;({ error } = await supabase.from('drink_back_agents').update({ nome: row.nome, comissao_pct: row.comissao_pct }).eq('id', editing))
      }
    }
    setSaving(false)
    if (error) { setErr(error.message); return }
    setEditing(null)
    setForm(EMPTY_FORM)
    loadAgents()
  }

  async function toggleAgent(agent) {
    const { error } = await supabase.from('drink_back_agents').update({ ativo: !agent.ativo }).eq('id', agent.id)
    if (error) setErr(error.message)
    loadAgents()
  }

  const inRange = useMemo(() => salesInRange(sales, range.from, range.to), [sales, range.from, range.to])
  const board = useMemo(() => drinkBackBoard(inRange, agents), [inRange, agents])

  if (loading) return <Spinner text={t('house.drinkBackTitle')} />

  const preset = presetOf(range.from, range.to, today)
  const periodLabel = range.from === range.to
    ? fmtDay(range.from, lang)
    : `${fmtDay(range.from, lang)} → ${fmtDay(range.to, lang)}`
  const activeRows = board.rows.filter(r => r.ativo || r.tickets > 0)
  const offRows = board.rows.filter(r => !r.ativo && !r.tickets)
  const best = board.rows.find(r => r.revenue > 0)

  const editor = (
    <div className="db-editor">
      <div className="db-editor-head">
        <strong>{editing === 'new' ? t('house.drinkAddTitle') : t('house.drinkEditTitle')}</strong>
        <button type="button" className="db-icon-btn" aria-label={t('house.drinkCancel')} onClick={() => setEditing(null)}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="db-editor-grid">
        <label>{t('house.name')}
          <input autoFocus value={form.nome} placeholder={t('house.drinkNameHint')} onChange={e => setForm({ ...form, nome: e.target.value })} />
        </label>
        <label>{t('house.positioning')}
          <input value={form.regiao} placeholder={t('house.drinkPositionHint')} onChange={e => setForm({ ...form, regiao: e.target.value })} />
        </label>
        <div className="db-field">
          <span>{t('house.drinkPct')}</span>
          <div className="db-pct">
            {PCT_CHIPS.map(p => (
              <button key={p} type="button" className={`date-filter-chip${form.comissao_pct === p ? ' is-on' : ''}`} onClick={() => setForm({ ...form, comissao_pct: p })}>
                {p}% <small>{t('house.drinkPerDrink', { amount: fmtYen(2000 * +p / 100) })}</small>
              </button>
            ))}
            <label className="db-pct-other">
              <input type="number" min="0" max="100" inputMode="numeric" value={form.comissao_pct} onChange={e => setForm({ ...form, comissao_pct: e.target.value })} aria-label={t('house.drinkPct')} />
              <span>%</span>
            </label>
          </div>
        </div>
        <label>{t('house.notes')}
          <input value={form.notas} placeholder={t('house.drinkNotesHint')} onChange={e => setForm({ ...form, notas: e.target.value })} />
        </label>
      </div>
      <div className="db-editor-actions">
        <button type="button" className="db-ghost" onClick={() => setEditing(null)}>{t('house.drinkCancel')}</button>
        <button type="button" className="btn-primary" disabled={saving || !form.nome.trim()} onClick={saveAgent}>
          {saving ? '…' : editing === 'new' ? t('house.drinkAddSave') : t('house.drinkSave')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="fade-in house-page db-page">
      <PageHeader
        title={t('house.drinkBackTitle')}
        subtitle={t('house.drinkBackLead')}
        actions={editing !== 'new' && (
          <button type="button" className="btn-primary" onClick={startAdd}>
            <Icon name="plus" size={16} /> {t('house.drinkAdd')}
          </button>
        )}
      />

      <details className="db-rules">
        <summary><Icon name="info" size={16} /> {t('house.drinkHowTitle')}</summary>
        <ul>
          <li>{t('house.drinkHow1')}</li>
          <li>{t('house.drinkHow2')}</li>
          <li>{t('house.drinkHow3')}</li>
          <li>{t('house.drinkHow4')}</li>
        </ul>
      </details>

      {err && <div className="pos-sale-err">{err}</div>}
      {editing === 'new' && editor}

      <section className="db-period" aria-label={t('house.drinkPeriod')}>
        <div className="date-filter">
          {DRINK_BACK_PRESETS.map(id => (
            <button key={id} type="button" className={`date-filter-chip${preset === id && !showCal ? ' is-on' : ''}`} onClick={() => pickPreset(id)}>
              {t(`house.drinkPreset.${id}`)}
            </button>
          ))}
          <button type="button" className={`date-filter-chip${preset === 'custom' || showCal ? ' is-on' : ''}`} onClick={() => setShowCal(v => !v)}>
            <Icon name="calendar" size={14} /> {t('house.drinkPreset.custom')}
          </button>
        </div>
        <div className="db-period-label">
          <Icon name="calendar" size={14} /> {periodLabel}
          {salesLoading && <span className="db-muted"> · {t('house.drinkLoading')}</span>}
        </div>
        {showCal && (
          <div className="db-cal">
            <p className="db-muted">{t('house.drinkCalHint')}</p>
            <RangeCalendar presets={false} from={range.from} to={range.to} onChange={(a, b) => a && b && setRange({ from: a, to: b })} />
          </div>
        )}
      </section>

      <div className="admin-kpi-grid db-kpis">
        <PortalKpi icon="sales" label={t('house.drinkSales')} value={fmtYen(board.totals.revenue)} sub={t('house.drinkTicketsSub', { n: board.totals.tickets })} />
        <PortalKpi icon="coins" label={t('house.drinkCommission')} value={fmtYen(board.totals.commission)} sub={t('house.drinkCommissionSub')} />
        <PortalKpi icon="people" label={t('house.drinkPeople')} value={String(board.totals.earners)} sub={t('house.drinkPeopleSub', { n: board.rows.filter(r => r.ativo).length })} />
        <PortalKpi icon="star" label={t('house.drinkBest')} value={best ? best.nome : '—'} sub={best ? fmtYen(best.revenue) : t('house.drinkNoSales')} />
      </div>

      <section className="db-list">
        <div className="db-list-head">
          <span>{t('house.drinkColPerson')}</span>
          <span>{t('house.drinkColTickets')}</span>
          <span>{t('house.drinkColSales')}</span>
          <span>{t('house.drinkColCommission')}</span>
          <span />
        </div>
        {!board.rows.length && (
          <div className="db-empty">
            <Icon name="drinkback" size={28} />
            <p>{t('house.drinkEmpty')}</p>
            {editing !== 'new' && <button type="button" className="btn-primary" onClick={startAdd}>{t('house.drinkAdd')}</button>}
          </div>
        )}
        {[...activeRows, ...(showOff ? offRows : [])].map(agent => {
          const isOpen = open === agent.id
          const notes = visibleNotes(agent.notas)
          const share = board.totals.revenue ? Math.round(agent.revenue / board.totals.revenue * 100) : 0
          if (editing === agent.id) return <div key={agent.id}>{editor}</div>
          return (
            <article key={agent.id} className={`db-row${agent.ativo ? '' : ' is-off'}${isOpen ? ' is-open' : ''}`}>
              <button type="button" className="db-row-main" onClick={() => setOpen(isOpen ? '' : agent.id)} aria-expanded={isOpen}>
                <span className="db-person">
                  <span className="db-avatar" aria-hidden="true">{String(agent.nome || '?').trim().charAt(0).toUpperCase()}</span>
                  <span>
                    <strong>{agent.nome}</strong>
                    <small>
                      {[agent.regiao, `${agent.comissao_pct || 0}%`, !agent.ativo && t('house.drinkIsOff')].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                </span>
                <span className="db-num" data-label={t('house.drinkColTickets')}>{agent.tickets}</span>
                <span className="db-num" data-label={t('house.drinkColSales')}>
                  {fmtYen(agent.revenue)}
                  {share > 0 && <i className="db-bar"><b style={{ width: `${share}%` }} /></i>}
                </span>
                <span className="db-num is-strong" data-label={t('house.drinkColCommission')}>{fmtYen(agent.commission)}</span>
                <Icon name="down" size={16} className="db-chev" />
              </button>
              {isOpen && (
                <div className="db-detail">
                  {notes && <p className="db-muted">{notes}</p>}
                  {agent.days.length ? (
                    <table className="db-days">
                      <thead>
                        <tr><th>{t('house.drinkColDay')}</th><th>{t('house.drinkColTickets')}</th><th>{t('house.drinkColSales')}</th><th>{t('house.drinkColCommission')}</th></tr>
                      </thead>
                      <tbody>
                        {agent.days.map(d => (
                          <tr key={d.day}>
                            <td>{fmtDay(d.day, lang)}</td>
                            <td>{d.tickets}</td>
                            <td>{fmtYen(d.revenue)}</td>
                            <td>{fmtYen(d.commission)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="db-muted">{t('house.drinkNoSalesPeriod')}</p>}
                  <div className="db-detail-actions">
                    <button type="button" className="db-ghost" onClick={() => startEdit(agent)}>
                      <Icon name="edit" size={14} /> {t('house.drinkEdit')}
                    </button>
                    <button type="button" className="db-ghost" onClick={() => toggleAgent(agent)}>
                      {agent.ativo ? t('house.drinkOff') : t('house.drinkOn')}
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
        {offRows.length > 0 && (
          <button type="button" className="db-show-off" onClick={() => setShowOff(v => !v)}>
            {showOff ? t('house.drinkHideOff') : t('house.drinkShowOff', { n: offRows.length })}
          </button>
        )}
      </section>
    </div>
  )
}
