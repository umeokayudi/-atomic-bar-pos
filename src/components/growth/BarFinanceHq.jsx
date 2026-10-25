import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { staffFetch } from '../../lib/apiAuth'
import { useI18n } from '../../lib/i18n'
import { useAiPageContext } from '../../lib/aiPanel'
import { barFinanceView } from '../../lib/barFinanceHq'
import { recentMonthKeys, tokyoMonthKey, tokyoNightKey } from '../../lib/tokyo'
import { errText } from '../../lib/errText'
import { fmtYen } from '../utils'
import { ColumnChart, Donut, HBarList, InOutChart } from '../ui/Charts'
import { compactYen } from '../../lib/hqFilters'
import { Kpi } from './ClientsCrm'
import Icon from '../ui/Icon'

const MONTHS = 6

async function getJson(url) {
  const r = await staffFetch(url)
  const j = await r.json().catch(() => ({ error: r.statusText }))
  if (!r.ok || j.error) throw new Error(errText(j.error || j, 'Load failed'))
  return j
}

function pct(v) {
  return v == null ? '—' : `${v}%`
}

function MonthPicker({ value, onChange }) {
  const { t } = useI18n()
  return (
    <label className="ui-field">
      <span className="ui-sr">{t('barFin.month')}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {recentMonthKeys(MONTHS).map(k => <option key={k} value={k}>{k}</option>)}
      </select>
    </label>
  )
}

/** JBM admin: money of every client bar. Tap a bar to see its till, cash flow, costs, sales and margin. */
export default function BarFinanceHq() {
  const [params, setParams] = useSearchParams()
  const [month, setMonth] = useState(tokyoMonthKey())
  const barId = params.get('bar') || ''
  const open = id => setParams(id ? { bar: id } : {})
  return barId
    ? <BarPage barId={barId} month={month} setMonth={setMonth} onBack={() => open('')} />
    : <BarList month={month} setMonth={setMonth} onOpen={open} />
}

