import { useEffect, useRef, useState } from 'react'
import { fmtYen } from '../utils'
import { useI18n } from '../../lib/i18n'
import {
  CUSTOM_EMOJI, categoriesFor, costCategoryOf, groupYen, isKnownCostCategory, kindForCategory, yenDigits,
} from '../../lib/costCategories'

const METODOS = [
  ['transfer', '🏦'], ['debit', '🔁'], ['card', '💳'], ['cash', '💴'], ['konbini', '🏪'], ['other', '➕'],
]
const QUICK_ADD = [1000, 5000, 10000, 50000]
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

/**
 * Add / edit form for the Fixed and Variable cost pages: pick a category (rent, internet, power…
 * or the owner's own), the amount in yen, the due day or month, how it is paid. Save stays on screen.
 */
export default function CostEditor({ spec, form, setForm, busy, onSave, onCancel }) {
  const { t } = useI18n()
  const variable = spec.kind === 'variavel'
  const cats = categoriesFor(spec.kind)
  const initial = costCategoryOf(form)
  const [category, setCategory] = useState(initial)
  const [custom, setCustom] = useState(initial && !isKnownCostCategory(initial))
  const box = useRef(null)
  // Open where the owner can see it: the form sits under the list of saved costs.
  useEffect(() => { box.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }, [])
  const [more, setMore] = useState(!!(form.contato || form.email || form.endereco || form.notas || form.cargo))
  const catLabel = key => (isKnownCostCategory(key) ? t(`costForm.cat.${key}`) : key)
  const kind = kindForCategory(spec.kind, custom ? '' : category)
  const hasContactPerson = kind === 'aluguel' || kind === 'energia'

  function pick(key) {
    const prevLabel = category && !custom ? catLabel(category) : ''
    setCustom(false)
    setCategory(key)
    // Fill the name with the category until the owner types their own.
    const nome = !form.nome.trim() || form.nome === prevLabel ? catLabel(key) : form.nome
    setForm({ ...form, nome })
  }

  function pickCustom() {
    setCustom(true)
    setCategory(isKnownCostCategory(category) ? '' : category)
  }

  function save() {
    const own = custom ? category.trim() : category
    const nextKind = kindForCategory(spec.kind, custom ? '' : own)
    onSave({
      ...form,
      kind: nextKind,
      detalhe: nextKind === 'aluguel' || nextKind === 'energia' ? '' : own,
      cargo: nextKind === 'aluguel' || nextKind === 'energia' ? form.cargo : '',
      amount: yenDigits(form.amount),
    })
  }

  const amount = +yenDigits(form.amount) || 0
  const field = (key, labelKey, props = {}) => (
    <label className="cost-field">
      <span>{t(labelKey)}</span>
      <input value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })} {...props} />
    </label>
  )

  return (
    <div className="cost-editor" ref={box}>
      <div className="cost-step">
        <div className="cost-step-k">{t('costForm.category')}</div>
        <div className="cost-cats" role="radiogroup" aria-label={t('costForm.category')}>
          {cats.map(c => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={!custom && category === c.key}
              className={`cost-cat${!custom && category === c.key ? ' is-on' : ''}`}
              onClick={() => pick(c.key)}
            >
              <span className="cost-cat-emoji" aria-hidden="true">{c.emoji}</span>
              <span className="cost-cat-name">{t(`costForm.cat.${c.key}`)}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={custom} className={`cost-cat is-custom${custom ? ' is-on' : ''}`} onClick={pickCustom}>
            <span className="cost-cat-emoji" aria-hidden="true">{CUSTOM_EMOJI}</span>
            <span className="cost-cat-name">{t('costForm.ownCategory')}</span>
          </button>
        </div>
        {custom && (
          <input
            className="cost-own"
            autoFocus
            value={category}
            maxLength={40}
            placeholder={t('costForm.ownPlaceholder')}
            onChange={e => setCategory(e.target.value)}
          />
        )}
      </div>

      <div className="cost-step">
        <label className="cost-field">
          <span>{t(hasContactPerson ? (kind === 'aluguel' ? 'house.agency' : 'house.company') : 'costForm.name')}</span>
          <input value={form.nome} maxLength={80} placeholder={t('costForm.namePlaceholder')} onChange={e => setForm({ ...form, nome: e.target.value })} />
        </label>

        <label className="cost-field">
          <span>{t(variable ? 'house.billAmount' : 'house.monthlyAmount')}</span>
          <div className="cost-yen">
            <span aria-hidden="true">¥</span>
            <input
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={groupYen(form.amount)}
              onChange={e => setForm({ ...form, amount: yenDigits(e.target.value) })}
            />
          </div>
        </label>
        <div className="cost-quick">
          {QUICK_ADD.map(n => (
            <button key={n} type="button" onClick={() => setForm({ ...form, amount: String(amount + n) })}>+{fmtYen(n)}</button>
          ))}
          {amount > 0 && <button type="button" className="is-clear" onClick={() => setForm({ ...form, amount: '' })}>{t('costForm.clear')}</button>}
        </div>
      </div>

      <div className="cost-step">
        <div className="cost-repeat">{variable ? `📅 ${t('costForm.onlyMonth')}` : `🔁 ${t('costForm.everyMonth')}`}</div>
        {variable ? (
          <div className="cost-two">
            <label className="cost-field">
              <span>{t('house.month')}</span>
              <input type="month" value={form.month_key || ''} onChange={e => setForm({ ...form, month_key: e.target.value })} />
            </label>
            <label className="cost-field">
              <span>{t('house.payDate')}</span>
              <input type="date" value={form.data_pagamento || ''} onChange={e => setForm({ ...form, data_pagamento: e.target.value })} />
            </label>
          </div>
        ) : (
          <>
            <div className="cost-step-k">
              {t('house.dueDay')}
              {+form.vence_dia ? <b> · {t('costForm.dayN', { n: form.vence_dia })}</b> : null}
            </div>
            <div className="cost-days" role="radiogroup" aria-label={t('house.dueDay')}>
              {DAYS.map(d => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={+form.vence_dia === d}
                  className={+form.vence_dia === d ? 'is-on' : ''}
                  onClick={() => setForm({ ...form, vence_dia: +form.vence_dia === d ? '' : String(d) })}
                >{d}</button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="cost-step">
        <div className="cost-step-k">{t('house.methodLabel')}</div>
        <div className="cost-methods">
          {METODOS.map(([key, emoji]) => (
            <button key={key} type="button" className={form.metodo === key ? 'is-on' : ''} aria-pressed={form.metodo === key} onClick={() => setForm({ ...form, metodo: form.metodo === key ? '' : key })}>
              <span aria-hidden="true">{emoji}</span> {t(`house.metodo.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="cost-step">
        <button type="button" className="cost-more" aria-expanded={more} onClick={() => setMore(v => !v)}>
          {more ? '−' : '+'} {t('costForm.moreDetails')}
        </button>
        {more && (
          <div className="cost-more-body">
            {hasContactPerson && field('cargo', 'house.contactPerson')}
            {field('contato', 'house.phone', { inputMode: 'tel' })}
            {hasContactPerson && field('email', 'house.email', { type: 'email' })}
            {kind === 'aluguel' && field('endereco', 'house.address')}
            {field('notas', 'house.notes')}
          </div>
        )}
      </div>

      <div className="cost-savebar">
        <button type="button" className="house-text" onClick={onCancel}>{t('house.cancel')}</button>
        <button type="button" className="btn-primary" disabled={busy || !form.nome.trim() || (custom && !category.trim())} onClick={save}>
          {amount > 0 ? t('costForm.saveAmount', { amount: fmtYen(amount) }) : t('house.save')}
        </button>
      </div>
    </div>
  )
}
