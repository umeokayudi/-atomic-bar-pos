import { useMemo, useEffect, useState } from 'react'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { tokyoMonthKey } from '../lib/tokyo'

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const LANG_KEYS = ['ja', 'pt', 'en', 'zh', 'ko', 'es']
const CARGO_KEYS = ['cast', 'bar', 'gerente', 'caixa', 'seguranca', 'limpeza', 'cozinha', 'promotor']
const ESTILO_KEYS = ['cute', 'cool', 'sexy', 'elegante', 'natural', 'gal', 'sister']

const EMPTY_PERSON = {
  nome: '', salario_hora: '', salario_mes: '', drink_back: false, comissao_pct: '10',
  cargo: '', dias: [], idiomas: [], estilo: '', contato: '', notas: '',
}

const REGISTERS = [
  { kind: 'fornecedor', title: 'suppliers', body: 'suppliersBody', fields: ['nome', 'detalhe', 'contato', 'email', 'notas'], detalheLabel: 'supplies', profile: ['cargo', 'dias', 'idiomas'], cargoLabel: 'category', daysLabel: 'deliveryDays' },
  { kind: 'parceiro', title: 'partners', body: 'partnersBody', fields: ['nome', 'contato', 'email', 'notas'], profile: ['cargo', 'dias', 'idiomas', 'estilo'], daysLabel: 'workDays' },
  { kind: 'cartao', title: 'card', body: 'cardBody', fields: ['nome', 'cargo', 'contato', 'email', 'pct', 'notas'], nomeLabel: 'company', cargoLabel: 'contactPerson', profile: [] },
  { kind: 'energia', title: 'power', body: 'powerBody', fields: ['nome', 'cargo', 'contato', 'email', 'amount', 'notas'], nomeLabel: 'company', cargoLabel: 'contactPerson', profile: [] },
  { kind: 'aluguel', title: 'rent', body: 'rentBody', fields: ['nome', 'cargo', 'contato', 'email', 'endereco', 'amount', 'notas'], nomeLabel: 'agency', cargoLabel: 'contactPerson', profile: [] },
  { kind: 'fixo', title: 'fixedCosts', body: 'fixedBody', fields: ['nome', 'amount', 'contato', 'notas'], profile: [] },
  { kind: 'variavel', title: 'variableCosts', body: 'variableBody', fields: ['nome', 'amount', 'contato', 'notas'], profile: [], month: true },
]

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (!value) return []
  return String(value).split(',').map(v => v.trim()).filter(Boolean)
}

function named(t, group, value) {
  if (!value) return ''
  const key = `house.${group}.${value}`
  const label = t(key)
  return label === key ? value : label
}

function personFrom(row, source) {
  return {
    id: row.id,
    source,
    nome: row.nome || '',
    salario_hora: +row.salario_hora || 0,
    salario_mes: +row.salario_mes || 0,
    drink_back: !!row.drink_back,
    comissao_pct: +row.comissao_pct || 0,
    cargo: row.cargo || '',
    dias: asList(row.dias),
    idiomas: asList(row.idiomas),
    estilo: row.estilo || '',
    contato: row.contato || '',
    notas: row.notas || '',
  }
}

function blankRegistry(kind) {
  return {
    id: '', kind, nome: '', contato: '', email: '', endereco: '', detalhe: '', amount: '', pct: '',
    recorrente: kind !== 'variavel', month_key: tokyoMonthKey(),
    cargo: '', dias: [], idiomas: [], estilo: '', notas: '',
  }
}

function haystack(row, t) {
  return [
    row.nome, row.cargo, row.estilo, row.detalhe, row.contato, row.email, row.endereco, row.notas,
    named(t, 'cargo', row.cargo), named(t, 'estilo', row.estilo),
    ...asList(row.dias).map(d => named(t, 'day', d)),
    ...asList(row.idiomas).map(d => named(t, 'lang', d)),
  ].filter(Boolean).join(' ').toLowerCase()
}

function useListFilter(rows) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [picks, setPicks] = useState({ cargo: '', dia: '', idioma: '', estilo: '' })
  const filtered = useMemo(() => rows.filter(row => {
    if (q && !haystack(row, t).includes(q.trim().toLowerCase())) return false
    if (picks.cargo && row.cargo !== picks.cargo) return false
    if (picks.dia && !asList(row.dias).includes(picks.dia)) return false
    if (picks.idioma && !asList(row.idiomas).includes(picks.idioma)) return false
    if (picks.estilo && row.estilo !== picks.estilo) return false
    return true
  }), [rows, q, picks, t])
  const active = !!(q || picks.cargo || picks.dia || picks.idioma || picks.estilo)
  return { q, setQ, picks, setPicks, filtered, active, clear: () => { setQ(''); setPicks({ cargo: '', dia: '', idioma: '', estilo: '' }) } }
}