function BarList({ month, setMonth, onOpen }) {
  const { t } = useI18n()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    getJson(`/api/bar/bar-finance?month=${month}`)
      .then(j => { if (alive) setData(j) })
      .catch(e => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [month])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data?.bars || [])
      .filter(r => !needle || String(r.nome).toLowerCase().includes(needle))
      .sort((a, b) => (b.sales || 0) - (a.sales || 0))
  }, [data, q])

  const totals = useMemo(() => (data?.bars || []).reduce((a, r) => ({
    sales: a.sales + (r.sales || 0),
    result: a.result + (r.result || 0),
    loss: a.loss + (r.hasTill && r.result < 0 ? 1 : 0),
    owes: a.owes + (r.owesJbm || 0),
  }), { sales: 0, result: 0, loss: 0, owes: 0 }), [data])

  useAiPageContext('barFinance', {
    module: 'finance',
    title: t('nav.barFinance'),
    period: month,
    kpis: data ? [
      { label: t('barFin.kSales'), value: fmtYen(totals.sales) },
      { label: t('barFin.kResult'), value: fmtYen(totals.result) },
      { label: t('barFin.kLoss'), value: totals.loss },
      ...rows.slice(0, 12).map(r => ({ label: r.nome, value: `${fmtYen(r.sales)} · ${t('barFin.result')} ${fmtYen(r.result)} · ${pct(r.marginPct)}` })),
    ] : [],
  })

  return (
    <div className="fade-in growth-page">
      <div className="ui-pagebar">
        <div>
          <div className="ui-pagebar-title">{t('nav.barFinance')}</div>
          <div className="ui-card-sub">{t('barFin.listSub')}</div>
        </div>
        <MonthPicker value={month} onChange={setMonth} />
      </div>

      {error && <div className="ui-error" role="alert"><Icon name="warning" />{error}</div>}

      <div className="ui-grid cols-4">
        <Kpi icon="sales" label={t('barFin.kSales')} value={data ? fmtYen(totals.sales) : null} />
        <Kpi icon="result" label={t('barFin.kResult')} value={data ? fmtYen(totals.result) : null} tone={totals.result < 0 ? 'danger' : ''} />
        <Kpi icon="warning" label={t('barFin.kLoss')} value={data ? String(totals.loss) : null} tone={totals.loss ? 'danger' : ''} />
        <Kpi icon="faturas" label={t('barFin.kOwes')} value={data ? fmtYen(totals.owes) : null} />
      </div>

      <section className="ui-card">
        <div className="ui-card-head growth-toolbar">
          <label className="ui-field growth-search">
            <span className="ui-sr">{t('common.search')}</span>
            <Icon name="search" size={16} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('growth.searchBars')} />
          </label>
        </div>
        {!data && !error && <div className="ui-skel" style={{ height: 160 }} />}
        {data && rows.length === 0 && <div className="ui-empty"><Icon name="bars" size={22} /><div className="ui-empty-title">{t('growth.noClients')}</div></div>}
        {data && rows.length > 0 && (
          <table className="ui-table is-stack is-stack-md bar-fin-table">
            <thead>
              <tr>
                <th>{t('common.bar')}</th>
                <th className="num">{t('barFin.sales')}</th>
                <th className="num">{t('barFin.costs')}</th>
                <th className="num">{t('barFin.result')}</th>
                <th className="num">{t('barFin.margin')}</th>
                <th className="num">{t('barFin.owesJbm')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="bar-fin-row" onClick={() => onOpen(r.id)}>
                  <td data-label={t('common.bar')}>
                    <button type="button" className="bar-fin-name" onClick={e => { e.stopPropagation(); onOpen(r.id) }}>
                      <span className="growth-dot" style={{ background: r.cor || 'var(--c-accent)' }} />{r.nome}
                    </button>
                    {r.error && <div className="txt-danger">{r.error}</div>}
                    {!r.error && !r.hasTill && <div className="ui-muted">{t('barFin.noTill')}</div>}
                  </td>
                  <td data-label={t('barFin.sales')} className="num">
                    {fmtYen(r.sales)}
                    {r.growthPct != null && <div className={r.growthPct < 0 ? 'txt-danger' : 'txt-success'}>{r.growthPct > 0 ? '+' : ''}{r.growthPct}% {t('barFin.vsPrev')}</div>}
                  </td>
                  <td data-label={t('barFin.costs')} className="num">{fmtYen(r.costs)}</td>
                  <td data-label={t('barFin.result')} className={`num ${r.result < 0 ? 'txt-danger' : ''}`}>{fmtYen(r.result)}</td>
                  <td data-label={t('barFin.margin')} className="num">{pct(r.marginPct)}</td>
                  <td data-label={t('barFin.owesJbm')} className="num">
                    {fmtYen(r.owesJbm)}
                    {r.overdueInvoices > 0 && <div className="txt-danger">{t('barFin.overdueN', { n: r.overdueInvoices })}</div>}
                  </td>
                  <td className="num"><Icon name="next" size={16} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="growth-formula"><Icon name="info" size={14} /> {t('barFin.formula')}</p>
      </section>
    </div>
  )
}

const TENDER_KEYS = ['cash', 'card', 'paypay', 'other']

function BarPage({ barId, month, setMonth, onBack }) {
  const { t } = useI18n()
  const [pack, setPack] = useState(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setPack(null)
    setError('')
    getJson(`/api/bar/bar-finance?bar_id=${encodeURIComponent(barId)}&month=${month}`)
      .then(j => { if (alive) setPack(j) })
      .catch(e => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [barId, month, reload])

  const today = tokyoNightKey()
  const view = useMemo(() => (pack ? barFinanceView(pack, month, today) : null), [pack, month, today])
  const m = view?.month
  const p = view?.prev
  const name = pack?.bar?.nome || ''
  const delta = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null)
  const tender = m?.tender

  useAiPageContext('barFinance', {
    module: 'finance',
    title: `${t('nav.barFinance')} · ${name}`,
    unit: name,
    barId,
    period: month,
    kpis: m ? [
      { label: t('barFin.sales'), value: fmtYen(m.money.sales) },
      { label: t('barFin.costs'), value: fmtYen(m.money.costs) },
      { label: t('barFin.result'), value: fmtYen(m.money.result) },
      { label: t('barFin.margin'), value: pct(m.money.marginPct) },
      { label: t('barFin.gross'), value: pct(m.money.grossPct) },
      ...m.lines.filter(l => l.value).map(l => ({ label: t(`barFin.line.${l.id}`), value: fmtYen(l.value) })),
      { label: t('barFin.owesJbm'), value: fmtYen(pack?.hq?.jbm?.totalPendente || 0) },
    ] : [],
  })

  return (
    <div className="fade-in growth-page bar-fin">
      <div className="ui-pagebar">
        <button type="button" className="ui-btn is-ghost is-sm" onClick={onBack}><Icon name="back" size={16} />{t('barFin.allBars')}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ui-pagebar-title">{name || '…'}</div>
          <div className="ui-card-sub">{m ? t(m.window.closed ? 'barFin.closedMonth' : 'barFin.openMonth', { from: m.window.start, to: m.window.end, n: m.nights }) : t('barFin.loading')}</div>
        </div>
        <MonthPicker value={month} onChange={setMonth} />
        <button type="button" className="ui-btn is-sm" onClick={() => setReload(x => x + 1)} aria-label={t('barFin.refresh')}><Icon name="refresh" size={16} /></button>
      </div>

      {error && <div className="ui-error" role="alert"><Icon name="warning" />{error}</div>}
      {!m && !error && <div className="ui-skel" style={{ height: 320 }} />}

      {m && (
        <>
          <div className="ui-grid cols-4">
            <Kpi icon="sales" label={t('barFin.sales')} value={fmtYen(m.money.sales)} sub={deltaSub(t, delta(m.money.sales, p.money.sales))} />
            <Kpi icon="custos" label={t('barFin.costs')} value={fmtYen(m.money.costs)} sub={deltaSub(t, delta(m.money.costs, p.money.costs))} />
            <Kpi icon="result" label={t('barFin.result')} value={fmtYen(m.money.result)} tone={m.money.result < 0 ? 'danger' : ''} sub={t('barFin.prevWas', { amount: fmtYen(p.money.result) })} />
            <Kpi icon="chart" label={t('barFin.margin')} value={pct(m.money.marginPct)} sub={t('barFin.grossIs', { pct: pct(m.money.grossPct) })} />
          </div>

          <div className="ui-grid cols-2">
            <section className="ui-card">
              <div className="ui-card-head"><div className="ui-card-title">{t('barFin.till')}</div><span className="ui-badge">{t('barFin.tickets', { n: m.count })}</span></div>
              <div className="bar-fin-facts">
                <div><span>{t('barFin.avgTicket')}</span><b>{fmtYen(m.ticket)}</b></div>
                <div><span>{t('barFin.cardFee')}</span><b>{fmtYen(m.fee)}</b></div>
                <div><span>{t('barFin.cardWaiting')}</span><b>{fmtYen(m.card?.waiting || 0)}</b></div>
              </div>
              <Donut format={fmtYen} segments={TENDER_KEYS.map(k => ({ label: t(`barFin.tender.${k}`), value: Math.round(tender?.[k] || 0) }))} empty={t('barFin.noSales')} />
            </section>
            <section className="ui-card">
              <div className="ui-card-head"><div className="ui-card-title">{t('barFin.byNight')}</div></div>
              <ColumnChart data={m.byNight.map(d => ({ label: d.date.slice(8), value: d.sales, tip: `${d.date} ${d.label}` }))} format={fmtYen} empty={t('barFin.noSales')} />
            </section>
          </div>

          <section className="ui-card">
            <div className="ui-card-head"><div className="ui-card-title">{t('barFin.cashflow')}</div><span className="ui-muted">{t('barFin.cashflowSub')}</span></div>
            <InOutChart data={view.cashflow.map(r => ({ label: r.key.slice(5), in: r.in, out: r.out }))} format={compactYen} labels={[t('barFin.in'), t('barFin.out')]} empty={t('barFin.noSales')} />
            <table className="ui-table is-stack">
              <thead><tr><th>{t('barFin.month')}</th><th className="num">{t('barFin.in')}</th><th className="num">{t('barFin.out')}</th><th className="num">{t('barFin.net')}</th></tr></thead>
              <tbody>
                {view.cashflow.slice().reverse().map(r => (
                  <tr key={r.key}>
                    <td data-label={t('barFin.month')}>{r.key}</td>
                    <td data-label={t('barFin.in')} className="num">{fmtYen(r.in)}</td>
                    <td data-label={t('barFin.out')} className="num">{fmtYen(r.out)}</td>
                    <td data-label={t('barFin.net')} className={`num ${r.net < 0 ? 'txt-danger' : 'txt-success'}`}>{fmtYen(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="ui-grid cols-2">
            <section className="ui-card">
              <div className="ui-card-head"><div className="ui-card-title">{t('barFin.costsTitle')}</div><b>{fmtYen(m.money.costs)}</b></div>
              <HBarList items={m.lines.map(l => ({ key: l.id, label: t(`barFin.line.${l.id}`), value: l.value }))} format={fmtYen} max={10} empty={t('barFin.noCosts')} />
              {m.share < 1 && <p className="growth-formula"><Icon name="info" size={14} /> {t('barFin.shareNote', { n: m.nights })}</p>}
              <CostItems registry={pack.registry} month={month} />
            </section>
            <section className="ui-card">
              <div className="ui-card-head"><div className="ui-card-title">{t('barFin.marginTitle')}</div></div>
              <div className="bar-fin-pl">
                <PlRow label={t('barFin.sales')} value={m.money.sales} strong />
                <PlRow label={t('barFin.line.jbm')} value={-m.lines[0].value} />
                <PlRow label={t('barFin.grossProfit')} value={m.money.sales - m.lines[0].value} strong hint={pct(m.money.grossPct)} />
                {m.lines.slice(1).filter(l => l.value).map(l => <PlRow key={l.id} label={t(`barFin.line.${l.id}`)} value={-l.value} />)}
                <PlRow label={t('barFin.result')} value={m.money.result} strong hint={pct(m.money.marginPct)} />
              </div>
            </section>
          </div>

          <div className="ui-grid cols-2">
            <section className="ui-card">
              <div className="ui-card-head"><div className="ui-card-title">{t('barFin.agenda')}</div></div>
              {view.agenda.length === 0 && <div className="ui-muted">{t(month === today.slice(0, 7) ? 'barFin.noAgenda' : 'barFin.agendaNow')}</div>}
              {view.agenda.length > 0 && (
                <table className="ui-table is-stack">
                  <tbody>
                    {view.agenda.map(a => (
                      <tr key={`${a.id}-${a.date}`}>
                        <td data-label={t('barFin.date')}>{a.date}<div className="ui-muted">{a.days ? t('barFin.inDays', { n: a.days }) : t('barFin.today')}</div></td>
                        <td>{a.title || t(`barFin.kind.${a.kind}`, { fallback: a.kind })}</td>
                        <td className={`num ${a.inflow ? 'txt-success' : ''}`}>{a.inflow ? '+' : '−'}{fmtYen(a.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="ui-card">
              <div className="ui-card-head"><div className="ui-card-title">{t('barFin.jbmAccount')}</div></div>
              <div className="bar-fin-facts">
                <div><span>{t('barFin.boughtMonth')}</span><b>{fmtYen(pack.hq.jbm?.comprasMes || 0)}</b></div>
                <div><span>{t('barFin.owesJbm')}</span><b>{fmtYen(pack.hq.jbm?.totalPendente || 0)}</b></div>
                <div><span>{t('barFin.overdue')}</span><b className={pack.hq.jbm?.faturasAtraso ? 'txt-danger' : ''}>{pack.hq.jbm?.faturasAtraso || 0}</b></div>
              </div>
              <div className="ui-card-title" style={{ margin: '12px 0 6px' }}>{t('barFin.wages')}</div>
              <HBarList items={(pack.hq.payroll || []).map(r => ({ key: r.staff_id, label: r.nome, value: Math.round(r.pay || 0), sub: t('barFin.hours', { n: Math.round((r.hours || 0) * 10) / 10 }) }))} format={fmtYen} max={8} empty={t('barFin.noWages')} />
            </section>
          </div>

          <p className="growth-formula"><Icon name="info" size={14} /> {t('barFin.detailFormula')}</p>
        </>
      )}
    </div>
  )
}

function deltaSub(t, d) {
  if (d == null) return t('barFin.noPrev')
  return t('barFin.vsPrevPct', { pct: `${d > 0 ? '+' : ''}${d}%` })
}

function PlRow({ label, value, strong, hint }) {
  return (
    <div className={`bar-fin-pl-row${strong ? ' is-strong' : ''}`}>
      <span>{label}</span>
      <b className={value < 0 && strong ? 'txt-danger' : ''}>{value < 0 ? '−' : ''}{fmtYen(Math.abs(value))}{hint && <em> {hint}</em>}</b>
    </div>
  )
}

const COST_KINDS = ['aluguel', 'energia', 'fixo', 'variavel', 'contador', 'imposto', 'cartao']

function CostItems({ registry = [], month }) {
  const { t } = useI18n()
  const rows = (registry || [])
    .filter(r => COST_KINDS.includes(r.kind))
    .filter(r => !(r.kind === 'variavel' || r.kind === 'energia') || !r.month_key || r.month_key === month)
  if (!rows.length) return null
  return (
    <details className="bar-fin-items">
      <summary>{t('barFin.items', { n: rows.length })}</summary>
      <table className="ui-table">
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.nome || '—'}<div className="ui-muted">{t(`barFin.kind.${r.kind}`, { fallback: r.kind })}{r.metodo ? ` · ${r.metodo}` : ''}</div></td>
              <td className="num">{r.pct ? `${r.pct}%` : ''}{r.pct && +r.amount ? ' + ' : ''}{+r.amount || !r.pct ? fmtYen(r.amount) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
