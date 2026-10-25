import { useMemo, useState } from 'react'
import { fmtYen } from './utils'
import { useI18n } from '../lib/i18n'
import { tokyoDateKey } from '../lib/tokyo'
import {
  COST_PER, PARTNER_CATEGORIES, PARTNER_KIND, categoryCounts, daysUntil, isKnownCategory, nextState, partnerEmoji, partnersFrom, telHref,
} from '../lib/partners'

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (!value) return []
  return String(value).split(',').map(v => v.trim()).filter(Boolean)
}

function blankPartner(category = '') {
  return {
    id: '', kind: PARTNER_KIND, nome: '', cargo: category, detalhe: '', contato: '', email: '', endereco: '',
    ultimo_servico: '', proximo_servico: '', amount: '', custo_por: '', dias: [], notas: '',
  }
}

function formFrom(row) {
  return {
    ...blankPartner(row.cargo || ''),
    id: row.id,
    nome: row.nome || '',
    detalhe: row.detalhe || '',
    contato: row.contato || '',
    email: row.email || '',
    endereco: row.endereco || '',
    ultimo_servico: String(row.ultimo_servico || '').slice(0, 10),
    proximo_servico: String(row.proximo_servico || '').slice(0, 10),
    amount: +row.amount ? String(row.amount) : '',
    custo_por: row.custo_por || '',
    dias: asList(row.dias),
    notas: row.notas || '',
  }
}

function useCategoryName() {
  const { t } = useI18n()
  return (key) => {
    if (!key) return t('partnersHub.noCategory')
    if (!isKnownCategory(key)) return key
    return t(`partnersHub.cat.${key}`)
  }
}

function NextLine({ date, today }) {
  const { t } = useI18n()
  if (!date) return null
  const days = daysUntil(date, today)
  const state = nextState(date, today)
  const when = days === 0 ? t('partnersHub.today') : days === 1 ? t('partnersHub.tomorrow') : days < 0 ? t('partnersHub.daysAgo', { n: -days }) : t('partnersHub.inDays', { n: days })
  return (
    <span className={`partner-next is-${state}`}>
      {t('partnersHub.next')}: {date} · {when}
    </span>
  )
}

function PartnerCard({ row, today, busy, onEdit, onDelete }) {
  const { t } = useI18n()
  const catName = useCategoryName()
  const [asking, setAsking] = useState(false)
  const tel = telHref(row.contato)
  const days = asList(row.dias)
  return (
    <article className="partner-card">
      <div className="partner-head">
        <span className="partner-emoji" aria-hidden="true">{partnerEmoji(row.cargo)}</span>
        <div className="partner-title">
          <strong>{row.nome}</strong>
          <span className="partner-cat">{catName(row.cargo)}</span>
        </div>
      </div>
      {row.detalhe && <p className="partner-what">{row.detalhe}</p>}
      <dl className="partner-facts">
        {row.contato && (
          <div><dt>{t('partnersHub.contact')}</dt><dd>{tel ? <a href={tel}>{row.contato}</a> : row.contato}</dd></div>
        )}
        {row.email && <div><dt>{t('partnersHub.email')}</dt><dd><a href={`mailto:${row.email}`}>{row.email}</a></dd></div>}
        {row.ultimo_servico && <div><dt>{t('partnersHub.last')}</dt><dd>{String(row.ultimo_servico).slice(0, 10)}</dd></div>}
        {+row.amount > 0 && (
          <div><dt>{t('partnersHub.cost')}</dt><dd>{fmtYen(row.amount)}{row.custo_por ? ` ${t(`partnersHub.per.${row.custo_por}`)}` : ''}</dd></div>
        )}
        {!!days.length && <div><dt>{t('partnersHub.days')}</dt><dd>{days.map(d => t(`house.day.${d}`)).join(' · ')}</dd></div>}
      </dl>
      <NextLine date={String(row.proximo_servico || '').slice(0, 10)} today={today} />
      {row.notas && <p className="partner-notes">{row.notas}</p>}
      <div className="partner-actions">
        {asking ? (
          <>
            <span className="partner-ask">{t('partnersHub.removeAsk')}</span>
            <button type="button" className="house-text is-danger" disabled={busy} onClick={() => onDelete(row.id)}>{t('partnersHub.removeYes')}</button>
            <button type="button" className="house-text" onClick={() => setAsking(false)}>{t('house.cancel')}</button>
          </>
        ) : (
          <>
            <button type="button" className="house-text" onClick={() => onEdit(row)}>{t('house.edit')}</button>
            <button type="button" className="house-text" onClick={() => setAsking(true)}>{t('house.remove')}</button>
          </>
        )}
      </div>
    </article>
  )
}