function FilterBar({ rows, filter, dims, dayLabel }) {
  const { t } = useI18n()
  const options = (key) => [...new Set(rows.flatMap(row => {
    if (key === 'dia') return asList(row.dias)
    if (key === 'idioma') return asList(row.idiomas)
    return row[key] ? [row[key]] : []
  }))].filter(Boolean)
  const groups = [
    dims.includes('cargo') && { pick: 'cargo', group: 'cargo', label: t('house.job') },
    dims.includes('dia') && { pick: 'dia', group: 'day', label: dayLabel || t('house.workDays') },
    dims.includes('idioma') && { pick: 'idioma', group: 'lang', label: t('house.languages') },
    dims.includes('estilo') && { pick: 'estilo', group: 'estilo', label: t('house.style') },
  ].filter(Boolean)
  return (
    <div className="house-filters">
      <input className="house-search" value={filter.q} placeholder={t('house.search')} onChange={e => filter.setQ(e.target.value)} />
      {groups.map(g => {
        const opts = options(g.pick)
        if (!opts.length) return null
        return (
          <div key={g.pick} className="house-chips" aria-label={g.label}>
            {opts.map(value => (
              <button
                key={value}
                type="button"
                className={filter.picks[g.pick] === value ? 'house-chip is-on' : 'house-chip'}
                onClick={() => filter.setPicks(prev => ({ ...prev, [g.pick]: prev[g.pick] === value ? '' : value }))}
              >
                {named(t, g.group, value)}
              </button>
            ))}
          </div>
        )
      })}
      <div className="house-count">
        {t('house.showing', { n: filter.filtered.length, total: rows.length })}
        {filter.active && <button type="button" className="house-text" onClick={filter.clear}>{t('house.clear')}</button>}
      </div>
    </div>
  )
}

function Tags({ row }) {
  const { t } = useI18n()
  const tags = [
    row.cargo && { key: 'cargo', text: named(t, 'cargo', row.cargo), strong: true },
    row.estilo && { key: 'estilo', text: named(t, 'estilo', row.estilo), strong: true },
    ...asList(row.dias).map(d => ({ key: `d-${d}`, text: named(t, 'day', d) })),
    ...asList(row.idiomas).map(d => ({ key: `l-${d}`, text: named(t, 'lang', d) })),
    row.detalhe && { key: 'detalhe', text: row.detalhe },
    row.contato && { key: 'contato', text: row.contato },
    row.email && { key: 'email', text: row.email },
    row.endereco && { key: 'endereco', text: row.endereco },
  ].filter(Boolean)
  if (!tags.length && !row.notas) return null
  return (
    <>
      {!!tags.length && (
        <div className="house-tags">
          {tags.map(tag => <span key={tag.key} className={tag.strong ? 'house-tag is-strong' : 'house-tag'}>{tag.text}</span>)}
        </div>
      )}
      {row.notas && <div className="house-meta">{row.notas}</div>}
    </>
  )
}

