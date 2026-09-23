import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { tokyoMonthKey } from '../lib/tokyo'
import { fetchHqSnapshot, saveBarCost } from '../lib/hqSnapshot'
import { readTicketMeta } from '../lib/nightTicket'

const EMPTY = { nome: '', salario_hora: '', salario_mes: '', drink_back: false, comissao_pct: '10' }

function personFrom(row, source) {
  return {
    id: row.id,
    source,
    nome: row.nome || '',
    salario_hora: +row.salario_hora || 0,
    salario_mes: +row.salario_mes || 0,
    drink_back: !!row.drink_back,
    comissao_pct: +row.comissao_pct || 0,
  }
}

function HouseCosts({ month, overhead, busy, onSave }) {
  const { t } = useI18n()
  const [fixedName, setFixedName] = useState('')
  const [fixedAmount, setFixedAmount] = useState('')
  const [varName, setVarName] = useState('')
  const [varAmount, setVarAmount] = useState('')
  const fixed = overhead?.fixed || []
  const variable = overhead?.variable || []

  async function add(kind, name, amount, clear) {
    const label = String(name || '').trim()
    if (!label) return
    try {
      await onSave({ kind, name: label, amount: +amount || 0, month_key: month })
      clear()
    } catch {
      /* parent shows the error */
    }
  }

  return (
    <div className="house-costs">
      <div className="house-split">
        <div>
          <div className="house-sub">{t('house.fixedTitle')}</div>
          <p>{t('house.fixedBody')}</p>
          {fixed.map(r => (
            <div key={r.id} className="house-line">
              <span>{r.note}</span>
              <span>
                <strong>{fmtYen(r.amount)}</strong>
                <button type="button" className="house-text" disabled={busy} onClick={() => onSave({ action: 'delete', id: r.id, month_key: month })}>{t('house.remove')}</button>
              </span>
            </div>
          ))}
          <div className="house-form">
            <input placeholder={t('house.costName')} value={fixedName} onChange={e => setFixedName(e.target.value)} />
            <input type="number" min="0" step="100" placeholder={t('house.costAmount')} value={fixedAmount} onChange={e => setFixedAmount(e.target.value)} />
            <button type="button" className="btn-primary" disabled={busy} onClick={() => add('fixo', fixedName, fixedAmount, () => { setFixedName(''); setFixedAmount('') })}>{t('house.addCost')}</button>
          </div>
          <div className="house-total">{t('house.fixedTotal')}: {fmtYen(overhead?.fixedTotal || 0)}</div>
        </div>
        <div>
          <div className="house-sub">{t('house.variableTitle')}</div>
          <p>{t('house.variableBody')}</p>
          {variable.map(r => (
            <div key={r.id} className="house-line">
              <span>{r.note}</span>
              <span>
                <strong>{fmtYen(r.amount)}</strong>
                <button type="button" className="house-text" disabled={busy} onClick={() => onSave({ action: 'delete', id: r.id, month_key: month })}>{t('house.remove')}</button>
              </span>
            </div>
          ))}
          <div className="house-form">
            <input placeholder={t('house.costName')} value={varName} onChange={e => setVarName(e.target.value)} />
            <input type="number" min="0" step="100" placeholder={t('house.costAmount')} value={varAmount} onChange={e => setVarAmount(e.target.value)} />
            <button type="button" className="btn-primary" disabled={busy} onClick={() => add('variavel', varName, varAmount, () => { setVarName(''); setVarAmount('') })}>{t('house.addCost')}</button>
          </div>
          <div className="house-total">{t('house.variableTotal')}: {fmtYen(overhead?.variableTotal || 0)}</div>
        </div>
      </div>
    </div>
  )
}

