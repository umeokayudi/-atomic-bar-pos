import { useEffect, useState } from 'react'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { fetchHqSnapshot } from '../lib/hqSnapshot'
import { buildGoalProgress } from '../lib/barGoals'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'

const MODES = ['noite', 'hora', 'semana', 'turno', 'lucro']

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

function Gauge({ pct }) {
  const shown = pct == null ? 0 : pct
  const capped = Math.max(0, Math.min(shown, 100))
  const r = 68
  const c = 2 * Math.PI * r
  const dash = (capped / 100) * c
  const color = shown >= 100 ? '#34c759' : shown >= 70 ? '#c19c56' : '#ff9f0a'
  return (
    <div className="goal-gauge-wrap">
      <svg viewBox="0 0 180 180" className="goal-gauge">
        <circle cx="90" cy="90" r={r} stroke="rgba(255,255,255,0.12)" strokeWidth="14" fill="none" />
        <circle
          cx="90" cy="90" r={r} stroke={color} strokeWidth="14" fill="none"
          strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round" transform="rotate(-90 90 90)"
        />
      </svg>
      <div className="goal-gauge-num">{pct == null ? '—' : `${shown}%`}</div>
    </div>
  )
}

function Bars({ rows, goalKey = 'goal', labelKey = 'label' }) {
  const max = Math.max(1, ...rows.map(r => Math.max(r.sales || 0, r[goalKey] || 0)))
  const w = 720
  const h = 168
  const pad = 18
  const n = Math.max(rows.length, 1)
  const bw = (w - pad * 2) / n
  const y = v => h - 22 - (v / max) * (h - 40)
  const goal = rows.find(r => r[goalKey] > 0)?.[goalKey] || 0
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="goal-chart" role="img">
      {goal > 0 && <line x1={pad} x2={w - pad} y1={y(goal)} y2={y(goal)} stroke="#c19c56" strokeDasharray="5 4" strokeWidth="2" />}
      {rows.map((r, i) => {
        const top = y(r.sales || 0)
        const height = Math.max(0, h - 22 - top)
        const hit = goal > 0 && r.sales >= goal
        return (
          <g key={r.date || r.hour || i}>
            <rect x={pad + i * bw + 6} y={top} width={Math.max(8, bw - 12)} height={height} rx="5" fill={hit ? '#34c759' : '#8eb7ff'} />
            <text x={pad + i * bw + bw / 2} y={h - 6} textAnchor="middle" fill="rgba(255,255,255,0.72)" fontSize="11">
              {r[labelKey] || String(r.date || '').slice(8)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default function BarGoalsTab({ bar }) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('noite')
  const [pack, setPack] = useState(null)
  const [form, setForm] = useState(null)

  async function load() {
    const [teamRes, hq] = await Promise.all([
      staffFetch('/api/bar-staff').then(r => r.json()),
      fetchHqSnapshot().catch(() => null),
    ])
    if (teamRes.error) throw new Error(errText(teamRes.error))
    const staff = teamRes.staff || []
    const extra = (teamRes.people || []).filter(p => p?.id && !staff.some(s => s.id === p.id))
    const people = [...staff, ...extra].map(p => ({
      id: p.id,
      nome: p.nome || '',
      drink_back: !!p.drink_back,
    }))
    const goals = teamRes.goals || {}
    const progress = buildGoalProgress({
      tickets: hq?.pos?.tickets || [],
      hq,
      registry: teamRes.registry || [],
      goals,
      people,
    })
    setPack(progress)
    setForm({
      noite: goals.noite || '',
      hora: goals.hora || '',
      semana: goals.semana || '',
      turno: goals.turno || '',
      lucro: goals.lucro || '',
      abre: goals.abre ?? 20,
      fecha: goals.fecha ?? 5,
      corta: goals.corta ?? 0,
      pessoas: people.filter(p => p.drink_back).map(p => {
        const saved = (goals.pessoas || []).find(x => x.id === p.id) || {}
        return { id: p.id, nome: p.nome, noite: saved.noite || '', semana: saved.semana || '' }
      }),
    })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
      .catch(e => { if (!cancelled) setErr(errText(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bar?.id])

  async function save() {
    setBusy(true)
    setErr('')
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveGoals', ...form }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error))
    else {
      setOpen(false)
      await load()
    }
    setBusy(false)
  }

  if (loading) return <Spinner />
  const p = pack || buildGoalProgress({})
  const hero = mode === 'hora' ? p.hora : mode === 'semana' ? p.semana : mode === 'lucro' ? p.lucro : p.noite
  const heroPct = mode === 'turno' ? null : hero.pct
  const heroSales = mode === 'lucro' ? p.lucro.profit : mode === 'turno' ? null : hero.sales
  const heroGoal = mode === 'lucro' ? p.lucro.goal : mode === 'turno' ? p.turnos[0]?.goal : hero.goal

  return (
    <div className="fade-in goal-page">
      <h1>{t('portal.goals.title')}</h1>
      <p className="house-lead">{t('portal.goals.lead')}</p>
      {err && <div className="pos-sale-err">{asReactText(err)}</div>}

      <div className="goal-modes">
        {MODES.map(id => (
          <button key={id} type="button" className={mode === id ? 'is-on' : ''} onClick={() => setMode(id)}>
            {t(`portal.goals.${id === 'noite' ? 'night' : id === 'hora' ? 'hour' : id === 'semana' ? 'week' : id === 'turno' ? 'shift' : 'profit'}`)}
          </button>
        ))}
      </div>

      <section className="goal-hero">
        {mode !== 'turno' && <Gauge pct={heroPct} />}
        <div className="goal-hero-copy">
          {mode !== 'turno' && (
            <>
              <div className="goal-hero-kicker">{heroPct == null ? t('portal.goals.noGoal') : t('portal.goals.hit', { pct: heroPct })}</div>
              <div className="goal-hero-value">{money(heroSales)}</div>
              <div className="goal-hero-goal">{heroGoal ? `${t('portal.goals.ofGoal')} ${money(heroGoal)}` : t('portal.goals.noGoal')}</div>
            </>
          )}
          {mode === 'hora' && <div className="goal-hero-goal">{t('portal.goals.thisHour')} · {String(p.hora.hour).padStart(2, '0')}:00</div>}
          {mode === 'lucro' && (
            <div className="goal-hero-goal">
              {p.lucro.pace > 0 && p.lucro.profit >= p.lucro.pace && t('portal.goals.ahead')}
              {p.lucro.pace > 0 && p.lucro.profit < p.lucro.pace && t('portal.goals.behind', { amount: money(p.lucro.pace) })}
              {p.lucro.gap > 0 && ` · ${t('portal.goals.gap', { amount: money(p.lucro.gap) })}`}
            </div>
          )}
        </div>
        {mode === 'turno' && (
          <div className="goal-shifts">
            {p.turnos.map(s => (
              <div key={s.id}>
                <Gauge pct={s.pct} />
                <strong>{t(s.id === 1 ? 'portal.goals.shift1' : 'portal.goals.shift2')}</strong>
                <em>{money(s.sales)}{s.goal ? ` / ${money(s.goal)}` : ''}</em>
              </div>
            ))}
          </div>
        )}
      </section>

      {mode === 'hora' && <section className="goal-hero goal-chart-card"><Bars rows={p.hora.series} labelKey="label" /></section>}
      {mode === 'semana' && <section className="goal-hero goal-chart-card"><Bars rows={p.semana.days.map(d => ({ ...d, label: d.date.slice(8) }))} labelKey="label" /></section>}
      {mode === 'noite' && <section className="goal-hero goal-chart-card"><Bars rows={p.semana.days.map(d => ({ ...d, label: d.date.slice(8) }))} labelKey="label" /></section>}
      {mode === 'lucro' && (
        <section className="goal-note">
          <div>{t('portal.goals.nightProfit')}: {money(p.lucro.nightProfit)}{p.lucro.nightGoal ? ` · ${p.lucro.nightPct ?? '—'}%` : ''}</div>
          <p>{t('portal.goals.costNote')}</p>
        </section>
      )}

      <section className="house-block">
        <h2>{t('portal.goals.people')}</h2>
        <p>{t('portal.goals.peopleLead')}</p>
        {!p.pessoas.length && <div className="house-empty">{t('portal.goals.noPeople')}</div>}
        {p.pessoas.map(person => (
          <div key={person.id} className="goal-person">
            <div className="goal-person-name">
              <strong>{person.nome}</strong>
              <em>{t('portal.goals.sales')} {money(person.noite)} · {t('portal.goals.week')} {money(person.semana)}</em>
            </div>
            <div className="goal-person-bars">
              <Meter label={t('portal.goals.night')} pct={person.noitePct} />
              <Meter label={t('portal.goals.week')} pct={person.semanaPct} />
            </div>
          </div>
        ))}
      </section>

      <button type="button" className="btn-primary" onClick={() => setOpen(v => !v)}>{open ? t('portal.goals.hide') : t('portal.goals.set')}</button>
      {open && form && (
        <div className="house-editor goal-form">
          <label>{t('portal.goals.nightGoal')}<input type="number" min="0" value={form.noite} onChange={e => setForm({ ...form, noite: e.target.value })} /></label>
          <label>{t('portal.goals.hourGoal')}<input type="number" min="0" value={form.hora} onChange={e => setForm({ ...form, hora: e.target.value })} /></label>
          <label>{t('portal.goals.weekGoal')}<input type="number" min="0" value={form.semana} onChange={e => setForm({ ...form, semana: e.target.value })} /></label>
          <label>{t('portal.goals.shiftGoal')}<input type="number" min="0" value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })} /></label>
          <label className="house-span">{t('portal.goals.profitGoal')}<input type="number" min="0" value={form.lucro} onChange={e => setForm({ ...form, lucro: e.target.value })} /></label>
          <label>{t('portal.goals.open')}<input type="number" min="0" max="23" value={form.abre} onChange={e => setForm({ ...form, abre: e.target.value })} /></label>
          <label>{t('portal.goals.split')}<input type="number" min="0" max="23" value={form.corta} onChange={e => setForm({ ...form, corta: e.target.value })} /></label>
          <label>{t('portal.goals.close')}<input type="number" min="0" max="23" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} /></label>
          {form.pessoas.map((person, i) => (
            <div key={person.id} className="house-span goal-person-edit">
              <strong>{person.nome}</strong>
              <label>{t('portal.goals.personNight')}<input type="number" min="0" value={person.noite} onChange={e => {
                const pessoas = form.pessoas.slice()
                pessoas[i] = { ...person, noite: e.target.value }
                setForm({ ...form, pessoas })
              }} /></label>
              <label>{t('portal.goals.personWeek')}<input type="number" min="0" value={person.semana} onChange={e => {
                const pessoas = form.pessoas.slice()
                pessoas[i] = { ...person, semana: e.target.value }
                setForm({ ...form, pessoas })
              }} /></label>
            </div>
          ))}
          <div className="house-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? t('common.wait') : t('portal.goals.save')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Meter({ label, pct }) {
  const width = pct == null ? 0 : Math.max(0, Math.min(pct, 100))
  return (
    <div className="goal-meter">
      <span>{label}</span>
      <i><b style={{ width: `${width}%` }} className={pct >= 100 ? 'is-hit' : ''} /></i>
      <em>{pct == null ? '—' : `${pct}%`}</em>
    </div>
  )
}