function ChipPick({ label, group, keys, value, multi, onChange, custom }) {
  const { t } = useI18n()
  const selected = multi ? asList(value) : [value].filter(Boolean)
  function toggle(key) {
    if (!multi) {
      onChange(value === key ? '' : key)
      return
    }
    const next = selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]
    if (group === 'lang') onChange(LANG_KEYS.filter(k => next.includes(k)))
    else if (group === 'day') onChange(DAY_KEYS.filter(k => next.includes(k)))
    else onChange(next)
  }
  const typed = !multi && value && !keys.includes(value) ? value : ''
  return (
    <div className="house-pick">
      <span>{label}</span>
      <div className="house-chips">
        {keys.map(key => (
          <button key={key} type="button" className={selected.includes(key) ? 'house-chip is-on' : 'house-chip'} onClick={() => toggle(key)}>
            {named(t, group, key)}
          </button>
        ))}
      </div>
      {custom && (
        <input
          value={typed}
          placeholder={t('house.custom')}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

function ProfileFields({ form, setForm, profile, cargoLabel, daysLabel }) {
  const { t } = useI18n()
  if (!profile?.length) return null
  return (
    <>
      {profile.includes('cargo') && (
        <ChipPick label={t(`house.${cargoLabel || 'job'}`)} group="cargo" keys={CARGO_KEYS} value={form.cargo} onChange={cargo => setForm({ ...form, cargo })} custom />
      )}
      {profile.includes('dias') && (
        <ChipPick label={t(`house.${daysLabel || 'workDays'}`)} group="day" keys={DAY_KEYS} value={form.dias} multi onChange={dias => setForm({ ...form, dias })} />
      )}
      {profile.includes('idiomas') && (
        <ChipPick label={t('house.languages')} group="lang" keys={LANG_KEYS} value={form.idiomas} multi onChange={idiomas => setForm({ ...form, idiomas })} />
      )}
      {profile.includes('estilo') && (
        <ChipPick label={t('house.style')} group="estilo" keys={ESTILO_KEYS} value={form.estilo} onChange={estilo => setForm({ ...form, estilo })} custom />
      )}
    </>
  )
}

function RegisterBlock({ spec, rows, busy, onSave, onDelete }) {
  const { t } = useI18n()
  const [form, setForm] = useState(null)
  const filter = useListFilter(rows)
  const label = (field) => {
    if (field === 'nome') return t(`house.${spec.nomeLabel || 'name'}`)
    if (field === 'detalhe') return t(`house.${spec.detalheLabel || 'note'}`)
    if (field === 'contato') return t('house.phone')
    if (field === 'cargo') return t(`house.${spec.cargoLabel || 'job'}`)
    if (field === 'email') return t('house.email')
    if (field === 'endereco') return t('house.address')
    if (field === 'notas') return t('house.notes')
    if (field === 'pct') return t('house.fee')
    if (field === 'amount') return t('house.monthlyAmount')
    if (field === 'recorrente') return t('house.repeats')
    return field
  }
  const dims = (spec.profile || []).map(p => (p === 'dias' ? 'dia' : p === 'idiomas' ? 'idioma' : p))

  return (
    <section className="house-block">
      <h1>{t(`house.${spec.title}`)}</h1>
      <p className="house-lead">{t(`house.${spec.body}`)}</p>
      <FilterBar rows={rows} filter={filter} dims={dims} dayLabel={t(`house.${spec.daysLabel || 'workDays'}`)} />
      {!rows.length && <div className="house-empty">{t('house.empty')}</div>}
      {!!rows.length && !filter.filtered.length && <div className="house-empty">{t('house.filterEmpty')}</div>}
      {filter.filtered.map(row => (
        <div key={row.id} className="house-card">
          <div>
            <strong>{row.nome}</strong>
            <div className="house-meta">
              {+row.pct ? `${row.pct}%` : ''}
              {+row.pct && +row.amount ? ' · ' : ''}
              {+row.amount ? fmtYen(row.amount) : ''}
              {(row.kind === 'fixo' || (row.kind === 'outro' && row.recorrente !== false)) ? `${(+row.pct || +row.amount) ? ' · ' : ''}${t('house.repeats')}` : ''}
              {(row.kind === 'variavel' || (row.kind === 'outro' && row.recorrente === false)) ? `${(+row.pct || +row.amount) ? ' · ' : ''}${row.month_key || ''}` : ''}
            </div>
            <Tags row={row} />
          </div>
          <div className="house-actions">
            <button type="button" className="house-text" onClick={() => setForm({
              id: row.id,
              kind: spec.kind,
              nome: row.nome || '',
              contato: row.contato || '',
              email: row.email || '',
              endereco: row.endereco || '',
              detalhe: row.detalhe || '',
              amount: row.amount ? String(row.amount) : '',
              pct: row.pct ? String(row.pct) : '',
              recorrente: row.recorrente !== false,
              month_key: row.month_key || tokyoMonthKey(),
              cargo: row.cargo || '',
              dias: asList(row.dias),
              idiomas: asList(row.idiomas),
              estilo: row.estilo || '',
              notas: row.notas || '',
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
              <label key={field} className={field === 'notas' || field === 'detalhe' || field === 'endereco' ? 'house-span' : ''}>
                {label(field)}
                <input
                  type={field === 'amount' || field === 'pct' ? 'number' : 'text'}
                  min={field === 'pct' ? '0' : undefined}
                  value={form[field] || ''}
                  onChange={e => setForm({ ...form, [field]: e.target.value })}
                />
              </label>
            )
          ))}
          <ProfileFields form={form} setForm={setForm} profile={spec.profile} cargoLabel={spec.cargoLabel} daysLabel={spec.daysLabel} />
          {spec.month && (
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

function StaffBlock({ people, loading, busy, form, setForm, onSave, onRemove, onTill }) {
  const { t } = useI18n()
  const filter = useListFilter(people)
  return (
    <section className="house-block">
      <h1>{t('house.staffTitle')}</h1>
      <p className="house-lead">{t('house.staffBody')}</p>
      <FilterBar rows={people} filter={filter} dims={['cargo', 'dia', 'idioma', 'estilo']} />
      {!people.length && !loading && <div className="house-empty">{t('house.empty')}</div>}
      {!!people.length && !filter.filtered.length && <div className="house-empty">{t('house.filterEmpty')}</div>}
      {filter.filtered.map(p => (
        <div key={p.id} className="house-card">
          <div>
            <strong>{p.nome}</strong>
            <div className="house-meta">
              {fmtYen(p.salario_hora)}/h
              {p.salario_mes > 0 ? ` · ${fmtYen(p.salario_mes)}${t('house.perMonth')}` : ''}
              {' · '}
              {p.drink_back ? `${t('house.withDrink')} ${p.comissao_pct}%` : t('house.noDrink')}
            </div>
            <Tags row={p} />
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
              cargo: p.cargo || '',
              dias: asList(p.dias),
              idiomas: asList(p.idiomas),
              estilo: p.estilo || '',
              contato: p.contato || '',
              notas: p.notas || '',
            })}>{t('house.edit')}</button>
            {p.source === 'house' && <button type="button" className="house-text" disabled={busy} onClick={() => onRemove(p)}>{t('house.remove')}</button>}
          </div>
        </div>
      ))}
      {form ? (
        <div className="house-editor">
          <label>{t('house.name')}<input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
          <label>{t('house.phone')}<input value={form.contato || ''} onChange={e => setForm({ ...form, contato: e.target.value })} /></label>
          <ProfileFields form={form} setForm={setForm} profile={['cargo', 'dias', 'idiomas', 'estilo']} />
          <label className="house-span">{t('house.notes')}<input value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} /></label>
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
            <button type="button" className="btn-primary" disabled={busy || !form.nome.trim()} onClick={onSave}>{busy ? t('common.wait') : t('house.save')}</button>
            <button type="button" className="house-text" onClick={() => setForm(null)}>{t('house.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary house-add" onClick={() => setForm({ ...EMPTY_PERSON, id: '', source: 'house' })}>{t('house.add')}</button>
      )}
      <button type="button" className="house-text" style={{ marginTop: 10 }} onClick={onTill}>{t('house.openTill')}</button>
    </section>
  )
}

export default function BarHouseTab({ bar, onTab, section = 'staff' }) {
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

  function profilePayload(source) {
    return {
      cargo: source.cargo || '',
      dias: asList(source.dias),
      idiomas: asList(source.idiomas),
      estilo: source.estilo || '',
      contato: source.contato || '',
      email: source.email || '',
      endereco: source.endereco || '',
      notas: source.notas || '',
    }
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
      ...profilePayload(form),
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
        recorrente: row.kind === 'variavel' ? false : row.kind === 'fixo' ? true : row.recorrente !== false,
        month_key: row.month_key,
        ...profilePayload(row),
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

  const spec = REGISTERS.find(r => r.kind === section)

  return (
    <div className="fade-in house-page">
      {err && <div className="pos-sale-err">{asReactText(err)}</div>}
      {loading && <Spinner />}
      {section === 'staff' && (
        <StaffBlock
          people={people}
          loading={loading}
          busy={busy}
          form={form}
          setForm={setForm}
          onSave={savePerson}
          onRemove={removePerson}
          onTill={() => onTab?.('pos')}
        />
      )}
      {spec && (
        <RegisterBlock
          spec={spec}
          rows={registry.filter(r => (
            spec.kind === 'fixo' ? (r.kind === 'fixo' || (r.kind === 'outro' && r.recorrente !== false))
            : spec.kind === 'variavel' ? (r.kind === 'variavel' || (r.kind === 'outro' && r.recorrente === false))
            : r.kind === spec.kind
          ))}
          busy={busy}
          onSave={saveRegistry}
          onDelete={deleteRegistry}
        />
      )}
    </div>
  )
}
