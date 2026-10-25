import { useEffect, useState } from 'react'
import { fmtYen } from './utils'
import { useI18n } from '../lib/i18n'
import { bucketAgenda, coverAgenda, daysBetween } from '../lib/payCoverage'

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

function dayLabel(date, lang) {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number)
  if (!y) return ''
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

/** Upcoming payments: what is due, grouped by friendly dates, and whether the money on hand covers each one. */
export default function BarPayPlan({ agenda, goals, today, busy, onSave, onTab }) {
  const { t, lang } = useI18n()
  const saved = goals.caixa_saldo == null ? '' : String(goals.caixa_saldo)
  const [editing, setEditing] = useState(saved === '')
  const [draft, setDraft] = useState(saved)
  const [days, setDays] = useState({ dia_salario: goals.dia_salario || 25, dia_drink: goals.dia_drink || 10 })

  useEffect(() => { setDraft(saved); if (saved !== '') setEditing(false) }, [saved])
  useEffect(() => {
    setDays({ dia_salario: goals.dia_salario || 25, dia_drink: goals.dia_drink || 10 })
  }, [goals.dia_salario, goals.dia_drink])

  const plan = coverAgenda(agenda, saved === '' ? null : saved)
  const groups = bucketAgenda(plan.rows, today)
  const age = goals.caixa_saldo_em ? daysBetween(goals.caixa_saldo_em, today) : null

  function saveBalance(e) {
    e?.preventDefault()
    const clean = String(draft).replace(/[^\d-]/g, '')
    if (clean === '' || clean === '-') return
    onSave({ caixa_saldo: Math.round(+clean), caixa_saldo_em: today })
    setEditing(false)
  }

  function when(row) {
    if (row.days < 0) return t('portal.pay.lateBy', { days: Math.abs(row.days) })
    if (row.days === 0) return t('portal.pay.groups.today')
    if (row.days === 1) return t('portal.pay.groups.tomorrow')
    return t('portal.pay.inDays', { days: row.days })
  }

  function groupTitle(key) {
    if (key.startsWith('month:')) {
      const [y, m] = key.slice(6).split('-').map(Number)
      return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
    }
    return t(`portal.pay.groups.${key}`)
  }

  const heroLine = () => {
    if (!plan.known) return t('portal.pay.askBalance')
    if (plan.status === 'short') {
      return t('portal.pay.heroShort', { date: dayLabel(plan.firstShort.date, lang), amount: money(plan.missing) })
    }
    if (plan.status === 'tight') return t('portal.pay.heroTight', { date: dayLabel(plan.firstTight.date, lang) })
    return t('portal.pay.heroOk')
  }

  return (
    <>
      <section className={`pay-plan-hero is-${plan.status || 'unknown'}`}>
        <div className="pay-plan-kicker">{t('portal.pay.balance')}</div>
        {editing ? (
          <form className="pay-plan-balance" onSubmit={saveBalance}>
            <input
              type="text"
              inputMode="numeric"
              autoFocus={saved === ''}
              placeholder="¥0"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              disabled={busy}
              aria-label={t('portal.pay.balance')}
            />
            <button type="submit" disabled={busy}>{t('portal.pay.saveBalance')}</button>
            {saved !== '' && <button type="button" className="is-ghost" onClick={() => { setDraft(saved); setEditing(false) }}>{t('portal.pay.cancel')}</button>}
          </form>
        ) : (
          <button type="button" className="pay-plan-value" onClick={() => setEditing(true)}>
            {money(plan.balance)}
            <span>{t('portal.pay.edit')}</span>
          </button>
        )}
        <p className="pay-plan-hint">
          {plan.known && age != null
            ? (age <= 0 ? t('portal.pay.updatedToday') : age === 1 ? t('portal.pay.updatedYesterday') : t('portal.pay.updatedAgo', { days: age }))
            : t('portal.pay.balanceHint')}
        </p>
        <strong className="pay-plan-verdict">{heroLine()}</strong>
        {plan.known && (
          <div className="pay-plan-sums">
            <div><span>{t('portal.pay.toPay')}</span><b>{money(plan.due)}</b></div>
            <div><span>{t('portal.pay.comingIn')}</span><b>+{money(plan.income)}</b></div>
            <div><span>{t('portal.pay.leftAtEnd')}</span><b className={plan.end < 0 ? 'is-neg' : ''}>{money(plan.end)}</b></div>
          </div>
        )}
      </section>

      {plan.known && (
        <div className="pay-plan-legend">
          <span className="is-ok">{t('portal.pay.status.ok')}</span>
          <span className="is-tight">{t('portal.pay.status.tight')}</span>
          <span className="is-short">{t('portal.pay.status.short')}</span>
        </div>
      )}

      {!agenda.length && <div className="desk-empty">{t('portal.pay.empty')}</div>}

      <div className="pay-timeline">
        {groups.map(group => (
          <section key={group.key} className={`pay-group${group.key === 'late' ? ' is-late' : ''}`}>
            <header>
              <h3>{groupTitle(group.key)}{group.key === 'late' ? ` · ${group.rows.length}` : ''}</h3>
              {group.due > 0 && <b>{money(group.due)}</b>}
            </header>
            {group.rows.map(row => (
              <button
                key={row.id}
                type="button"
                className={`pay-row is-${row.inflow ? 'in' : row.status || (row.days < 0 ? 'late' : 'plain')}`}
                onClick={() => onTab?.(row.tab)}
              >
                <i className="pay-dot" aria-hidden="true" />
                <span className="pay-row-main">
                  <strong>{row.title || t(`portal.pay.kind.${row.kind}`)}</strong>
                  <em>
                    {dayLabel(row.date, lang)}
                    {' · '}
                    {when(row)}
                    {row.metodo ? ` · ${t(`house.metodo.${row.metodo}`)}` : ''}
                  </em>
                </span>
                <span className="pay-row-money">
                  <b>{row.inflow ? '+' : ''}{money(row.amount)}</b>
                  {row.status === 'short' && <small>{t('portal.pay.missing', { amount: money(row.missing) })}</small>}
                  {row.status === 'tight' && <small>{t('portal.pay.needsIncome')}</small>}
                  {(row.status === 'ok' || row.status === 'in') && <small>{t('portal.pay.left', { amount: money(row.left) })}</small>}
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>

      <details className="pay-days">
        <summary>
          {t('portal.pay.daysTitle')}
          <span>{t('portal.pay.daysSummary', { pay: goals.dia_salario || 25, drink: goals.dia_drink || 10 })}</span>
        </summary>
        <div className="house-editor">
          <label>
            {t('portal.pay.salaryDay')}
            <input type="number" min="1" max="28" value={days.dia_salario} disabled={busy} onChange={e => setDays(d => ({ ...d, dia_salario: e.target.value }))} onBlur={() => onSave({ dia_salario: days.dia_salario })} />
          </label>
          <label>
            {t('portal.pay.drinkDay')}
            <input type="number" min="1" max="28" value={days.dia_drink} disabled={busy} onChange={e => setDays(d => ({ ...d, dia_drink: e.target.value }))} onBlur={() => onSave({ dia_drink: days.dia_drink })} />
          </label>
        </div>
        <p className="desk-note">{t('portal.pay.daysHint')}</p>
      </details>
    </>
  )
}
