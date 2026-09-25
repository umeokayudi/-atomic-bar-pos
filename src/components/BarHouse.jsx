import { useEffect, useState } from 'react'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { tokyoMonthKey } from '../lib/tokyo'

const EMPTY_PERSON = { nome: '', salario_hora: '', salario_mes: '', drink_back: false, comissao_pct: '10' }

const REGISTERS = [
  { kind: 'fornecedor', title: 'suppliers', body: 'suppliersBody', fields: ['nome', 'detalhe', 'contato'], detalheLabel: 'supplies' },
  { kind: 'parceiro', title: 'partners', body: 'partnersBody', fields: ['nome', 'detalhe', 'contato'], detalheLabel: 'role' },
  { kind: 'cartao', title: 'card', body: 'cardBody', fields: ['nome', 'pct', 'detalhe'], nomeLabel: 'company', detalheLabel: 'note' },
  { kind: 'energia', title: 'power', body: 'powerBody', fields: ['nome', 'amount', 'detalhe'], nomeLabel: 'company', detalheLabel: 'note' },
  { kind: 'aluguel', title: 'rent', body: 'rentBody', fields: ['nome', 'amount', 'detalhe'], detalheLabel: 'note' },
  { kind: 'outro', title: 'other', body: 'otherBody', fields: ['nome', 'amount', 'recorrente', 'detalhe'], detalheLabel: 'note' },
]

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

function blankRegistry(kind) {
  return { id: '', kind, nome: '', contato: '', detalhe: '', amount: '', pct: '', recorrente: true, month_key: tokyoMonthKey() }
}

function registryLine(row, t) {
  const bits = [row.nome]
  if (row.detalhe) bits.push(row.detalhe)
  if (row.contato) bits.push(row.contato)
  if (+row.pct) bits.push(`${row.pct}%`)
  if (+row.amount) bits.push(fmtYen(row.amount))
  if (row.kind === 'outro') bits.push(row.recorrente === false ? (row.month_key || '') : t('house.repeats'))
  return bits.filter(Boolean).join(' · ')
}

