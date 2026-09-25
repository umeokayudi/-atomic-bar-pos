import { useEffect, useState } from 'react'
import { fmtYen } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { buildBarDesk } from '../lib/barDesk'
import { paymentAgenda, sameWeekdaySales, stillToSell, weekdayOf } from '../lib/barClose'
import { tokyoNightKey } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'
import BarOwnerAi from './BarOwnerAi'

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

export default function BarDesk({ bar, hq, tickets, invoices, openOrders = 0, floor, onTab }) {
  const { t } = useI18n()
  const [registry, setRegistry] = useState([])
  const [goals, setGoals] = useState({})

  useEffect(() => {
    let cancelled = false
    staffFetch('/api/bar-staff')
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        setRegistry(j.registry || [])
        setGoals(j.goals || {})
      })
      .catch(() => {
        if (cancelled) return
        setRegistry([])
        setGoals({})
      })
    return () => { cancelled = true }
  }, [bar?.id])

  const desk = buildBarDesk({ tickets, hq, invoices, registry })
  const night = tokyoNightKey()
  const cmp = sameWeekdaySales(tickets, night)
  const gap = stillToSell(cmp.now, goals.noite)
  const agenda = paymentAgenda({ registry, hq, invoices, tickets, goals, today: night }).slice(0, 8)
  const maxDay = Math.max(...desk.days.map(d => d.total), 1)
  const maxHour = Math.max(...desk.hourly.map(h => h.total), 1)

  return (
    <div className="desk">
      <div className="desk-head">
        <h2>{t('portal.desk.title')}</h2>
        <p>{t('portal.desk.lead')}</p>
        {gap != null && (
          <p className="desk-headline">
            {gap === 0 ? t('portal.desk.goalHit') : t('portal.desk.still', { amount: money(gap) })}
          </p>
        )}
        <p className="desk-note">
          {t('portal.desk.vsWeek', {
            day: t(`portal.close.days.${weekdayOf(night)}`),
            now: money(cmp.now),
            before: money(cmp.before),
            delta: `${cmp.delta >= 0 ? '+' : '−'}${money(Math.abs(cmp.delta))}`,
          })}
        </p>
      </div>

      <section className="desk-card">
        <h3>{t('portal.desk.alerts')}</h3>
        {!agenda.length && !desk.alerts.length && <div className="desk-empty">{t('portal.desk.noAlerts')}</div>}
        {(agenda.length ? agenda.map(a => ({
          id: a.id,
          tone: a.days < 0 ? 'bad' : a.days <= 7 ? 'soon' : 'month',
          title: a.title || t(`portal.pay.kind.${a.kind}`),
          amount: a.amount,
          days: a.days,
          tab: a.tab,
        })) : desk.alerts).map(a => (
          <button key={a.id} type="button" className={`desk-alert is-${a.tone}`} onClick={() => onTab?.(a.tab)}>
            <span>
              <strong>{a.title || t(`portal.desk.${a.titleKey}`)}</strong>
              <em>
                {a.tone === 'bad' && t('portal.desk.overdue', { days: Math.abs(a.days) })}
                {a.tone === 'soon' && (a.days === 0 ? t('portal.desk.dueToday') : t('portal.desk.dueSoon', { days: a.days }))}
                {a.tone === 'month' && t('portal.desk.thisMonth')}
              </em>
            </span>
            <b>{money(a.amount)}</b>
          </button>
        ))}
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.cash')}</h3>
        <div className="desk-cash">
          <div><span>{t('portal.desk.cashIn')}</span><strong>{money(desk.cash.inn)}</strong></div>
          <div><span>{t('portal.desk.cashOut')}</span><strong>{money(desk.cash.out)}</strong></div>
          <div className={desk.cash.net >= 0 ? 'is-up' : 'is-down'}><span>{t('portal.desk.cashNet')}</span><strong>{money(desk.cash.net)}</strong></div>
        </div>
        <div className="desk-lines">
          {desk.cash.lines.map(l => (
            <div key={l.key}>
              <span>{t(`portal.desk.${l.key}`)}</span>
              <b>{l.sign < 0 ? '−' : ''}{money(l.amount)}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.daily')}</h3>
        <div className="desk-bars">
          {desk.days.map(d => (
            <div key={d.date} className="desk-bar" title={`${d.date} ${money(d.total)}`}>
              <i style={{ height: `${Math.max(d.total ? 8 : 0, (d.total / maxDay) * 100)}%` }} />
              <span>{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.hourly')} · {desk.hourNight}</h3>
        {desk.peak && <p className="desk-note">{t('portal.desk.peak', { hour: desk.peak.label, amount: money(desk.peak.total) })}</p>}
        <div className="desk-bars is-hour">
          {desk.hourly.map(h => (
            <div key={h.hour} className="desk-bar" title={`${h.label} ${money(h.total)}`}>
              <i style={{ height: `${Math.max(h.total ? 8 : 0, (h.total / maxHour) * 100)}%` }} />
              <span>{String(h.hour).padStart(2, '0')}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.cast')}</h3>
        {!desk.cast.length && <div className="desk-empty">{t('portal.desk.emptyCast')}</div>}
        {desk.cast.map(c => (
          <div key={c.id} className="desk-row">
            <div>
              <strong>{c.name}</strong>
              <em>{t('portal.desk.tickets', { count: c.tickets })}</em>
            </div>
            <div className="desk-row-money">
              <b>{money(c.sales)}</b>
              <em>{t('portal.desk.commission')} {money(c.commission)}</em>
            </div>
          </div>
        ))}
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.labor')}</h3>
        <div className="desk-cash">
          <div><span>{t('portal.desk.labor')}</span><strong>{money(desk.labor.total)}</strong></div>
          <div><span>{t('portal.desk.hours')}</span><strong>{desk.labor.hours}h</strong></div>
        </div>
        {!desk.labor.rows.length && <div className="desk-empty">{t('portal.desk.emptyLabor')}</div>}
        {desk.labor.rows.map(r => (
          <div key={r.staff_id} className="desk-row">
            <div>
              <strong>{r.nome}</strong>
              <em>{r.hours}h{r.cargo ? ` · ${r.cargo}` : ''}</em>
            </div>
            <b>{money(r.pay)}</b>
          </div>
        ))}
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.more')}</h3>
        <div className="desk-more">
          <button type="button" onClick={() => onTab?.('pedidos')}>{t('portal.desk.orders')} · {openOrders}</button>
          <button type="button" onClick={() => onTab?.('espacos')}>{t('portal.desk.floor')} · {floor?.seated || 0}</button>
          <button type="button" onClick={() => onTab?.('custos')}>{t('portal.desk.books')}</button>
          <button type="button" onClick={() => onTab?.('pos')}>{t('portal.desk.till')}</button>
          <button type="button" onClick={() => onTab?.('metas')}>{t('nav.portalGoals')}</button>
          <button type="button" onClick={() => onTab?.('fechamento')}>{t('nav.portalClose')}</button>
          <button type="button" onClick={() => onTab?.('pagamentos')}>{t('nav.portalPay')}</button>
          <button type="button" onClick={() => onTab?.('salarios')}>{t('nav.portalSalary')}</button>
        </div>
      </section>

      <BarOwnerAi bar={bar} hq={hq} />
    </div>
  )
}