export default function BarHouseTab({ bar, onTab }) {
  const { t } = useI18n()
  const [month, setMonth] = useState(tokyoMonthKey())
  const [overhead, setOverhead] = useState(null)
  const [people, setPeople] = useState([])
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(null)

  async function loadPeople() {
    const team = await staffFetch('/api/bar-staff').then(r => r.json())
    if (team.error) throw new Error(errText(team.error))
    const fromStaff = (team.staff || []).map(s => personFrom(s, 'staff'))
    const ids = new Set(fromStaff.map(p => p.id))
    const extra = (team.people || []).filter(p => p?.id && !ids.has(p.id)).map(p => personFrom(p, 'house'))
    setPeople([...fromStaff, ...extra].sort((a, b) => a.nome.localeCompare(b.nome)))
  }

  async function loadSales() {
    const [salesR, agentsR] = await Promise.all([
      supabase.from('pos_vendas').select('id,data,obs,drink_back_agent_id,criado_em').eq('bar_id', bar.id).order('criado_em', { ascending: false }).limit(40),
      supabase.from('drink_back_agents').select('id,nome,comissao_pct').eq('bar_id', bar.id),
    ])
    const byId = Object.fromEntries((agentsR.data || []).map(a => [a.id, a]))
    setSales((salesR.data || []).map(s => {
      const meta = readTicketMeta(s.obs)
      const agent = byId[s.drink_back_agent_id]
      return { id: s.id, data: s.data, nome: agent?.nome || '', amount: meta.commission, pct: agent?.comissao_pct }
    }).filter(r => r.amount != null))
  }

  async function loadCosts(mes = month) {
    try {
      const snap = await fetchHqSnapshot(mes, { fresh: true })
      setOverhead(snap.overhead || { fixed: [], variable: [], fixedTotal: 0, variableTotal: 0 })
    } catch (e) {
      setErr(errText(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([loadPeople(), loadSales(), loadCosts(month)])
      .catch(e => { if (!cancelled) setErr(errText(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bar.id, month])

  function openNew() {
    setForm({ ...EMPTY, id: '', source: 'house' })
  }

  function openEdit(p) {
    setForm({
      id: p.id,
      source: p.source,
      nome: p.nome,
      salario_hora: String(p.salario_hora || ''),
      salario_mes: String(p.salario_mes || ''),
      drink_back: p.drink_back,
      comissao_pct: String(p.comissao_pct || 10),
    })
  }

  async function savePerson() {
    if (!form?.nome.trim()) return
    setBusy(true)
    setErr('')
    const payload = {
      id: form.id || undefined,
      nome: form.nome.trim(),
      salario_hora: +form.salario_hora || 0,
      salario_mes: +form.salario_mes || 0,
      drink_back: !!form.drink_back,
      comissao_pct: form.drink_back ? (+form.comissao_pct || 0) : 0,
    }
    const res = form.source === 'staff' && form.id
      ? await staffFetch('/api/bar-staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      : await staffFetch('/api/bar-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'savePerson', ...payload }),
      })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error, t('team.saveFailed')))
    else {
      setForm(null)
      await loadPeople()
    }
    setBusy(false)
  }

  async function removePerson(p) {
    if (p.source !== 'house') return
    setBusy(true)
    setErr('')
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deletePerson', id: p.id }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error))
    else await loadPeople()
    setBusy(false)
  }

  const casts = people.filter(p => p.drink_back)

  return (
    <div className="fade-in house-page">
      <h1>{t('house.title')}</h1>
      <p className="house-lead">{t('house.lead')}</p>
      {err && <div className="pos-sale-err">{asReactText(err)}</div>}
      {loading && <Spinner />}

      <section className="house-block">
        <div className="house-kicker">1</div>
        <h2>{t('house.staffTitle')}</h2>
        <p>{t('house.staffBody')}</p>
        {!people.length && !loading && <div className="house-empty">{t('house.empty')}</div>}
        {people.map(p => (
          <div key={p.id} className="house-person">
            <div>
              <strong>{p.nome}</strong>
              <div className="house-meta">
                {fmtYen(p.salario_hora)}/h
                {p.salario_mes > 0 ? ` · ${fmtYen(p.salario_mes)}${t('house.perMonth')}` : ''}
                {' · '}
                {p.drink_back ? `${t('house.withDrink')} ${p.comissao_pct}%` : t('house.noDrink')}
              </div>
            </div>
            <div className="house-actions">
              <button type="button" className="house-text" onClick={() => openEdit(p)}>{t('house.edit')}</button>
              {p.source === 'house' && (
                <button type="button" className="house-text" disabled={busy} onClick={() => removePerson(p)}>{t('house.remove')}</button>
              )}
            </div>
          </div>
        ))}
        {form ? (
          <div className="house-editor">
            <label>{t('house.name')}<input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
            <label>{t('house.hourly')}<input type="number" min="0" value={form.salario_hora} onChange={e => setForm({ ...form, salario_hora: e.target.value })} /></label>
            <label>{t('house.monthly')}<input type="number" min="0" value={form.salario_mes} onChange={e => setForm({ ...form, salario_mes: e.target.value })} /></label>
            <label className="house-check">
              <input type="checkbox" checked={!!form.drink_back} onChange={e => setForm({ ...form, drink_back: e.target.checked })} />
              {t('house.drinkYes')}
            </label>
            {form.drink_back && (
              <label>{t('house.commission')}<input type="number" min="0" max="100" value={form.comissao_pct} onChange={e => setForm({ ...form, comissao_pct: e.target.value })} /></label>
            )}
            <div className="house-actions">
              <button type="button" className="btn-primary" disabled={busy} onClick={savePerson}>{busy ? t('common.wait') : t('house.save')}</button>
              <button type="button" className="house-text" onClick={() => setForm(null)}>{t('house.cancel')}</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-primary house-add" onClick={openNew}>{t('house.add')}</button>
        )}
      </section>

      <section className="house-block">
        <div className="house-kicker">2</div>
        <h2>{t('house.bottleTitle')}</h2>
        <p>{t('house.bottleBody')}</p>
        {casts.length ? (
          <div className="house-casts">
            {casts.map(p => (
              <span key={p.id} className="house-cast">{p.nome} · {p.comissao_pct}%</span>
            ))}
          </div>
        ) : (
          <div className="house-empty">{t('house.noDrink')}</div>
        )}
        <button type="button" className="btn-primary" onClick={() => onTab?.('pos')}>{t('house.openTill')}</button>
        <div className="house-sales">
          {!sales.length && <div className="house-empty">{t('house.noCommission')}</div>}
          {sales.map(r => (
            <div key={r.id} className="house-line">
              <span>{r.data} · {r.nome || t('house.cast')}{r.pct != null ? ` · ${r.pct}%` : ''}</span>
              <strong>{fmtYen(r.amount)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="house-block">
        <div className="house-kicker">3</div>
        <h2>{t('house.costsTitle')}</h2>
        <p>{t('house.costsBody')}</p>
        <label className="house-month">{t('house.month')}
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </label>
        <HouseCosts
          month={month}
          overhead={overhead}
          busy={busy}
          onSave={async (cost) => {
            setBusy(true)
            setErr('')
            try {
              const snap = await saveBarCost({ ...cost, month_key: cost.month_key || month })
              setOverhead(snap.overhead || { fixed: [], variable: [], fixedTotal: 0, variableTotal: 0 })
            } catch (e) {
              setErr(errText(e))
              setBusy(false)
              throw e
            }
            setBusy(false)
          }}
        />
      </section>
    </div>
  )
}