function RegisterBlock({ spec, rows, busy, onSave, onDelete }) {
  const { t } = useI18n()
  const [form, setForm] = useState(null)
  const label = (field) => {
    if (field === 'nome') return t(`house.${spec.nomeLabel || 'name'}`)
    if (field === 'detalhe') return t(`house.${spec.detalheLabel || 'note'}`)
    if (field === 'contato') return t('house.contact')
    if (field === 'pct') return t('house.fee')
    if (field === 'amount') return t('house.monthlyAmount')
    if (field === 'recorrente') return t('house.repeats')
    return field
  }

  return (
    <section className="house-block">
      <h2>{t(`house.${spec.title}`)}</h2>
      <p>{t(`house.${spec.body}`)}</p>
      {!rows.length && <div className="house-empty">{t('house.empty')}</div>}
      {rows.map(row => (
        <div key={row.id} className="house-person">
          <div>{registryLine(row, t)}</div>
          <div className="house-actions">
            <button type="button" className="house-text" onClick={() => setForm({
              id: row.id,
              kind: spec.kind,
              nome: row.nome || '',
              contato: row.contato || '',
              detalhe: row.detalhe || '',
              amount: row.amount ? String(row.amount) : '',
              pct: row.pct ? String(row.pct) : '',
              recorrente: row.recorrente !== false,
              month_key: row.month_key || tokyoMonthKey(),
            })}>{t('house.edit')}</button>
            <button type="button" className="house-text" disabled={busy} onClick={() => onDelete(row.id)}>{t('house.remove')}</button>
          </div>
        </div>
      ))}
      {form ? (
        <div className="house-editor">
          {spec.fields.map(field => (
            field === 'recorrente' ? (
              <label key={field} className="house-check">
                <input type="checkbox" checked={form.recorrente !== false} onChange={e => setForm({ ...form, recorrente: e.target.checked })} />
                {label(field)}
              </label>
            ) : (
              <label key={field}>
                {label(field)}
                <input
                  type={field === 'amount' || field === 'pct' ? 'number' : 'text'}
                  min={field === 'pct' ? '0' : undefined}
                  value={form[field]}
                  onChange={e => setForm({ ...form, [field]: e.target.value })}
                />
              </label>
            )
          ))}
          {spec.kind === 'outro' && form.recorrente === false && (
            <label>{t('house.month')}
              <input type="month" value={form.month_key} onChange={e => setForm({ ...form, month_key: e.target.value })} />
            </label>
          )}
          <div className="house-actions">
            <button type="button" className="btn-primary" disabled={busy || !form.nome.trim()} onClick={() => onSave(form).then(() => setForm(null))}>{t('house.save')}</button>
            <button type="button" className="house-text" onClick={() => setForm(null)}>{t('house.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary house-add" onClick={() => setForm(blankRegistry(spec.kind))}>{t('house.add')}</button>
      )}
    </section>
  )
}

export default function BarHouseTab({ bar, onTab }) {
  const { t } = useI18n()
  const [people, setPeople] = useState([])
  const [registry, setRegistry] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(null)

  async function load() {
    const team = await staffFetch('/api/bar-staff').then(r => r.json())
    if (team.error) throw new Error(errText(team.error))
    const fromStaff = (team.staff || []).map(s => personFrom(s, 'staff'))
    const ids = new Set(fromStaff.map(p => p.id))
    const extra = (team.people || []).filter(p => p?.id && !ids.has(p.id)).map(p => personFrom(p, 'house'))
    setPeople([...fromStaff, ...extra].sort((a, b) => a.nome.localeCompare(b.nome)))
    setRegistry(team.registry || [])
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
      .catch(e => { if (!cancelled) setErr(errText(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bar.id])

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
      ? await staffFetch('/api/bar-staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await staffFetch('/api/bar-staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'savePerson', ...payload }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error, t('team.saveFailed')))
    else {
      setForm(null)
      await load()
    }
    setBusy(false)
  }

  async function removePerson(p) {
    if (p.source !== 'house') return
    setBusy(true)
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deletePerson', id: p.id }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error))
    else await load()
    setBusy(false)
  }

  async function saveRegistry(row) {
    setBusy(true)
    setErr('')
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveRegistry',
        id: row.id || undefined,
        kind: row.kind,
        nome: row.nome.trim(),
        contato: row.contato,
        detalhe: row.detalhe,
        amount: +row.amount || 0,
        pct: +row.pct || 0,
        recorrente: row.recorrente !== false,
        month_key: row.month_key,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(errText(json.error))
      setBusy(false)
      throw new Error(errText(json.error))
    }
    await load()
    setBusy(false)
  }

  async function deleteRegistry(id) {
    setBusy(true)
    setErr('')
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteRegistry', id }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error))
    else await load()
    setBusy(false)
  }

  return (
    <div className="fade-in house-page">
      <h1>{t('house.title')}</h1>
      <p className="house-lead">{t('house.lead')}</p>
      {err && <div className="pos-sale-err">{asReactText(err)}</div>}
      {loading && <Spinner />}

      <section className="house-block">
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
              <button type="button" className="house-text" onClick={() => setForm({
                id: p.id,
                source: p.source,
                nome: p.nome,
                salario_hora: String(p.salario_hora || ''),
                salario_mes: String(p.salario_mes || ''),
                drink_back: p.drink_back,
                comissao_pct: String(p.comissao_pct || 10),
              })}>{t('house.edit')}</button>
              {p.source === 'house' && <button type="button" className="house-text" disabled={busy} onClick={() => removePerson(p)}>{t('house.remove')}</button>}
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
          <button type="button" className="btn-primary house-add" onClick={() => setForm({ ...EMPTY_PERSON, id: '', source: 'house' })}>{t('house.add')}</button>
        )}
        <button type="button" className="house-text" style={{ marginTop: 10 }} onClick={() => onTab?.('pos')}>{t('house.openTill')}</button>
      </section>

      {REGISTERS.map(spec => (
        <RegisterBlock
          key={spec.kind}
          spec={spec}
          rows={registry.filter(r => r.kind === spec.kind)}
          busy={busy}
          onSave={saveRegistry}
          onDelete={deleteRegistry}
        />
      ))}
    </div>
  )
}