function CategoryPicker({ value, onChange }) {
  const { t } = useI18n()
  const typed = value && !isKnownCategory(value) ? value : ''
  return (
    <div className="partner-pick-wrap">
      <span className="partner-label">{t('partnersHub.whatKind')}</span>
      <div className="partner-pick" role="radiogroup" aria-label={t('partnersHub.whatKind')}>
        {PARTNER_CATEGORIES.map(c => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={value === c.key}
            className={value === c.key ? 'partner-tile is-on' : 'partner-tile'}
            onClick={() => onChange(c.key)}
          >
            <span aria-hidden="true">{c.emoji}</span>
            {t(`partnersHub.cat.${c.key}`)}
          </button>
        ))}
      </div>
      <input
        className="partner-typed"
        value={typed}
        placeholder={t('partnersHub.typeOwn')}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

function PartnerEditor({ form, setForm, busy, onSave, onCancel }) {
  const { t } = useI18n()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const days = asList(form.dias)
  return (
    <div className="partner-editor">
      <h2>{form.id ? t('partnersHub.editTitle') : t('partnersHub.addTitle')}</h2>
      <CategoryPicker value={form.cargo} onChange={cargo => setForm({ ...form, cargo })} />
      <div className="partner-grid">
        <label className="partner-span">{t('partnersHub.name')}
          <input value={form.nome} placeholder={t('partnersHub.namePh')} onChange={set('nome')} autoFocus />
        </label>
        <label className="partner-span">{t('partnersHub.what')}
          <input value={form.detalhe} placeholder={t('partnersHub.whatPh')} onChange={set('detalhe')} />
        </label>
        <label>{t('partnersHub.contact')}
          <input value={form.contato} placeholder={t('partnersHub.contactPh')} onChange={set('contato')} />
        </label>
        <label>{t('partnersHub.email')}
          <input type="email" value={form.email} onChange={set('email')} />
        </label>
        <label>{t('partnersHub.last')}
          <input type="date" value={form.ultimo_servico} onChange={set('ultimo_servico')} />
        </label>
        <label>{t('partnersHub.next')}
          <input type="date" value={form.proximo_servico} onChange={set('proximo_servico')} />
        </label>
        <label>{t('partnersHub.cost')}
          <input type="number" min="0" inputMode="numeric" value={form.amount} placeholder="¥" onChange={set('amount')} />
        </label>
        <div className="partner-per">
          <span className="partner-label">{t('partnersHub.costPer')}</span>
          <div className="house-chips">
            {COST_PER.map(k => (
              <button key={k} type="button" className={form.custo_por === k ? 'house-chip is-on' : 'house-chip'} onClick={() => setForm({ ...form, custo_por: form.custo_por === k ? '' : k })}>
                {t(`partnersHub.perShort.${k}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="partner-span">
          <span className="partner-label">{t('partnersHub.days')}</span>
          <div className="house-chips">
            {DAY_KEYS.map(d => (
              <button
                key={d}
                type="button"
                className={days.includes(d) ? 'house-chip is-on' : 'house-chip'}
                onClick={() => {
                  const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d]
                  setForm({ ...form, dias: DAY_KEYS.filter(k => next.includes(k)) })
                }}
              >
                {t(`house.day.${d}`)}
              </button>
            ))}
          </div>
        </div>
        <label className="partner-span">{t('partnersHub.notes')}
          <textarea rows={2} value={form.notas} placeholder={t('partnersHub.notesPh')} onChange={set('notas')} />
        </label>
      </div>
      <div className="partner-actions">
        <button type="button" className="btn-primary" disabled={busy || !form.nome.trim()} onClick={() => onSave(form)}>{t('house.save')}</button>
        <button type="button" className="house-text" onClick={onCancel}>{t('house.cancel')}</button>
      </div>
    </div>
  )
}

export default function BusinessPartners({ registry, busy, onSave, onDelete, onTab }) {
  const { t } = useI18n()
  const catName = useCategoryName()
  const today = tokyoDateKey()
  const rows = useMemo(() => partnersFrom(registry), [registry])
  const [form, setForm] = useState(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const cats = useMemo(() => categoryCounts(rows), [rows])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (cat && (r.cargo || 'outro') !== cat) return false
      if (!needle) return true
      return [r.nome, r.detalhe, r.contato, r.email, r.notas, catName(r.cargo)].filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [rows, q, cat, catName])
  const soon = useMemo(() => rows.filter(r => ['late', 'soon'].includes(nextState(String(r.proximo_servico || '').slice(0, 10), today))), [rows, today])

  async function save(next) {
    try {
      await onSave(next)
      setForm(null)
    } catch {
      // the page shows the error; keep the form open
    }
  }

  function open(row) {
    setForm(formFrom(row))
    if (typeof window !== 'undefined') window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  return (
    <section className="house-block partners-page">
      <h1>{t('partnersHub.title')}</h1>
      <p className="house-lead">{t('partnersHub.lead')}</p>

      {form ? (
        <PartnerEditor form={form} setForm={setForm} busy={busy} onSave={save} onCancel={() => setForm(null)} />
      ) : (
        <button type="button" className="btn-primary partner-add" onClick={() => setForm(blankPartner())}>+ {t('partnersHub.add')}</button>
      )}

      {!!soon.length && !form && (
        <div className="partner-soon">
          <strong>{t('partnersHub.comingUp')}</strong>
          <ul>
            {soon.map(r => (
              <li key={r.id}>
                <button type="button" className="house-text" onClick={() => open(r)}>
                  <span aria-hidden="true">{partnerEmoji(r.cargo)}</span> {r.nome}
                </button>
                <NextLine date={String(r.proximo_servico).slice(0, 10)} today={today} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!rows.length && (
        <div className="partner-filters">
          <input className="house-search" value={q} placeholder={t('partnersHub.search')} onChange={e => setQ(e.target.value)} />
          {cats.length > 1 && (
            <div className="house-chips" aria-label={t('partnersHub.whatKind')}>
              <button type="button" className={!cat ? 'house-chip is-on' : 'house-chip'} onClick={() => setCat('')}>{t('partnersHub.all')} {rows.length}</button>
              {cats.map(c => (
                <button key={c.key} type="button" className={cat === c.key ? 'house-chip is-on' : 'house-chip'} onClick={() => setCat(cat === c.key ? '' : c.key)}>
                  {c.emoji} {catName(c.key)} {c.count}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!rows.length && !form && (
        <div className="partner-empty">
          <p>{t('partnersHub.empty')}</p>
          <div className="partner-pick">
            {PARTNER_CATEGORIES.filter(c => c.key !== 'outro').slice(0, 8).map(c => (
              <button key={c.key} type="button" className="partner-tile" onClick={() => setForm(blankPartner(c.key))}>
                <span aria-hidden="true">{c.emoji}</span>
                {t(`partnersHub.cat.${c.key}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {!!rows.length && !shown.length && <div className="house-empty">{t('house.filterEmpty')}</div>}

      <div className="partner-list">
        <article className="partner-card is-jbm">
          <div className="partner-head">
            <span className="partner-emoji" aria-hidden="true">🍾</span>
            <div className="partner-title">
              <strong>JBM</strong>
              <span className="partner-cat">{t('partnersHub.cat.bebidas')}</span>
            </div>
          </div>
          <p className="partner-what">{t('partnersHub.jbmBody')}</p>
          {onTab && (
            <div className="partner-actions">
              <button type="button" className="house-text" onClick={() => onTab('pedidos')}>{t('partnersHub.jbmOpen')}</button>
            </div>
          )}
        </article>
        {shown.map(row => (
          <PartnerCard key={row.id} row={row} today={today} busy={busy} onEdit={open} onDelete={onDelete} />
        ))}
      </div>
    </section>
  )
}
