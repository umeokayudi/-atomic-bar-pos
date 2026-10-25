import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { filterSupplierVendas } from './utils'
import { filterJbmDrinksFaturas } from '../lib/barPortal'
import { monthlyAccountSummary } from '../lib/clientAnalytics'
import { tokyoMonthKey, recentMonthKeys, isMonthKey } from '../lib/tokyo'
import { payrollFromPunches, monthRange } from '../lib/timeClock'
import { splitCostBooks } from '../lib/costBooks'
import { asReactText, errText } from '../lib/errText'
import { fetchHqSnapshot } from '../lib/hqSnapshot'
import { loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { buildCostOverview } from '../lib/costOverview'
import { isKnownCostCategory } from '../lib/costCategories'
import { useI18n } from '../lib/i18n'
import Icon from './ui/Icon'

const ACTIONS = [
  { id: 'pos', icon: 'pos', labelKey: 'portal.home.goPos', hintKey: 'portal.home.goPosHint' },
  { id: 'pedidos', icon: 'purchases', labelKey: 'portal.home.goOrders', hintKey: 'portal.home.goOrdersHint' },
  { id: 'espacos', icon: 'floor', labelKey: 'portal.home.goFloor', hintKey: 'portal.home.goFloorHint' },
  { id: 'clientes', icon: 'clientes', labelKey: 'portal.home.goGuests', hintKey: 'portal.home.goGuestsHint' },
  { id: 'ponto', icon: 'clock', labelKey: 'portal.home.goClock', hintKey: 'portal.home.goClockHint' },
  { id: 'fechamento', icon: 'fechamento', labelKey: 'portal.home.goClose', hintKey: 'portal.home.goCloseHint' },
  { id: 'staff', icon: 'staff', labelKey: 'nav.portalTeam', hintKey: 'portal.home.goStaffHint' },
  { id: 'estoque', icon: 'estoque', labelKey: 'nav.portalInventory' },
  { id: 'faturas', icon: 'invoices', labelKey: 'nav.portalInvoices' },
]

function BookCard({ kicker, value, hint, tone = 'navy', active, onClick }) {
  const tones = {
    navy: { bg: 'linear-gradient(135deg, var(--c-accent-2) 0%, color-mix(in srgb, var(--c-accent) 70%, var(--c-chrome)) 100%)', color: 'white', hint: 'rgba(255,255,255,0.8)', border: 'none' },
    light: { bg: 'var(--bg2)', color: 'var(--c-text)', hint: 'var(--text2)', border: '1px solid var(--border)' },
    green: { bg: 'var(--bg2)', color: 'var(--green)', hint: 'var(--text2)', border: '1px solid rgba(52,199,89,0.25)' },
    amber: { bg: 'var(--bg2)', color: 'var(--amber)', hint: 'var(--text2)', border: '1px solid rgba(255,159,10,0.28)' },
  }
  const s = tones[tone] || tones.navy
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hq-book${active ? ' is-on' : ''}`}
      style={{ background: s.bg, color: s.color, border: s.border }}
    >
      <div className="easy-dash-kicker">{kicker}</div>
      <div className="easy-dash-value" style={{ marginTop: 8 }}>{value}</div>
      {hint && <div className="easy-dash-hint" style={{ color: s.hint }}>{hint}</div>}
    </button>
  )
}

export function CostBooksHero({ books, access, selected = 'all', onSelect }) {
  const { t } = useI18n()
  if (!books?.pos || !books?.jbm || !books?.staff) return null
  const pick = id => onSelect?.(selected === id ? 'all' : id)
  return (
    <div className="hq-books-wrap">
      <div className="hq-books-kicker">{t('portal.costs.neverMix')}</div>
      <div className="hq-books">
        {access.posTill && (
          <BookCard kicker={t('portal.costs.posTill')} value={fmtYen(books.pos.amount)} hint={t('portal.costs.posTillHint')} tone="light" active={selected === 'pos'} onClick={() => pick('pos')} />
        )}
        {access.jbmBill && (
          <BookCard kicker={t('portal.costs.jbmBill')} value={fmtYen(books.jbm.amount)} hint={t('portal.costs.jbmBillHint')} tone="navy" active={selected === 'jbm'} onClick={() => pick('jbm')} />
        )}
        {access.staffWages && (
          <BookCard kicker={t('portal.costs.staffWages')} value={fmtYen(books.staff.amount)} hint={t('portal.costs.staffWagesHint')} tone="green" active={selected === 'staff'} onClick={() => pick('staff')} />
        )}
        {access.rent && books.rent && (
          <BookCard kicker={t('portal.costs.rent')} value={fmtYen(books.rent.amount)} hint={t('portal.costs.rentHint')} tone="amber" active={selected === 'rent'} onClick={() => pick('rent')} />
        )}
      </div>
    </div>
  )
}

export function BarCommandActions({ onTab, ids }) {
  const { t } = useI18n()
  const list = ids ? ACTIONS.filter(a => ids.includes(a.id)) : ACTIONS
  return (
    <div className="hq-actions" style={{ '--hq-cols': list.length }}>
      {list.map(a => (
        <button key={a.id} type="button" className="hq-action" data-hq-action={a.id} onClick={() => onTab?.(a.id)}>
          <span className="hq-action-icon"><Icon name={a.icon} size={20} /></span>
          <span>{t(a.labelKey)}</span>
          {a.hintKey && <span className="hq-action-hint">{t(a.hintKey)}</span>}
        </button>
      ))}
    </div>
  )
}

export async function loadCostBooks(barId, monthKey) {
  const mes = isMonthKey(monthKey) ? monthKey : tokyoMonthKey()
  try {
    const hq = await fetchHqSnapshot(mes, { full: true })
    if (hq?.books) return hq.books
  } catch {
    // fall through
  }
  const range = monthRange(`${mes}-01`)
  const [vR, fR, posR, clockR, teamR, rentR] = await Promise.all([
    supabase.from('vendas').select('*').eq('bar_id', barId),
    supabase.from('faturas').select('*').eq('bar_id', barId),
    supabase.from('pos_vendas').select('total,data').eq('bar_id', barId),
    staffFetch(`/api/time-clock?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`).then(r => r.json()).catch(() => ({ punches: [] })),
    staffFetch('/api/bar-staff').then(r => r.json()).catch(() => ({ staff: [] })),
    supabase.from('bar_overhead').select('kind,month_key,amount').eq('bar_id', barId).eq('kind', 'rent').eq('month_key', mes),
  ])
  const vendas = filterSupplierVendas(vR.data || [])
  const faturas = filterJbmDrinksFaturas(fR.data || [])
  const account = monthlyAccountSummary(vendas, faturas, mes)
  const posMonthTotal = (posR.data || [])
    .filter(s => String(s.data || '').startsWith(mes))
    .reduce((a, s) => a + (+s.total || 0), 0)
  const payroll = payrollFromPunches(clockR.punches || [], teamR.staff || [], range, {
    nightPremium: teamR.goals?.adicional_noturno !== false,
  })
  const staffMonthPay = payroll.reduce((a, r) => a + (+r.pay || 0), 0)
  const rentMonth = (rentR.data || []).reduce((a, r) => a + (+r.amount || 0), 0)
  return splitCostBooks({ posMonthTotal, jbmMonthBill: account.contaMes, staffMonthPay, rentMonth })
}

function CostLine({ line }) {
  const { t } = useI18n()
  const catLabel = line.category
    ? (isKnownCostCategory(line.category) ? t(`costForm.cat.${line.category}`) : line.category)
    : ''
  const title = line.labelKey ? t(`costView.line.${line.labelKey}`) : (line.name || catLabel)
  const sub = line.labelKey
    ? (line.id === 'wages' && line.hours ? t('costView.hours', { n: Number(line.hours).toFixed(1) })
      : line.id === 'card' ? t('costView.cardSub', { pct: line.pct })
      : line.id === 'rent' && !line.amount ? t('costView.rentMissing')
      : t(`costView.sub.${line.labelKey}`))
    : [catLabel && catLabel !== title ? catLabel : '', t(`costView.group.${line.group}`)].filter(Boolean).join(' · ')
  return (
    <li className={`cov-line${line.amount ? '' : ' is-zero'}`}>
      <span className="cov-emoji" aria-hidden="true">{line.emoji}</span>
      <div className="cov-line-main">
        <div className="cov-line-top">
          <span className="cov-line-name">{title}</span>
          <span className="cov-line-amt">{fmtYen(line.amount)}</span>
        </div>
        <div className="cov-line-sub">
          <span>{sub}</span>
          {line.amount > 0 && <span className="cov-line-pct">{line.share}%</span>}
        </div>
        <div className="cov-bar" aria-hidden="true"><span style={{ width: `${line.bar}%` }} /></div>
      </div>
    </li>
  )
}

export default function BarCostsTab({ bar }) {
  const { t } = useI18n()
  const [month, setMonth] = useState(tokyoMonthKey())
  const [hq, setHq] = useState(null)
  const [books, setBooks] = useState(null)
  const [registry, setRegistry] = useState(() => peekBarTeam()?.registry || [])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function load(force = false, mes = month) {
    setErr('')
    try {
      const snap = force
        ? await staffFetch('/api/bar/hq-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month: mes }),
        }).then(async r => {
          const j = await r.json()
          if (!r.ok) throw new Error(errText(j.error, 'Sync failed'))
          return j
        })
        : await fetchHqSnapshot(mes, { full: true, fresh: true })
      setHq(snap)
      setBooks(snap.books)
    } catch (e) {
      setHq(null)
      try {
        setBooks(await loadCostBooks(bar.id, mes))
      } catch (e2) {
        setErr(errText(e2 || e))
      }
    }
  }

  useEffect(() => {
    let cancelled = false
    setBooks(null)
    load(false, month).catch(e => { if (!cancelled) setErr(errText(e)) })
    return () => { cancelled = true }
  }, [bar.id, month])

  useEffect(() => {
    let cancelled = false
    loadBarTeam().then(team => { if (!cancelled && !team?.error) setRegistry(team.registry || []) }).catch(() => {})
    return () => { cancelled = true }
  }, [bar.id])

  async function syncNow() {
    setBusy(true)
    await load(true, month)
    setBusy(false)
  }

  const now = tokyoMonthKey()
  const months = recentMonthKeys(6, now)
  const monthLabel = (key, withYear = true) => {
    const [y, m] = String(key).split('-')
    const name = (t('months.short') || [])[+m - 1] || m
    return withYear ? `${name} ${y}` : name
  }
  const view = books ? buildCostOverview({ registry, hq, books, monthKey: month }) : null
  const good = view && view.result >= 0

  return (
    <div className="fade-in portal-page cov">
      <header className="cov-head">
        <div>
          <h1 className="cov-title">{t('costView.title')}</h1>
          <p className="cov-sub">{t('costView.lead')}</p>
        </div>
        <button type="button" className="cov-sync" onClick={syncNow} disabled={busy} aria-label={t('costView.refresh')} title={t('costView.refresh')}>
          <Icon name="refresh" size={18} />
        </button>
      </header>

      <div className="cov-months" role="radiogroup" aria-label={t('costView.month')}>
        {months.map(m => (
          <button key={m} type="button" role="radio" aria-checked={month === m} className={`cov-month${month === m ? ' is-on' : ''}`} onClick={() => setMonth(m)}>
            <span className="cov-month-name">{monthLabel(m, false)}</span>
            <span className="cov-month-year">{m === now ? t('costView.thisMonth') : m.slice(0, 4)}</span>
          </button>
        ))}
      </div>

      {err && <div className="cov-err">{asReactText(err)}</div>}
      {!view && !err && <Spinner text={t('portal.costs.loading')} />}

      {view && (
        <>
          <section className={`cov-result ${good ? 'is-good' : 'is-bad'}`} aria-live="polite">
            <div className="cov-result-k">{t(good ? 'costView.profit' : 'costView.loss')} · {monthLabel(month)}</div>
            <div className="cov-result-v">{good ? '' : '−'}{fmtYen(Math.abs(view.result))}</div>
            <div className="cov-sum">
              <div><span>{t('costView.till')}</span><b>{fmtYen(view.till)}</b><small>{t('costView.tickets', { n: view.tickets })}</small></div>
              <div className="cov-sum-op" aria-hidden="true">−</div>
              <div><span>{t('costView.costs')}</span><b>{fmtYen(view.costs)}</b><small>{view.costShare == null ? t('costView.noTill') : t('costView.ofTill', { pct: view.costShare })}</small></div>
            </div>
          </section>

          <section className="cov-card">
            <div className="cov-card-head">
              <h2>{t('costView.breakdown')}</h2>
              <span>{fmtYen(view.costs)}</span>
            </div>
            <ul className="cov-lines">
              {view.lines.map(line => <CostLine key={line.id} line={line} />)}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
